// Rules come from two places, in this order:
//   1. an explicit `<!-- pactcheck ... -->` block, which is exact;
//   2. prose lines that contain a prohibition, an action verb and a code span.
// Anything that cannot be turned into a path or command check is reported as
// skipped instead of being guessed.

const NEGATIVE = /\b(never|do not|don't|must not|avoid)\b|不要|禁止|不得|不准|别/i;
const EDIT_INTENT = /\b(edit|modify|change|write|touch|overwrite)\b|修改|编辑|改动|写入|覆盖|不碰/i;
const RUN_INTENT = /\b(run|execute|invoke)\b|执行|运行|跑/i;

const SUPPORTED_KEYS = new Set(["no-edit", "no-run"]);

export function parseRules(text, { file = "AGENTS.md" } = {}) {
  const lines = String(text ?? "").split(/\r?\n/);
  const rules = [];
  const skipped = [];
  const seen = new Set();
  let inBlock = false;
  let blockStart = 0;
  let blockFound = false;

  const addRule = (rule) => {
    const key = `${rule.type}\u0000${rule.pattern.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({ id: `R${rules.length + 1}`, ...rule });
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!inBlock && /<!--\s*pactcheck\b/i.test(rawLine)) {
      inBlock = true;
      blockFound = true;
      blockStart = lineNumber;
      // Support the one-line form `<!-- pactcheck no-edit: x -->`.
      const inline = rawLine.match(/<!--\s*pactcheck\b(.*?)-->/i);
      if (inline) {
        inBlock = false;
        parseBlockLine(inline[1].trim(), lineNumber);
      }
      return;
    }

    if (inBlock) {
      if (rawLine.includes("-->")) {
        const beforeClose = rawLine.slice(0, rawLine.indexOf("-->")).trim();
        if (beforeClose) parseBlockLine(beforeClose, lineNumber);
        inBlock = false;
        return;
      }
      parseBlockLine(line, lineNumber);
      return;
    }

    parseProseLine(rawLine, lineNumber);
  });

  if (inBlock) {
    skipped.push({
      line: blockStart,
      text: "<!-- pactcheck",
      reason: "explicit block is not closed with -->",
    });
  }

  if (!blockFound) {
    // Not an error: prose-only files are supported. The count is surfaced in
    // the report so the user knows which mode ran.
  }

  return {
    file,
    rules,
    skipped,
    mode: blockFound ? "explicit+prose" : "prose",
  };

  function parseBlockLine(line, lineNumber) {
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^([a-z-]+)\s*:\s*(.+)$/i);
    if (!match) {
      skipped.push({ line: lineNumber, text: line, reason: "not a key: value rule" });
      return;
    }
    const key = match[1].toLowerCase();
    if (!SUPPORTED_KEYS.has(key)) {
      skipped.push({ line: lineNumber, text: line, reason: `unsupported key "${key}"` });
      return;
    }
    for (const value of splitValues(match[2])) {
      addRule({ type: key, pattern: value, origin: "explicit", line: lineNumber });
    }
  }

  function parseProseLine(rawLine, lineNumber) {
    const spans = [...rawLine.matchAll(/`([^`\n]+)`/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    if (!spans.length) return;

    // Keywords inside code spans are data, not instructions. Strip them first.
    const prose = rawLine.replace(/`[^`\n]*`/g, " ");
    const negative = NEGATIVE.test(prose);
    const editIntent = EDIT_INTENT.test(prose);
    const runIntent = RUN_INTENT.test(prose);

    if (!negative && !editIntent && !runIntent) return;

    if (!negative) {
      skipped.push({
        line: lineNumber,
        text: rawLine.trim(),
        reason: "not a prohibition (no never/do not/不要/禁止)",
      });
      return;
    }

    if (editIntent && runIntent) {
      skipped.push({
        line: lineNumber,
        text: rawLine.trim(),
        reason: "mentions both editing and running; split it into two lines",
      });
      return;
    }

    if (!editIntent && !runIntent) {
      skipped.push({
        line: lineNumber,
        text: rawLine.trim(),
        reason: "prohibition without a checkable action verb",
      });
      return;
    }

    let added = 0;
    for (const span of spans) {
      if (editIntent) {
        if (!looksLikePath(span)) {
          skipped.push({
            line: lineNumber,
            text: rawLine.trim(),
            reason: `code span "${span}" does not look like a path`,
          });
          continue;
        }
        addRule({ type: "no-edit", pattern: span, origin: "prose", line: lineNumber });
        added += 1;
      } else {
        addRule({ type: "no-run", pattern: span, origin: "prose", line: lineNumber });
        added += 1;
      }
    }

    if (!added) {
      skipped.push({
        line: lineNumber,
        text: rawLine.trim(),
        reason: "no usable path or command in the code spans",
      });
    }
  }
}

export function splitValues(value) {
  const out = [];
  let current = "";
  let inRegex = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    // A slash only opens a regex at the start of a token: `config/**` is a
    // path, `/rm -rf/` is a regex.
    if (char === "/" && !inRegex && current.trim() === "") {
      inRegex = true;
    } else if (char === "/" && inRegex && value[index - 1] !== "\\") {
      inRegex = false;
    }
    if (char === "," && !inRegex) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function looksLikePath(span) {
  return /[\\/]/.test(span) || /^\./.test(span) || /[*?{]/.test(span) || /\.[a-z0-9]{1,8}$/i.test(span);
}
