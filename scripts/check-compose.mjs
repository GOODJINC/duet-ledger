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

console.log("Compose image and OpenAPI versions match the app.");
