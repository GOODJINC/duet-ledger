import { fileURLToPath } from "node:url";
export async function checkImageVersion({
  repository,
  ownerType = "User",
  version,
  token,
  request = fetch,
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/.test(version)
  )
    throw new Error("Invalid repository or version.");
  const [owner, name] = repository.toLowerCase().split("/");
  const scope = ownerType === "Organization" ? "orgs" : "users";
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `https://api.github.com/${scope}/${owner}/packages/container/${name}/versions?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    if (response.status === 404 && page === 1) return; // First publication creates the package.
    if (!response.ok)
      throw new Error(
        `Cannot verify existing image versions (HTTP ${response.status}). Check package Actions access before publishing.`,
      );
    const versions = await response.json();
    if (
      versions.some((item) => item.metadata?.container?.tags?.includes(version))
    )
      throw new Error(
        `Version ${version} already exists. Increase the app version instead of overwriting it.`,
      );
    if (versions.length < 100) return;
  }
  throw new Error("Too many package versions to safely verify uniqueness.");
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await checkImageVersion({
    repository: process.env.GITHUB_REPOSITORY,
    ownerType: process.env.PACKAGE_OWNER_TYPE,
    version: process.env.IMAGE_VERSION,
    token: process.env.GITHUB_TOKEN,
  });
