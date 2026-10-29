import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "src", "cli.mjs");
const rules = path.join(root, "fixtures", "AGENTS.md");
const bad = path.join(root, "fixtures", "session-bad.jsonl");
const clean = path.join(root, "fixtures", "session-clean.jsonl");
const codex = path.join(root, "fixtures", "session-codex.jsonl");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd: root });
}

test("a session that breaks rules exits 1 and names every hit", () => {
  const result = run([bad, "--rules", rules]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /3 violations \/ 5 rules checked/);
  assert.match(result.stdout, /config\/policy\.json/);
  assert.match(result.stdout, /git push --force origin main/);
  assert.match(result.stdout, /secrets\/deploy-token\.txt/);
});

test("a clean session exits 0", () => {
  const result = run([clean, "--rules", rules]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 violations \/ 5 rules checked/);
  assert.doesNotMatch(result.stdout, /VIOLATION/);
});

test("Codex transcripts are checked through function_call and apply_patch", () => {
  const result = run([codex, "--rules", rules]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /npm publish/);
  assert.match(result.stdout, /config\/release\.json/);
});

test("--json is machine-readable and keeps the same verdict", () => {
  const result = run([bad, "--rules", rules, "--json"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.pass, false);
  assert.equal(parsed.summary.violations, 3);
  assert.equal(parsed.summary.rules, 5);
  assert.equal(parsed.rules.mode, "explicit+prose");
  assert.equal(parsed.checks.filter((check) => check.hits > 0).length, 3);
});

test("--max-violations turns a failing run into a passing one", () => {
  const result = run([bad, "--rules", rules, "--max-violations", "3"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /-> exit 0/);
});

test("--explain lists why a line was skipped", () => {
  const result = run([clean, "--rules", rules, "--explain"]);
  assert.match(result.stdout, /Only run `npm test` after every change\./);
  assert.match(result.stdout, /not a prohibition/);
});

test("a missing rules file exits 2 with a clear message", () => {
  const result = run([clean, "--rules", path.join(root, "fixtures", "nope.md")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ENOENT|no such file/i);
});

test("a directory of transcripts is scanned", () => {
  const result = run([path.join(root, "fixtures"), "--rules", rules, "--json"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.transcripts.length, 3);
  assert.ok(parsed.summary.violations >= 3);
});
