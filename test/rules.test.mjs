import test from "node:test";
import assert from "node:assert/strict";
import { parseRules } from "../src/rules.mjs";

test("explicit block produces exact rules", () => {
  const { rules, mode } = parseRules(`
# rules

<!-- pactcheck
no-edit: config/**, .env*
no-run: git push --force
-->
`, { file: "AGENTS.md" });

  assert.equal(mode, "explicit+prose");
  assert.deepEqual(
    rules.map((rule) => [rule.type, rule.pattern, rule.origin]),
    [
      ["no-edit", "config/**", "explicit"],
      ["no-edit", ".env*", "explicit"],
      ["no-run", "git push --force", "explicit"],
    ],
  );
});

test("explicit block keeps a regex containing commas together", () => {
  const { rules } = parseRules(`
<!-- pactcheck
no-run: /rm\\s+-rf\\s+(\\/|~)/, git push --force
-->
`);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].pattern, "/rm\\s+-rf\\s+(\\/|~)/");
  assert.equal(rules[1].pattern, "git push --force");
});

test("Chinese prose with a path is parsed", () => {
  const { rules } = parseRules("不要修改 `src/core/**`，也不要改 `package.json`。");
  assert.deepEqual(
    rules.map((rule) => [rule.type, rule.pattern]),
    [
      ["no-edit", "src/core/**"],
      ["no-edit", "package.json"],
    ],
  );
});

test("English prose with a command is parsed", () => {
  const { rules } = parseRules("Never run `git push --force` in this repo.");
  assert.deepEqual(
    rules.map((rule) => [rule.type, rule.pattern]),
    [["no-run", "git push --force"]],
  );
});

test("prose and explicit rules are deduplicated, explicit first", () => {
  const { rules } = parseRules(`
<!-- pactcheck
no-edit: config/**
-->
不要修改 \`config/**\`。
`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].origin, "explicit");
});

test("positive requirements are skipped instead of guessed", () => {
  const { rules, skipped } = parseRules("Only run `npm test` after every change.");
  assert.equal(rules.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /not a prohibition/);
});

test("a line mixing edit and run intent is reported, not guessed", () => {
  const { rules, skipped } = parseRules("Do not edit `config/**` or run `npm publish`.");
  assert.equal(rules.length, 0);
  assert.match(skipped[0].reason, /both editing and running/);
});

test("keywords inside code spans do not create intent", () => {
  const { rules, skipped } = parseRules("The `avoid` directory is documented in `docs/avoid.md`.");
  assert.equal(rules.length, 0);
  assert.equal(skipped.length, 0);
});

test("unclosed explicit block is reported", () => {
  const { skipped } = parseRules("<!-- pactcheck\nno-edit: config/**\n");
  assert.ok(skipped.some((entry) => /not closed/.test(entry.reason)));
});

test("unsupported explicit keys are reported", () => {
  const { rules, skipped } = parseRules("<!-- pactcheck\nno-deploy: prod\n-->");
  assert.equal(rules.length, 0);
  assert.match(skipped[0].reason, /unsupported key/);
});

test("one-line explicit block works", () => {
  const { rules } = parseRules("<!-- pactcheck no-edit: .env* -->");
  assert.deepEqual(rules.map((rule) => rule.pattern), [".env*"]);
});
