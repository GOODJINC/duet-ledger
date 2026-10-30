// Disposable browser integration test. Never connects to an existing server or uses production data.
const { chromium } = require("playwright");
const { mkdtemp, rm, mkdir } = require("node:fs/promises");
const os = require("node:os"),
  path = require("node:path"),
  net = require("node:net"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "duet-offline-qa-"));
  const screenshots = process.env.DUET_LEDGER_TEST_SCREENSHOTS || root;
  await mkdir(screenshots, { recursive: true });
  const listener = net.createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    path.resolve(
      process.argv[2] || path.join(__dirname, "../../bin/duet-ledger"),
    ),
    [
      "serve",
      "--data-dir",
      path.join(root, "data"),
      "--listen",
      `127.0.0.1:${port}`,
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DUET_LEDGER_PUBLIC_URL: "",
        DUET_LEDGER_SECURE_COOKIE: "false",
        DUET_LEDGER_TRUSTED_PROXIES: "",
      },
    },
  );
  let errors = "";
  child.stderr.on("data", (x) => (errors += x));
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url + "/healthz")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    let cookie = "",
      csrf = "";
    async function api(method, route, body) {
      const response = await fetch(url + "/api" + route, {
        method,
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
          Origin: url,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.ok(response.ok, route + ":" + JSON.stringify(data));
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      if (data.csrf) csrf = data.csrf;
      return data;
    }
    const password = "Offline-QA-private-030";
    const user = await api("POST", "/setup", {
      username: "offline_qa",
      name: "오프라인 확인",
      password,
    });
    const ledger = (await api("GET", "/ledgers"))[0].id;
    const account = (
      await api("POST", "/accounts", {
        ledger_id: ledger,
        name: "QA 통장",
        kind: "bank",
        currency: "KRW",
        scale: 0,
        opening: "0",
      })
    ).id;
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(new Date());
    const oldYear = Number(today.slice(0, 4)) - 2,
      month = Number(today.slice(5, 7)),
      oldDate = `${oldYear}-${today.slice(5)}`;
    const base = {
      kind: "expense",
      date: oldDate,
      time: "12:00",
      timezone: "Asia/Seoul",
      amount: "500",
      account_id: account,
      title: "Old record",
      category: "food",
      note: "",
      target_note: "",
      ledger_id: "",
      to_id: "",
      version: 0,
    };
    const old = (await api("POST", "/transactions", base)).id;
    await api("POST", "/transactions", { ...base, title: "Expiring record" });
    await api("POST", "/transactions", {
      ...base,
      date: today,
      title: "Recent record",
      amount: "100",
    });
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 950 },
    });
    const split = cookie.indexOf("=");
    await context.addCookies([
      { name: cookie.slice(0, split), value: cookie.slice(split + 1), url },
    ]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const step = (s) => console.log("STEP " + s);
    await page.goto(url + "/ledger");
    await page.getByText("Recent record", { exact: true }).first().waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    step("online shell and recent records loaded");
    const help = await context.newPage();
    await help.goto(url + "/manual/ko/offline.html");
    await help.close();
    await page.bringToFront();
    await page.goto(url + "/settings");
    await page.getByLabel("최근 내역 자동 저장").waitFor();
    assert.equal(
      await page.getByLabel("최근 내역 자동 저장").inputValue(),
      "7",
    );
    await page.getByLabel("최근 내역 자동 저장").selectOption("30");
    await page.goto(url + "/ledger");
    async function chooseOld() {
      await page
        .getByRole("button", { name: "년·월 선택", exact: true })
        .click();
      await page.getByLabel("연도", { exact: true }).fill(String(oldYear));
      await page
        .getByRole("button", { name: month + "월", exact: true })
        .click();
    }
    await chooseOld();
    await page.getByText("Old record", { exact: true }).first().click();
    await page
      .getByRole("button", { name: "오프라인에 계속 보관", exact: true })
      .click();
    await page
      .getByRole("button", { name: "오프라인 보관 해제", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    step("past records automatically cached and pinned");
    await context.setOffline(true);
    await page.reload();
    await chooseOld();
    await page.getByText("Old record", { exact: true }).first().waitFor();
    await page
      .getByText(
        "기기에 저장된 내역만 보여주고 집계해요. 계좌 잔액은 마지막 서버 조회 기준이며, 최근 변경은 반영되지 않았을 수 있어요.",
        { exact: true },
      )
      .waitFor();
    step("offline reload and historical read succeeded");
    await page.getByText("Old record", { exact: true }).first().click();
    await page.getByRole("button", { name: "수정하기", exact: true }).click();
    await page.getByLabel("내용", { exact: true }).fill("Offline edited old");
    await page.getByLabel("금액", { exact: true }).fill("750");
    await page
      .getByRole("button", { name: "수정 저장하기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByText("Offline edited old", { exact: true })
      .first()
      .waitFor();
    step("offline historical edit queued");
    await page.keyboard.press("q");
    await page.getByLabel("내용", { exact: true }).fill("Offline new");
    await page.getByLabel("금액", { exact: true }).fill("321");
    const png = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 2;
        c.height = 2;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "red";
        ctx.fillRect(0, 0, 2, 2);
        return c.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    await page.locator("dialog input[type=file]").setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("button", { name: "기록 저장하기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "서버 연결 상태", exact: true })
      .click();
    await page.getByText("전송 대기: 2건", { exact: true }).waitFor();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, "desktop.png") });
    step("new offline record and receipt durably queued");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    async function waitRecords(predicate) {
      for (let i = 0; i < 160; i++) {
        const r = await api(
          "GET",
          "/transactions?from=1900-01-01&to=2100-12-31",
        );
        if (predicate(r)) return r;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("Sync timeout");
    }
    const synced = await waitRecords(
      (r) =>
        r.items.some(
          (t) =>
            t.legs[0].title === "Offline new" &&
            t.legs[0].receipts.length === 1,
        ) && r.items.some((t) => t.legs[0].title === "Offline edited old"),
    );
    assert.equal(
      synced.items.filter((t) => t.legs[0].title === "Offline new").length,
      1,
    );
    step("automatic reconnect synced edit, create and receipt exactly once");
    await page.reload();
    await chooseOld();
    await page
      .getByText("Offline edited old", { exact: true })
      .first()
      .waitFor();
    await context.setOffline(true);
    await page.getByText("Offline edited old", { exact: true }).first().click();
    await page.getByRole("button", { name: "수정하기", exact: true }).click();
    await page
      .getByLabel("내용", { exact: true })
      .fill("Conflicting offline edit");
    await page
      .getByRole("button", { name: "수정 저장하기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await api("PUT", "/transactions/" + old, {
      ...base,
      version: 2,
      title: "Family changed record",
      amount: "999",
    });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page
      .getByRole("button", { name: "서버 연결 상태", exact: true })
      .click();
    await page
      .getByText(
        "다른 사람이 수정한 기록이에요. 새로고침 후 다시 확인해 주세요.",
        { exact: false },
      )
      .waitFor();
    const actual = await api(
      "GET",
      "/transactions?from=1900-01-01&to=2100-12-31",
    );
    assert.ok(
      actual.items.some((t) => t.legs[0].title === "Family changed record"),
    );
    assert.ok(
      !actual.items.some((t) => t.legs[0].title === "Conflicting offline edit"),
    );
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "대기 기록 내보내기", exact: true })
      .click();
    assert.equal(
      (await download).suggestedFilename(),
      "duet-ledger-pending.json",
    );
    step(
      "concurrent modification conflict retained and exported without overwrite",
    );
    const retained = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("duet-ledger-offline", 1);
          r.onsuccess = () => {
            const tx = r.result.transaction("items", "readwrite"),
              store = tx.objectStore("items");
            const q = store.getAll();
            let pending;
            q.onsuccess = () => {
              for (const row of q.result) {
                if (
                  row.kind === "tx" &&
                  (row.pinned || row.value.legs[0].title === "Expiring record")
                ) {
                  row.seen = Date.now() - 31 * 86400000;
                  store.put(row);
                }
                if (row.kind === "queue") {
                  row.created = Date.now() - 400 * 86400000;
                  pending = row;
                  store.put(row);
                }
              }
            };
            tx.oncomplete = () => resolve(pending);
          };
        }),
    );
    await context.setOffline(true);
    await page.reload();
    await chooseOld();
    const retainedState = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("duet-ledger-offline", 1);
          r.onsuccess = () => {
            const q = r.result
              .transaction("items")
              .objectStore("items")
              .getAll();
            q.onsuccess = () =>
              resolve({
                expired: q.result.some(
                  (r) =>
                    r.kind === "tx" &&
                    r.value.legs[0].title === "Expiring record",
                ),
                pinned: q.result.some((r) => r.kind === "tx" && r.pinned),
                pending: q.result.filter((r) => r.kind === "queue").length,
                secret: q.result.some(
                  (r) => r.kind === "meta" && r.value?.csrf,
                ),
              });
          };
        }),
    );
    assert.equal(retainedState.expired, false);
    assert.equal(retainedState.pinned, true);
    assert.equal(retainedState.pending, 1);
    assert.equal(retainedState.secret, false);
    step(
      "retention prunes expired views but preserves pinned and pending records without CSRF storage",
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.setViewportSize({ width: 390, height: 850 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    if (
      !(await page
        .getByRole("button", { name: "대기 취소", exact: true })
        .count())
    )
      await page
        .getByRole("button", { name: "서버 연결 상태", exact: true })
        .click();
    await page.screenshot({ path: path.join(screenshots, "mobile.png") });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "대기 취소", exact: true }).click();
    await page.getByText("전송 대기: 0건", { exact: true }).waitFor();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.goto(url + "/ledger");
    const second = await context.newPage();
    await second.goto(url + "/ledger");
    await second.getByText("Recent record", { exact: true }).first().waitFor();
    await page.bringToFront();
    let dropped = false;
    await context.route("**/api/transactions", async (route) => {
      if (
        route.request().method() === "POST" &&
        !dropped &&
        route.request().postDataJSON()?.title === "Lost reply record"
      ) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.keyboard.press("q");
    await page.getByLabel("내용", { exact: true }).fill("Lost reply record");
    await page.getByLabel("금액", { exact: true }).fill("222");
    await page
      .getByRole("button", { name: "기록 저장하기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await context.unroute("**/api/transactions");
    await page
      .getByRole("button", { name: "서버 연결 상태", exact: true })
      .click();
    await page
      .getByRole("button", { name: "다시 연결·동기화", exact: true })
      .click();
    await second.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText("전송 대기: 0건", { exact: true }).waitFor();
    const replay = await api(
      "GET",
      "/transactions?from=1900-01-01&to=2100-12-31",
    );
    assert.equal(
      replay.items.filter((t) => t.legs[0].title === "Lost reply record")
        .length,
      1,
    );
    assert.ok(dropped);
    step("lost create response retried across tabs without duplicate");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.locator(".offline-report-note").waitFor({ state: "hidden" });
    await page.locator(".offline-pending-label").waitFor({ state: "hidden" });
    await page.getByText("Lost reply record", { exact: true }).first().click();
    await page.getByRole("button", { name: "수정하기", exact: true }).click();
    await page.getByLabel("내용", { exact: true }).fill("Lost edit reply");
    let editDropped = false;
    await context.route("**/api/transactions/*", async (route) => {
      if (route.request().method() === "PUT" && !editDropped) {
        editDropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "수정 저장하기", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await context.unroute("**/api/transactions/*");
    await page
      .getByRole("button", { name: "서버 연결 상태", exact: true })
      .click();
    await page
      .getByRole("button", { name: "다시 연결·동기화", exact: true })
      .click();
    await page.getByText("전송 대기: 0건", { exact: true }).waitFor();
    const edited = await api(
      "GET",
      "/transactions?from=1900-01-01&to=2100-12-31",
    );
    const applied = edited.items.find(
      (t) => t.legs[0].title === "Lost edit reply",
    );
    assert.equal(applied.version, 2);
    assert.ok(editDropped);
    step("lost update response did not apply a second edit");
    await second.close();
    await page.evaluate(
      (row) =>
        new Promise((resolve) => {
          const r = indexedDB.open("duet-ledger-offline", 1);
          r.onsuccess = () => {
            const tx = r.result.transaction("items", "readwrite");
            tx.objectStore("items").put(row);
            tx.oncomplete = () => resolve();
          };
        }),
      retained,
    );
    // A different signed-in user must not inherit the previous user's cache.
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    const invitation = await api("POST", "/invitations", {
      target_type: "account",
      target_id: account,
      role: "viewer",
    });
    const joined = await fetch(url + "/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: url },
      body: JSON.stringify({
        username: "offline_other",
        name: "다른 사용자",
        password,
        token: invitation.token,
      }),
    });
    assert.ok(joined.ok);
    const otherCookie = joined.headers.get("set-cookie").split(";")[0],
      other = await joined.json();
    await page
      .getByRole("button", { name: "사용자 메뉴", exact: true })
      .click();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: "로그인", exact: true }).waitFor();
    const at = otherCookie.indexOf("=");
    await context.addCookies([
      { name: otherCookie.slice(0, at), value: otherCookie.slice(at + 1), url },
    ]);
    await page.reload();
    await page
      .getByRole("button", { name: "사용자 메뉴", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("duet-ledger-offline-active"),
      ),
      other.id,
    );
    assert.equal(
      await page.getByText("Lost edit reply", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText("Recent record", { exact: true }).count(),
      0,
    );
    const isolated = await page.evaluate(
      (owner) =>
        new Promise((resolve) => {
          const r = indexedDB.open("duet-ledger-offline", 1);
          r.onsuccess = () => {
            const q = r.result
              .transaction("items")
              .objectStore("items")
              .getAll();
            q.onsuccess = () =>
              resolve({
                pending: q.result.filter(
                  (r) => r.kind === "queue" && r.owner === owner,
                ).length,
                views: q.result.filter(
                  (r) =>
                    (r.kind === "tx" || r.kind === "meta") && r.owner === owner,
                ).length,
              });
          };
        }),
      user.id,
    );
    assert.equal(isolated.pending, 1);
    assert.equal(isolated.views, 0);
    step("sign-out and account switch isolate stored records");
    assert.deepEqual(pageErrors, []);
    console.log(
      "PASS offline PWA, browser settings, old history, queued create/edit/photo, reconnect, conflict preservation and export; desktop/mobile no overflow.",
    );
  } catch (error) {
    console.error("SERVER LOG:", errors.slice(-1000));
    throw error;
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    await rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
