import test from "node:test";
import assert from "node:assert/strict";
import { actionsFromFile, commandMayWrite, patchTargets } from "../src/transcript.mjs";

const line = (value) => `${JSON.stringify(value)}\n`;

test("Claude Code tool_use blocks become edit, command and read actions", () => {
  const text =
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.mjs" } }] } }) +
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/a.mjs", old_string: "a", new_string: "b" } }] } }) +
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } });

  const result = actionsFromFile(text, { file: "s.jsonl" });
  assert.deepEqual(
    result.actions.map((action) => [action.kind, action.target ?? action.command]),
    [
      ["read", "src/a.mjs"],
      ["edit", "src/a.mjs"],
      ["command", "npm test"],
    ],
  );
  assert.equal(result.badLines.length, 0);
});

test("tool results do not create phantom actions", () => {
  const text = line({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "Edit config/policy.json\nBash: git push --force",
        },
      ],
    },
  });
  const result = actionsFromFile(text);
  assert.equal(result.actions.length, 0);
  assert.equal(result.unknownCalls.length, 0);
});

test("Codex function_call with a JSON string of arguments", () => {
  const text = line({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "shell",
      arguments: JSON.stringify({ command: ["bash", "-lc", "npm publish --access public"] }),
    },
  });
  const result = actionsFromFile(text);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, "command");
  assert.equal(result.actions[0].command, "bash -lc npm publish --access public");
});

test("Codex apply_patch yields one edit per file header", () => {
  const patch = "*** Begin Patch\n*** Update File: config/release.json\n@@\n-a\n+b\n*** Add File: src/new.mjs\n+export {}\n*** End Patch\n";
  const text = line({
    type: "response_item",
    payload: { type: "custom_tool_call", name: "apply_patch", input: patch },
  });
  const result = actionsFromFile(text);
  assert.deepEqual(result.actions.map((action) => action.target), ["config/release.json", "src/new.mjs"]);
});

test("Codex file_change items are edits", () => {
  const text = line({
    type: "item.completed",
    item: { type: "file_change", changes: [{ path: "src/index.mjs", kind: "update" }] },
  });
  const result = actionsFromFile(text);
  assert.deepEqual(result.actions.map((action) => [action.kind, action.target]), [["edit", "src/index.mjs"]]);
});

test("unknown tools are counted but not guessed", () => {
  const text = line({ type: "tool_call", tool: "web_search", input: { query: "agents.md" } });
  const result = actionsFromFile(text);
  assert.equal(result.actions.length, 0);
  assert.equal(result.unknownCalls.length, 1);
});

test("invalid JSON lines are reported, not skipped silently", () => {
  const text = `${line({ type: "assistant", message: { content: [] } })}{not json}\n`;
  const result = actionsFromFile(text);
  assert.deepEqual(result.badLines, [2]);
});

test("the same call recorded twice within two lines is collapsed", () => {
  const call = { type: "tool_call", tool: "shell", input: { command: "npm test" } };
  const text = `${line(call)}${line(call)}`;
  const result = actionsFromFile(text);
  assert.equal(result.actions.length, 1);
});

test("commands that look like writes are flagged, not attributed to a path", () => {
  assert.equal(commandMayWrite("echo '{}' > config/policy.json"), true);
  assert.equal(commandMayWrite("rm -rf config/cache"), true);
  assert.equal(commandMayWrite("sed -i 's/a/b/' src/app.mjs"), true);
  assert.equal(commandMayWrite('git commit -m "fix > bug"'), false);
  assert.equal(commandMayWrite("npm test"), false);
});

test("a heredoc body does not turn a read into an edit", () => {
  const text = line({
    type: "tool_call",
    tool: "exec_command",
    input: { command: "python - <<'PY'\nif a > b:\n  print('x')\nPY" },
  });
  const result = actionsFromFile(text);
  assert.equal(result.actions.filter((action) => action.kind === "edit").length, 0);
});

test("apply_patch run through the shell contributes its file headers", () => {
  const command = "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: config/release.json\n@@\n-a\n+b\n*** End Patch\nPATCH";
  assert.deepEqual(patchTargets(command), ["config/release.json"]);

  const text = line({ type: "tool_call", tool: "exec_command", input: { command } });
  const result = actionsFromFile(text);
  assert.deepEqual(result.actions.filter((action) => action.kind === "edit").map((action) => action.target), ["config/release.json"]);
});

test("ordinary commands are not flagged as writes", () => {
  assert.equal(commandMayWrite("rg --files -g 'AGENTS.md'"), false);
  assert.equal(commandMayWrite("node -e \"if (a > b) console.log('x')\""), false);
});
