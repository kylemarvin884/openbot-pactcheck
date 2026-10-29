import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "src", "cli.mjs");
const rules = path.join(root, "fixtures", "AGENTS.md");

const runs = [
  {
    title: "1. A session that breaks three rules",
    args: [path.join(root, "fixtures", "session-bad.jsonl"), "--rules", rules],
  },
  {
    title: "2. The same task, done inside the rules",
    args: [path.join(root, "fixtures", "session-clean.jsonl"), "--rules", rules],
  },
  {
    title: "3. A Codex transcript (function_call + apply_patch)",
    args: [path.join(root, "fixtures", "session-codex.jsonl"), "--rules", rules],
  },
];

for (const run of runs) {
  process.stdout.write(`\n=== ${run.title} ===\n\n`);
  const result = spawnSync(process.execPath, [cli, ...run.args], { encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(`(demo: command exited ${result.status})\n`);
}

process.stdout.write("\nTry the JSON form:\n");
process.stdout.write(`  node src/cli.mjs fixtures/session-bad.jsonl --rules fixtures/AGENTS.md --json\n`);
