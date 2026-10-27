import { readFile } from "node:fs/promises";
const main = await readFile(
  new URL("../compose.yaml", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../internal/app/app.go", import.meta.url),
  "utf8",
);
const version = appSource.match(/^const Version = "([^"]+)"/m)?.[1];
if (
  !version ||
  !main.includes(`DUET_LEDGER_IMAGE:-ghcr.io/goodjinc/duet-ledger:${version}`)
)
  throw new Error("Default image tag must match the app version.");
const schema = JSON.parse(
  await readFile(
    new URL("../web/public/openapi.json", import.meta.url),
    "utf8",
  ),
);
if (schema.info.version !== version)
  throw new Error("OpenAPI version must match the app version.");

for (const name of ["package.json", "package-lock.json"]) {
  const metadata = JSON.parse(
    await readFile(new URL(`../web/${name}`, import.meta.url), "utf8"),
  );
  if (
    metadata.version !== version ||
    (name === "package-lock.json" && metadata.packages[""].version !== version)
  )
    throw new Error(`${name} version must match the app version.`);
}
const example = await readFile(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
if (
  !example.includes(
    `DUET_LEDGER_IMAGE=ghcr.io/goodjinc/duet-ledger:${version}\n`,
  )
)
  throw new Error("Example image version must match the app version.");
const ui = await readFile(
  new URL("../web/src/app.tsx", import.meta.url),
  "utf8",
);
if (
  !ui.includes(`Duet Ledger <span className="footer-dot">·</span> ${version}`)
)
  throw new Error("Footer version must match the app version.");
const notices = await readFile(
  new URL("../web/public/third-party-licenses.txt", import.meta.url),
  "utf8",
);
if (!notices.includes(`Duet Ledger ${version}\n`))
  throw new Error("License notice version must match the app version.");

console.log("Compose, OpenAPI, UI, package and notice versions match the app.");
