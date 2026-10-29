import test from "node:test";
import assert from "node:assert/strict";
import { commandMatcher, matchesPath, normalizeCommand } from "../src/glob.mjs";

test("glob matches files under a directory", () => {
  assert.equal(matchesPath("config/**", "config/policy.json"), true);
  assert.equal(matchesPath("config/**", "config/nested/deep.json"), true);
  assert.equal(matchesPath("config/**", "src/config/policy.json"), false);
});

test("trailing slash and bare directory names mean the whole subtree", () => {
  assert.equal(matchesPath("config/", "config/a.json"), true);
  assert.equal(matchesPath("secrets", "secrets/key.pem"), true);
  assert.equal(matchesPath("secrets", "secrets"), true);
});

test("paths are case-insensitive and accept Windows separators", () => {
  assert.equal(matchesPath("config/**", "Config\\Policy.JSON"), true);
  assert.equal(matchesPath(".env*", ".env.local"), true);
  assert.equal(matchesPath(".env*", "docs/env.md"), false);
});

test("double star at the start also matches top level", () => {
  assert.equal(matchesPath("**/*.pem", "key.pem"), true);
  assert.equal(matchesPath("**/*.pem", "certs/key.pem"), true);
});

test("commands match as normalized substrings", () => {
  const matches = commandMatcher("git push --force");
  assert.equal(matches("Git   PUSH --force origin main"), true);
  assert.equal(matches("git push origin main"), false);
});

test("commands wrapped in slashes are regular expressions", () => {
  const matches = commandMatcher("/^rm\\s+-rf/");
  assert.equal(matches("rm -rf /tmp/x"), true);
  assert.equal(matches("echo rm -rf"), false);
});

test("normalizeCommand collapses whitespace", () => {
  assert.equal(normalizeCommand("  npm   test\n"), "npm test");
});
