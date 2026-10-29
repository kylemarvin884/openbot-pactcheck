# pactcheck

**检查 agent 有没有真的照 AGENTS.md / CLAUDE.md 做。** 读一份已有的会话 transcript，把「不要改 config」「不要执行 git push --force」这类规则和实际发生的编辑、命令逐条对账。零模型、零网络、零依赖。

```bash
git clone https://github.com/kylemarvin884/openbot-pactcheck
cd openbot-pactcheck
node src/cli.mjs fixtures/session-bad.jsonl --rules fixtures/AGENTS.md
```

真实输出（2026-10-30，Windows，Node 24.19）：

```text
pactcheck 0.1.0

rules       fixtures\AGENTS.md  (5 checkable, 1 skipped)
transcript  fixtures\session-bad.jsonl  6 actions (3 edit, 2 command, 1 read)

VIOLATION no-edit    config/**  (1 hit)
           config/policy.json  (Edit, fixtures\session-bad.jsonl:5)
ok        no-edit    .env*  (0 hits)
VIOLATION no-run     git push --force  (1 hit)
           git push --force origin main  (Bash, fixtures\session-bad.jsonl:6)
ok        no-run     npm publish  (0 hits)
VIOLATION no-edit    secrets/  (1 hit)
           secrets/deploy-token.txt  (Write, fixtures\session-bad.jsonl:7)

skipped 1 line(s) that are not machine-checkable (--explain to list)

3 violations / 5 rules checked -> exit 1
```

`npm run demo` 会依次跑「违规会话 / 合规会话 / Codex 会话」三个 fixture。

## 为什么做这个

规则文件已经是事实标准，但「这次会话到底有没有违反」没有答案：

- HN 486 分：`Claude Code reads AGENTS.md only when telemetry is on [fixed]` — 规则有没有被加载都可能不确定。https://news.ycombinator.com/item?id=49814947
- HN 837 分：`AGENTS.md – Open format for guiding coding agents` — 写规则的人足够多。https://news.ycombinator.com/item?id=44957443
- `anthropics/claude-code#28469`（open）：标题里直接写 `ignored instructions`。https://github.com/anthropics/claude-code/issues/28469

现有工具在检查「规则写得好不好」（如 agnix 的 lint），或者在 sandbox 里重跑一遍 agent 再打分（如 ruleProb）。
pactcheck 只回答一个更小的问题：**这一份已经发生的 transcript，违反了哪几条可机器校验的规则。**

## 规则从哪来

### 1. 显式块（推荐，精确、可评审）

```md
<!-- pactcheck
no-edit: config/**, .env*
no-run: git push --force, /^npm publish/
-->
```

- `no-edit`：glob，匹配编辑动作的目标路径。`config/` 等于 `config/**`；`**` 跨目录；大小写不敏感，兼容 Windows 反斜杠。
- `no-run`：命令子串（忽略大小写与多余空白）；用 `/.../` 包裹则是正则。
- 逗号分隔多条；正则里的逗号不会被拆开。

### 2. 自然语言（尽力而为，推导不出的明确标 skipped）

只有一行同时满足三个条件才会变成规则：

1. 有否定词：`不要 / 禁止 / 不得 / never / do not / don't`
2. 有动作词：`修改 / 编辑 / 写入 / edit / modify / write` 或 `执行 / 运行 / run / execute`
3. 有反引号包住的路径或命令

```md
不要修改 `src/core/**`。
Never run `git push --force`.
```

「Only run `npm test` after every change」是正向要求，不会被猜成禁令；`--explain` 会打印每一行被跳过的原因。一行同时提到修改和执行时直接跳过，要求你拆成两行——不做模糊判断。

## 用法

```bash
# 单个文件
node src/cli.mjs ~/.claude/projects/<project>/<session>.jsonl --rules AGENTS.md

# 整个目录（递归找 *.jsonl）
node src/cli.mjs ~/.codex/sessions --rules AGENTS.md --json

# CI / 会话结束钩子：允许 0 条违规（默认），超了就 exit 1
node src/cli.mjs session.jsonl --rules AGENTS.md --max-violations 0
```

| 选项 | 作用 |
| --- | --- |
| `--rules <file\|dir>` | 规则文件；目录会读取其中的 `.md` / `.mdc`。默认依次找 `AGENTS.md`、`CLAUDE.md` |
| `--json` | 机器可读结果，含每条规则的命中、跳过的行、未识别工具调用数 |
| `--explain` | 列出被跳过的行和原因 |
| `--max-violations <n>` | 允许的违规条数，默认 0 |

退出码：`0` 通过，`1` 有违规，`2` 用法或解析错误。

## 支持的 transcript

每行一个 JSON 对象（JSONL）。已覆盖三种形态：

- **Claude Code**：`message.content[]` 里的 `tool_use`，工具名 `Edit` / `Write` / `MultiEdit` / `Read` / `Bash`。
- **Codex**：`function_call`（`shell` / `exec_command`）、`item.completed` 的 `file_change`、`apply_patch`，以及通过 shell 执行的 `apply_patch <<'PATCH'`。
- **通用**：`{ "type": "tool_call", "tool": "...", "input": {...} }`。

不认识的工具会被计数（报告里的 `note:`），不会猜成编辑或命令。坏行也会计数，不会静默跳过。

## 三个真实用例

1. **CI 门禁**：把团队自己的 agent 会话产物（例如 nightly agent 的 JSONL）在合并前跑一遍，违反 `no-edit migrations/**` 就拦下。
2. **会话结束钩子**：在 agent 收尾时跑一次，把「它说做完了」和「它实际改了什么」对上；报告里能直接看到文件路径和 transcript 行号。
3. **审计别人的会话**：同事把 `session.jsonl` 贴进 issue 之前，先确认里面没有违反 `no-edit .env*` 的动作，也没有把密钥文件写进仓库。

## 它不检查什么

这一节比上面的功能更重要：

- **不判断规则写得好不好**，也不评价回答质量。那是 lint 和 eval 的事。
- **不从 shell 命令里猜写入路径**。`echo x > config/a.json`、`sed -i`、`rm` 只在报告里提示「看起来会写文件」，不会算成 `no-edit` 命中——在真实 Codex 会话上验证过，从 heredoc 和嵌入代码里抽路径误报太多，所以选择不猜。要对这类命令设限，写 `no-run` 规则。
- **不拦截实时动作**。它读的是已经落盘的 transcript，不是沙箱，也不是权限系统。
- **不覆盖所有工具**。只认编辑 / 命令 / 读取三类；MCP 自定义工具需要是这三种语义之一才会被识别。
- **不证明规则被加载过**。transcript 里没有这条信息；工具只对「实际发生的行为」下结论。

## 设计取舍

- **零依赖**：只用 Node 22+ 内置模块，没有 `npm install`。
- **只读**：不修改 transcript，不读取规则文件和 transcript 之外的文件，不上传。
- **可复现**：没有模型调用，同一份输入永远得到同一份输出。
- **宁可漏报**：解析不确定就标 `skipped` 或 `unsupported`，不用模糊匹配凑命中率。

## 开发

```bash
npm test     # node --test，38 条测试
npm run demo # 三个 fixture 的完整输出
```

## License

MIT
