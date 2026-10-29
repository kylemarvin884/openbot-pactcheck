// Transcripts are JSONL: one JSON object per line. We do not interpret prose;
// only tool calls that carry a path or a command become actions.
//
// Supported shapes, all seen in the wild:
//   - Claude Code: { type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }
//   - Codex:       { type: "response_item", payload: { type: "function_call", name, arguments } }
//                  { type: "item.completed", item: { type: "command_execution", command } }
//   - generic:     { type: "tool_call", tool, input } / { tool_name, tool_input }

const EDIT_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "apply_patch",
  "create_file",
  "write_file",
  "edit_file",
  "update_file",
]);

const COMMAND_TOOLS = new Set([
  "bash",
  "shell",
  "exec_command",
  "run_terminal_cmd",
  "local_shell",
  "terminal",
  "container_exec",
  "execute_command",
  "shell_command",
  "exec",
  "sh",
  "zsh",
]);

const READ_TOOLS = new Set(["read", "view", "read_file", "notebook_read", "notebookread", "read_many_files"]);

const PATH_KEYS = ["file_path", "path", "file", "filename", "target_file", "notebook_path"];

export function actionsFromFile(text, { file = "session.jsonl" } = {}) {
  const actions = [];
  const badLines = [];
  const unknownCalls = [];
  const lines = String(text ?? "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      badLines.push(lineNumber);
      return;
    }

    walk(value, (call) => {
      const parsed = normalizeCall(call, { file, line: lineNumber });
      if (parsed === null) {
        unknownCalls.push({ line: lineNumber, tool: call.tool });
        return;
      }
      for (const action of parsed) actions.push(action);
    });
  });

  return {
    file,
    actions: dedupeAdjacent(actions),
    lines: lines.length,
    badLines,
    unknownCalls,
  };
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;

  const call = asCall(node);
  if (call) {
    visit(call);
    return;
  }
  for (const value of Object.values(node)) walk(value, visit);
}

function asCall(node) {
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
  const rawName = node.name ?? node.tool ?? node.tool_name ?? node.function?.name ?? null;

  if (type === "command_execution" && (node.command ?? node.cmd)) {
    return { tool: "shell", input: { command: node.command ?? node.cmd }, type };
  }

  if (type === "file_change" && Array.isArray(node.changes)) {
    return { tool: "write", input: { changes: node.changes }, type };
  }

  if (!rawName) return null;

  const isCallType = ["tool_use", "tool_call", "function_call", "custom_tool_call", "tool_invocation"].includes(type);
  if (!isCallType && !isKnownTool(rawName)) return null;

  const input = node.input ?? node.arguments ?? node.args ?? node.parameters ?? node.tool_input ?? node.function?.arguments;
  return { tool: String(rawName), input, type };
}

function isKnownTool(name) {
  const normalized = normalizeToolName(name);
  return EDIT_TOOLS.has(normalized) || COMMAND_TOOLS.has(normalized) || READ_TOOLS.has(normalized) || normalized === "apply_patch";
}

function normalizeToolName(name) {
  const lower = String(name).toLowerCase().trim();
  const lastSegment = lower.split("__").pop();
  const afterDot = lastSegment.split(".").pop();
  return afterDot.replace(/[\s-]+/g, "_");
}

function normalizeCall(call, { file, line }) {
  const tool = normalizeToolName(call.tool);
  const input = parseInput(call.input);

  if (tool === "apply_patch") {
    return patchActions(input, { file, line, tool: call.tool });
  }

  if (COMMAND_TOOLS.has(tool)) {
    const command = extractCommand(input);
    if (!command) return null;
    return [
      { kind: "command", command, tool: call.tool, file, line },
      ...patchTargets(command).map((target) => ({ kind: "edit", target, tool: call.tool, file, line })),
    ];
  }

  if (EDIT_TOOLS.has(tool)) {
    if (input?.changes && Array.isArray(input.changes)) {
      return input.changes
        .map((change) => change?.path ?? change?.file)
        .filter(Boolean)
        .map((target) => ({ kind: "edit", target, tool: call.tool, file, line }));
    }
    const target = firstPath(input);
    if (!target) return null;
    return [{ kind: "edit", target, tool: call.tool, file, line }];
  }

  if (READ_TOOLS.has(tool)) {
    const target = firstPath(input);
    if (!target) return null;
    return [{ kind: "read", target, tool: call.tool, file, line }];
  }

  return null;
}

function parseInput(input) {
  if (input === undefined || input === null) return {};
  if (typeof input === "object") return input;
  if (typeof input !== "string") return {};
  const trimmed = input.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : { command: trimmed };
  } catch {
    // Codex shell calls sometimes pass a bare command string, apply_patch passes
    // a bare patch. Keep the string; the caller decides what it means.
    return { raw: trimmed };
  }
}

function extractCommand(input) {
  const value = input?.command ?? input?.cmd ?? input?.command_line ?? input?.script ?? input?.raw;
  if (Array.isArray(value)) {
    const parts = value.filter((part) => typeof part === "string");
    return parts.length ? parts.join(" ") : "";
  }
  return typeof value === "string" ? value : "";
}

function firstPath(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of PATH_KEYS) {
    if (typeof input[key] === "string" && input[key].trim()) return input[key];
  }
  return "";
}

function patchActions(input, { file, line, tool }) {
  const patch = typeof input?.patch === "string"
    ? input.patch
    : typeof input?.raw === "string"
      ? input.raw
      : typeof input?.input === "string"
        ? input.input
        : "";
  if (!patch) return null;

  const actions = [];
  const pattern = /^\*\*\* (?:Update|Add|Delete|Move to) File: (.+)$/gm;
  let match;
  while ((match = pattern.exec(patch))) {
    actions.push({ kind: "edit", target: match[1].trim(), tool, file, line });
  }
  return actions.length ? actions : null;
}

// Some Codex sessions run `apply_patch` through the shell heredoc. The patch
// text itself is deterministic, so those paths are safe to attribute.
export function patchTargets(command) {
  const text = String(command ?? "");
  if (!text.includes("*** ") || !/\*\*\* (?:Update|Add|Delete|Move to) File: /.test(text)) return [];
  const pattern = /^\*\*\* (?:Update|Add|Delete|Move to) File: (.+)$/gm;
  const targets = [];
  let match;
  while ((match = pattern.exec(text))) targets.push(match[1].trim());
  return [...new Set(targets)];
}

// A no-edit rule cannot see a file written through `echo > config/x` or
// `sed -i`. We do not guess the path from shell text: heredocs and embedded
// code make that noisy (verified on real Codex transcripts). Instead the report
// counts commands that look like writes and tells the user to add a no-run rule.
export function commandMayWrite(command) {
  const masked = maskQuoted(String(command ?? ""));
  if (/\btee\s+\S|\bsed\s+-i|\brm\s+\S/.test(masked)) return true;
  const redirect = /(?:^|\s)>{1,2}\s*([A-Za-z0-9._/\\~-]+)/g;
  return [...masked.matchAll(redirect)].some((match) => /[\\/]/.test(match[1]) || /\.[a-z0-9]{1,8}$/i.test(match[1]));
}

function maskQuoted(command) {
  let out = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote && command[index - 1] !== "\\") quote = null;
      out += " ";
    } else if (char === '"' || char === "'") {
      quote = char;
      out += " ";
    } else {
      out += char;
    }
  }
  return out;
}

// Some harnesses record the same call twice (request item + completed item).
// Collapse identical actions that sit next to each other, keep real repeats.
function dedupeAdjacent(actions) {
  const out = [];
  for (const action of actions) {
    const signature = `${action.kind}\u0000${action.target ?? ""}\u0000${action.command ?? ""}\u0000${action.tool}`;
    const recent = out.slice(-3).find((item) => {
      const other = `${item.kind}\u0000${item.target ?? ""}\u0000${item.command ?? ""}\u0000${item.tool}`;
      return other === signature && action.line - item.line <= 2;
    });
    if (!recent) out.push(action);
  }
  return out;
}
