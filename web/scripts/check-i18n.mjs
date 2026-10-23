import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
const sourceRoot = new URL("../src/", import.meta.url);
const ko = JSON.parse(
  await readFile(new URL("i18n/ko.json", sourceRoot), "utf8"),
);
const en = JSON.parse(
  await readFile(new URL("i18n/en.json", sourceRoot), "utf8"),
);
const messages = new Set();
for (const file of await readdir(sourceRoot)) {
  if (!/\.(ts|tsx)$/.test(file) || file.includes(".test.")) continue;
  const source = ts.createSourceFile(
    file,
    await readFile(new URL(file, sourceRoot), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      ["value", "defaultValue"].includes(node.name.getText(source)) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const value = node.initializer.expression;
      if (
        value &&
        ts.isCallExpression(value) &&
        value.expression.getText(source) === "msg" &&
        !ts.isStringLiteral(value.arguments[0])
      )
        throw new Error(`Do not translate editable user data: ${file}`);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /[가-힣]/.test(node.text)
    )
      messages.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const placeholders = (text) => (text.match(/\{\d+\}/g) || []).sort().join(",");
for (const key of messages) {
  if (!(key in ko) || !(key in en))
    throw new Error(`Missing translation: ${key}`);
  if (placeholders(key) !== placeholders(en[key]))
    throw new Error(`Invalid placeholders: ${key}`);
  if (!en[key].trim() || (key !== "한국어" && /[가-힣]/.test(en[key])))
    throw new Error(`Untranslated message: ${key}`);
}
for (const key of Object.keys(ko)) {
  if (!(key in en)) throw new Error(`Missing English catalog key: ${key}`);
}
console.log(
  `Validated ${messages.size} UI messages and translation placeholders.`,
);
