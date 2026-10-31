import { test } from "node:test";
import assert from "node:assert/strict";
import { imageMetadata } from "./image-metadata.mjs";
const input = {
  source: 'const Version = "0.1.0-alpha.12"',
  repository: "daytivehq/duet-ledger",
  event: "workflow_dispatch",
  ref: "refs/heads/main",
};
test("prereleases publish their exact version and channel without latest", () => {
  assert.deepEqual(imageMetadata(input), {
    version: "0.1.0-alpha.12",
    image: "ghcr.io/daytivehq/duet-ledger",
    tags: "ghcr.io/daytivehq/duet-ledger:0.1.0-alpha.12\nghcr.io/daytivehq/duet-ledger:alpha",
  });
  for (const channel of ["beta", "rc"])
    assert.ok(
      !imageMetadata({
        ...input,
        source: `const Version = "1.0.0-${channel}.1"`,
      }).tags.includes(":latest"),
    );
});
test("stable releases publish latest only when the release matches the binary", () => {
  assert.ok(
    imageMetadata({
      ...input,
      source: 'const Version = "1.2.3"',
      event: "release",
      tag: "v1.2.3",
      prerelease: false,
    }).tags.endsWith(":latest"),
  );
  assert.throws(() =>
    imageMetadata({
      ...input,
      event: "release",
      tag: "v0.1.0-alpha.11",
      prerelease: true,
    }),
  );
  assert.throws(() =>
    imageMetadata({
      ...input,
      event: "release",
      tag: "v0.1.0-alpha.12",
      prerelease: false,
    }),
  );
});
test("organization publishing uses the current repository owner", () => {
  assert.deepEqual(
    imageMetadata({
      ...input,
      repository: "daytivehq/duet-ledger",
      source: 'const Version = "0.3.0"',
    }),
    {
      version: "0.3.0",
      image: "ghcr.io/daytivehq/duet-ledger",
      tags: "ghcr.io/daytivehq/duet-ledger:0.3.0\nghcr.io/daytivehq/duet-ledger:latest",
    },
  );
});
test("unreviewed branches and push/PR events cannot publish", () => {
  assert.throws(() => imageMetadata({ ...input, ref: "refs/heads/feature" }));
  for (const event of ["push", "pull_request"])
    assert.throws(() => imageMetadata({ ...input, event }));
});

import { checkImageVersion } from "./check-image-version.mjs";
test("first image is allowed but an existing version cannot be overwritten", async () => {
  const params = {
    repository: "daytivehq/duet-ledger",
    version: "0.1.0-alpha.12",
    token: "test",
  };
  await checkImageVersion({
    ...params,
    request: async () => ({ status: 404 }),
  });
  await assert.rejects(
    checkImageVersion({
      ...params,
      request: async () => ({
        ok: true,
        json: async () => [
          { metadata: { container: { tags: ["0.1.0-alpha.12"] } } },
        ],
      }),
    }),
    /already exists/,
  );
  await assert.rejects(
    checkImageVersion({
      ...params,
      request: async () => ({ status: 403, ok: false }),
    }),
    /HTTP 403/,
  );
});
test("version checks follow pagination and use organization paths when appropriate", async () => {
  let calls = 0;
  await assert.rejects(
    checkImageVersion({
      repository: "TEAM/app",
      ownerType: "Organization",
      version: "1.0.0",
      token: "test",
      request: async (url) => {
        assert.ok(
          url.startsWith(
            "https://api.github.com/orgs/team/packages/container/app/versions",
          ),
        );
        calls++;
        return {
          ok: true,
          json: async () =>
            calls === 1
              ? Array.from({ length: 100 }, () => ({
                  metadata: { container: { tags: [] } },
                }))
              : [{ metadata: { container: { tags: ["1.0.0"] } } }],
        };
      },
    }),
    /already exists/,
  );
  assert.equal(calls, 2);
});
