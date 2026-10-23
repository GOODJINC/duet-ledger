import { readFile, writeFile } from "node:fs/promises";
const main = await readFile(
  new URL("../compose.yaml", import.meta.url),
  "utf8",
);
const target = new URL("../compose.arcane.yaml", import.meta.url);
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

const arcane =
  "# Arcane/LAN preset: creates the same persistent volume as compose.yaml.\n" +
  main.replace("DUET_LEDGER_BIND:-127.0.0.1", "DUET_LEDGER_BIND:-0.0.0.0");
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== arcane)
    throw new Error(
      "Run node scripts/sync-compose.mjs after changing compose.yaml.",
    );
  console.log("Compose templates match.");
} else await writeFile(target, arcane);
