// Build bundled help from the same Markdown files published on GitHub.
import { Marked } from "marked";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(root, "manual");
const outputRoot = path.join(root, "web/public/manual");
const pages = [
  "index",
  "installation",
  "usage",
  "operations",
  "api",
  "mcp",
  "troubleshooting",
  "publishing",
];
const escapeHTML = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const slug = (value) =>
  value
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .replace(/ /g, "-");
const safeURL = (value) =>
  !/^[a-z][a-z\d+.-]*:/i.test(value) || /^https?:/i.test(value);
const sources = new Map();
for (const locale of ["ko", "en"]) {
  for (const page of pages) {
    const file = path.join(sourceRoot, locale, page + ".md");
    sources.set(file, await readFile(file, "utf8"));
  }
}

// Fail the build for broken manual links and heading anchors.
for (const [file, source] of sources) {
  const parser = new Marked();
  const tokens = parser.lexer(source);
  const links = [];
  parser.walkTokens(tokens, (token) => {
    if (token.type === "link" || token.type === "image") links.push(token.href);
  });
  for (const link of links) {
    if (!safeURL(link)) throw new Error(`Unsafe manual link: ${file}: ${link}`);
    if (/^https?:/i.test(link) || link.startsWith("/")) continue;
    const [relative, fragment] = link.split("#");
    const target = relative
      ? path.resolve(path.dirname(file), decodeURIComponent(relative))
      : file;
    if (path.relative(sourceRoot, target).startsWith(".."))
      throw new Error(`Manual link leaves source directory: ${link}`);
    await access(target);
    if (fragment && target.endsWith(".md")) {
      const targetSource =
        sources.get(target) ?? (await readFile(target, "utf8"));
      const headings = parser
        .lexer(targetSource)
        .filter((token) => token.type === "heading")
        .map((token) => slug(token.text));
      if (!headings.includes(decodeURIComponent(fragment)))
        throw new Error(`Missing heading: ${file}: ${link}`);
    }
  }
}
if (process.argv.includes("--check")) {
  console.log(`Validated ${sources.size} manuals and local links.`);
} else {
  await rm(outputRoot, { recursive: true, force: true });
  for (const [file, source] of sources) {
    const locale = path.basename(path.dirname(file));
    const page = path.basename(file, ".md");
    const parser = new Marked({ gfm: true });
    parser.use({
      renderer: {
        html({ text }) {
          return escapeHTML(text);
        },
        heading({ tokens, depth, text }) {
          return `<h${depth} id="${escapeHTML(slug(text))}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
      },
      walkTokens(token) {
        if (token.type === "link") {
          if (!safeURL(token.href)) token.href = "#";
          if (!/^https?:/i.test(token.href))
            token.href = token.href.replace(/\.md(?=#|$)/, ".html");
        }
      },
    });
    const content = parser.parse(source);
    const title = source.match(/^# (.+)$/m)?.[1] || "Duet Ledger";
    const other = locale === "ko" ? "en" : "ko";
    const home = locale === "ko" ? "매뉴얼" : "Manual";
    const app = locale === "ko" ? "가계부로 돌아가기" : "Back to app";
    const directory = path.join(outputRoot, locale);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, page + ".md"), source);
    await writeFile(
      path.join(directory, page + ".html"),
      `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(title)} · Duet Ledger</title><link rel="stylesheet" href="/manual.css"></head><body><header><nav aria-label="${home}"><a href="index.html">Duet Ledger · ${home}</a><span><a href="../${other}/${page}.html">${other === "en" ? "English" : "한국어"}</a><a href="${page}.md" download>Markdown</a><a href="/home">${app}</a></span></nav></header><main>${content}</main></body></html>\n`,
    );
  }
  console.log(`Built ${sources.size} bundled manuals from Markdown.`);
}
