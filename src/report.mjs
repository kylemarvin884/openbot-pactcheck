import { commandMatcher, matchesPath } from "./glob.mjs";
import { commandMayWrite } from "./transcript.mjs";

export function evaluate({ ruleSet, transcripts, maxViolations = 0 }) {
  const actions = transcripts.flatMap((transcript) => transcript.actions);
  const commands = actions.filter((action) => action.kind === "command");
  const checks = ruleSet.rules.map((rule) => {
    const hits = actions.filter((action) => {
      if (rule.type === "no-edit") return action.kind === "edit" && matchesPath(rule.pattern, action.target);
      return action.kind === "command" && commandMatcher(rule.pattern)(action.command);
    });
    return { rule, hits };
  });

  const violations = checks.filter((check) => check.hits.length > 0).length;
  const summary = {
    rules: ruleSet.rules.length,
    skipped: ruleSet.skipped.length,
    checks: checks.length,
    violations,
    totalHits: checks.reduce((total, check) => total + check.hits.length, 0),
    actions: actions.length,
    edits: actions.filter((action) => action.kind === "edit").length,
    commands: actions.filter((action) => action.kind === "command").length,
    reads: actions.filter((action) => action.kind === "read").length,
    shellWrites: commands.filter((action) => commandMayWrite(action.command)).length,
    unparsed: transcripts.reduce((total, transcript) => total + transcript.unknownCalls.length, 0),
    badLines: transcripts.reduce((total, transcript) => total + transcript.badLines.length, 0),
    maxViolations,
    pass: violations <= maxViolations,
  };

  return {
    version: "0.1.0",
    rules: {
      file: ruleSet.file,
      mode: ruleSet.mode,
      parsed: ruleSet.rules,
      skipped: ruleSet.skipped,
    },
    transcripts: transcripts.map((transcript) => ({
      file: transcript.file,
      lines: transcript.lines,
      actions: transcript.actions.length,
      edits: transcript.actions.filter((action) => action.kind === "edit").length,
      commands: transcript.actions.filter((action) => action.kind === "command").length,
      reads: transcript.actions.filter((action) => action.kind === "read").length,
      badLines: transcript.badLines,
      unknownCalls: transcript.unknownCalls,
    })),
    checks: checks.map(({ rule, hits }) => ({
      rule,
      hits: hits.length,
      actions: hits.map((action) => ({
        kind: action.kind,
        file: action.file,
        line: action.line,
        tool: action.tool,
        ...(action.target ? { target: action.target } : {}),
        ...(action.command ? { command: action.command } : {}),
      })),
    })),
    summary,
  };
}

export function renderText(result, { explain = false } = {}) {
  const { summary, rules, checks } = result;
  const lines = [];
  lines.push(`pactcheck ${result.version}`);
  lines.push("");
  lines.push(`rules       ${rules.file}  (${rules.parsed.length} checkable, ${rules.skipped.length} skipped)`);
  for (const transcript of result.transcripts) {
    lines.push(
      `transcript  ${transcript.file}  ${transcript.actions} actions (${transcript.edits} edit, ${transcript.commands} command, ${transcript.reads} read)`,
    );
  }
  lines.push("");

  if (!checks.length) {
    lines.push("No machine-checkable rules found. Add a pactcheck block or a line like:");
    lines.push("  Do not edit `config/**`");
    lines.push("  Never run `git push --force`");
  }

  const width = Math.max(9, ...checks.map((check) => check.rule.type.length));
  for (const check of checks) {
    const label = check.hits > 0 ? "VIOLATION" : "ok";
    lines.push(`${label.padEnd(10)}${check.rule.type.padEnd(width + 2)}${check.rule.pattern}  (${check.hits} hit${check.hits === 1 ? "" : "s"})`);
    for (const action of check.actions) {
      const detail = action.target ?? action.command;
      lines.push(`           ${detail}  (${action.tool}, ${action.file}:${action.line})`);
    }
  }

  lines.push("");
  if (summary.badLines) lines.push(`warning: ${summary.badLines} transcript line(s) were not valid JSON`);
  if (summary.unparsed) lines.push(`note: ${summary.unparsed} tool call(s) were not a recognized edit/command tool`);
  if (summary.shellWrites) {
    lines.push(
      `note: ${summary.shellWrites} command(s) look like they write files; paths from shell redirects are not checked. Add a no-run rule for those commands.`,
    );
  }

  if (explain && rules.skipped.length) {
    lines.push("");
    lines.push("skipped rules:");
    for (const item of rules.skipped) {
      lines.push(`  line ${item.line}: ${item.reason}  ${truncate(item.text, 90)}`);
    }
  } else if (rules.skipped.length) {
    lines.push(`skipped ${rules.skipped.length} line(s) that are not machine-checkable (--explain to list)`);
  }

  lines.push("");
  lines.push(
    `${summary.violations} violation${summary.violations === 1 ? "" : "s"} / ${summary.checks} rule${summary.checks === 1 ? "" : "s"} checked -> exit ${summary.pass ? 0 : 1}`,
  );
  return `${lines.join("\n")}\n`;
}

// Edit/command counts come from the transcript summary, not from rule hits:
// the report needs the totals even when no rule matches.
function truncate(value, max) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
