import { readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function imageMetadata({
  source,
  repository,
  event,
  ref,
  defaultBranch = "main",
  tag,
  prerelease,
}) {
  const version = source.match(/^const Version = "([^"]+)"/m)?.[1];
  const match = version?.match(/^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/);
  if (!match)
    throw new Error("The app must have a valid stable/alpha/beta/rc version.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid image repository.");
  if (event === "release") {
    if (tag !== `v${version}`)
      throw new Error(`Release tag must be v${version}.`);
    if (Boolean(match[1]) !== prerelease)
      throw new Error(
        "Release prerelease checkbox must match the app version.",
      );
  } else if (event === "workflow_dispatch") {
    if (ref !== `refs/heads/${defaultBranch}`)
      throw new Error(
        "Manual publishing is allowed only from the default branch.",
      );
  } else
    throw new Error("Publishing requires a release or manual workflow run.");
  const image = `ghcr.io/${repository.toLowerCase()}`;
  const channel = match[1] || "latest";
  return { version, image, tags: `${image}:${version}\n${image}:${channel}` };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const metadata = imageMetadata({
    source: await readFile(
      new URL("../internal/app/app.go", import.meta.url),
      "utf8",
    ),
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    defaultBranch: event.repository.default_branch,
    tag: event.release?.tag_name,
    prerelease: event.release?.prerelease,
  });
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${metadata.version}\nimage=${metadata.image}\ntags<<DUET_IMAGE_TAGS\n${metadata.tags}\nDUET_IMAGE_TAGS\n`,
  );
  console.log(`Publishing ${metadata.image}:${metadata.version}`);
}
