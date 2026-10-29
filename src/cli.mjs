#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseRules } from "./rules.mjs";
import { actionsFromFile } from "./transcript.mjs";
import { evaluate, renderText } from "./report.mjs";

const VERSION = "0.1.0";
const DEFAULT_RULE_FILES = ["AGENTS.md", "CLAUDE.md"];

main();

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    return;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  try {
    const ruleSet = loadRules(options.rules ?? findDefaultRules());
    const files = options.inputs.flatMap((input) => expandTranscripts(input));
    if (!files.length) throw new Error("no .jsonl transcripts found in the given paths");

    const transcripts = files.map((file) => {
      const text = fs.readFileSync(file, "utf8");
      return actionsFromFile(text, { file: displayPath(file) });
    });

    const result = evaluate({ ruleSet, transcripts, maxViolations: options.maxViolations });
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderText(result, { explain: options.explain }));
    process.exitCode = result.summary.pass ? 0 : 1;
  } catch (error) {
    fail(error.message);
  }
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    rules: null,
    json: false,
    explain: false,
    help: false,
    version: false,
    maxViolations: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--version" || arg === "-v") {
      options.version = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--explain") {
      options.explain = true;
    } else if (arg === "--rules" || arg.startsWith("--rules=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--rules needs a file or directory");
      options.rules = value;
    } else if (arg === "--max-violations" || arg.startsWith("--max-violations=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--max-violations must be a non-negative integer");
      options.maxViolations = parsed;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`unknown option ${arg}`);
    } else {
      options.inputs.push(arg);
    }
  }

  if (!options.help && !options.version && !options.inputs.length) {
    throw new Error("no transcript given. Run `pactcheck --help`.");
  }
  return options;
}

function findDefaultRules() {
  for (const candidate of DEFAULT_RULE_FILES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`no rules file found. Pass --rules <AGENTS.md> or create one of: ${DEFAULT_RULE_FILES.join(", ")}`);
}

function loadRules(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return parseRules(fs.readFileSync(target, "utf8"), { file: displayPath(target) });

  const files = fs
    .readdirSync(target)
    .filter((name) => /\.(md|mdc)$/i.test(name))
    .sort()
    .map((name) => path.join(target, name));
  if (!files.length) throw new Error(`no .md or .mdc files in ${target}`);

  const parsed = files.map((file) => parseRules(fs.readFileSync(file, "utf8"), { file: displayPath(file) }));
  return {
    file: displayPath(target),
    mode: parsed.some((item) => item.mode !== "prose") ? "explicit+prose" : "prose",
    rules: parsed.flatMap((item) => item.rules).map((rule, index) => ({ ...rule, id: `R${index + 1}` })),
    skipped: parsed.flatMap((item) => item.skipped.map((entry) => ({ ...entry, file: item.file }))),
  };
}

function expandTranscripts(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  if (!stat.isDirectory()) throw new Error(`not a file or directory: ${input}`);

  const found = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(input, entry.name);
    if (entry.isDirectory()) found.push(...expandTranscripts(full));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
  }
  return found.sort();
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), path.resolve(file));
  return relative.startsWith("..") ? file : relative;
}

function fail(message) {
  process.stderr.write(`pactcheck: ${message}\n`);
  process.exitCode = 2;
}

function helpText() {
  return `pactcheck ${VERSION} - check an agent transcript against AGENTS.md / CLAUDE.md

Usage:
  pactcheck <transcript.jsonl|dir>... [--rules <file|dir>] [--json] [--explain]
            [--max-violations <n>]

Checks:
  no-edit  a file edit whose path matches a glob
  no-run   a shell command that contains a string (or matches /regex/i)

Rules are read from:
  1. an explicit block:
       <!-- pactcheck
       no-edit: config/**, .env*
       no-run: git push --force
       -->
  2. prose lines that contain a prohibition, an action verb and a code span:
       Do not edit \`config/**\`
       Never run \`git push --force\`

Exit codes:
  0  no violations (or within --max-violations)
  1  violations found
  2  usage or parse error

Options:
  --rules <path>        rules file or directory (default: AGENTS.md, then CLAUDE.md)
  --max-violations <n>  allowed violations before exit 1 (default: 0)
  --json                machine-readable output
  --explain             list skipped lines and why
  --help, --version
`;
}
