// Path globs are matched case-insensitively: transcripts come from Windows and
// POSIX runs, and a rule written as `config/**` must hit `Config\\x.json` too.

export function normalizePath(value) {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase()
}

// A rule written as `config/` means the directory and everything under it.
// A bare `secrets` is treated the same way when it has no file extension.
export function expandPathPattern(pattern) {
  let base = normalizePath(pattern.trim());
  if (!base) return [];
  if (base.endsWith("/")) base += "**";
  const expanded = [base];
  const looksLikeDir = !/[*?{[\]]/.test(base) && !/\.[^/]+$/.test(base);
  if (looksLikeDir) expanded.push(`${base}/**`);
  return [...new Set(expanded)];
}

export function globToRegExp(pattern) {
  const source = normalizePath(pattern.trim());
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "*" && source[index + 1] === "*") {
      index += 2;
      if (source[index] === "/") {
        out += "(?:.*/)?";
        index += 1;
      } else {
        out += ".*";
      }
      continue;
    }

    if (char === "*") {
      out += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      index += 1;
      continue;
    }

    if (char === "{") {
      const end = source.indexOf("}", index);
      if (end > index) {
        const choices = source
          .slice(index + 1, end)
          .split(",")
          .map((choice) => escapeRegExp(choice.trim()))
          .join("|");
        out += `(?:${choices})`;
        index = end + 1;
        continue;
      }
    }

    out += escapeRegExp(char);
    index += 1;
  }

  return new RegExp(`^${out}$`);
}

export function matchesPath(pattern, value) {
  if (!pattern || !value) return false;
  const target = normalizePath(value);
  return expandPathPattern(pattern).some((candidate) => globToRegExp(candidate).test(target));
}

// Commands are compared as normalized whitespace. A rule wrapped in slashes is
// a regular expression; everything else is a case-insensitive substring.
export function commandMatcher(pattern) {
  const raw = String(pattern).trim();
  const regexForm = raw.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexForm) {
    const flags = regexForm[2].includes("i") ? regexForm[2] : `${regexForm[2]}i`;
    const regex = new RegExp(regexForm[1], flags);
    return (command) => regex.test(String(command));
  }

  const needle = normalizeCommand(raw);
  if (!needle) return () => false;
  return (command) => normalizeCommand(command).includes(needle);
}

export function normalizeCommand(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
