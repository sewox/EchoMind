import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Every `invoke("command", { ... })` in the app must use the argument names
 * the Rust command declares (Tauri maps `meeting_id` to `meetingId`).
 * Component tests mock `invoke`, so a wrong name passes them and fails only
 * in the real app: renaming a meeting silently did nothing because the page
 * sent `meetingId` to a command that took `id`.
 */

const ROOT = join(__dirname, "..");

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}

/** Index of the bracket that closes the one at `open`. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** Splits at commas outside any brackets. */
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if ("<({[".includes(c)) depth++;
    if (">)}]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const camel = (name: string) =>
  name.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// Arguments Tauri fills in itself.
const INJECTED = /AppHandle|State<|Window|Webview|ipc::Request|ipc::Channel/;

type Param = { name: string; optional: boolean };

function rustCommands(): Map<string, Param[]> {
  const commands = new Map<string, Param[]>();
  for (const file of files(join(ROOT, "src-tauri", "src"), /\.rs$/)) {
    const text = readFileSync(file, "utf8");
    const attr = /#\[tauri::command[^\]]*\]/g;
    let m: RegExpExecArray | null;
    while ((m = attr.exec(text))) {
      const fn = /fn\s+(\w+)\s*(?:<[^(]*>)?\s*\(/.exec(text.slice(m.index));
      if (!fn) continue;
      const open = m.index + fn.index + fn[0].length - 1;
      const params = topLevel(text.slice(open + 1, closing(text, open)))
        .map((p) => p.split(/:(.*)/s))
        .filter(([, type]) => type && !INJECTED.test(type))
        .map(([name, type]) => ({
          name: camel(name.replace(/^mut\s+/, "").trim()),
          optional: type.trim().startsWith("Option<"),
        }));
      commands.set(fn[1], params);
    }
  }
  return commands;
}

type Call = { file: string; command: string; keys: string[] | null };

/** `keys` is null when the arguments are not an object literal. */
function invokeCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of files(join(ROOT, "src"), /\.tsx?$/)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const re = /\binvoke(?:<[^()]*?>)?\(\s*"(\w+)"\s*(,?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const rel = file.slice(ROOT.length + 1);
      if (!m[2]) {
        calls.push({ file: rel, command: m[1], keys: [] });
        continue;
      }
      const start =
        re.lastIndex + (/^\s*/.exec(text.slice(re.lastIndex))?.[0].length ?? 0);
      if (text[start] !== "{") {
        calls.push({ file: rel, command: m[1], keys: null });
        continue;
      }
      const body = text.slice(start + 1, closing(text, start));
      const keys = topLevel(body)
        .filter((entry) => !entry.startsWith("..."))
        .map((entry) => /^["']?(\w+)/.exec(entry)?.[1] ?? "");
      calls.push({ file: rel, command: m[1], keys });
    }
  }
  return calls;
}

// Arguments the page sends that the command ignores on purpose.
const IGNORED_EXTRAS: Record<string, string[]> = {
  // The backend reads the segments from the stored meeting.
  generate_meeting_summary: ["segments"],
};

describe("Tauri command arguments", () => {
  const commands = rustCommands();
  const calls = invokeCalls();

  it("finds the commands and the calls", () => {
    expect(commands.size).toBeGreaterThan(50);
    expect(calls.length).toBeGreaterThan(50);
    expect(commands.get("update_meeting_title")).toEqual([
      { name: "meetingId", optional: false },
      { name: "newTitle", optional: false },
    ]);
  });

  it("every invoked command exists", () => {
    const unknown = calls
      .filter((c) => !commands.has(c.command))
      .map((c) => `${c.file}: ${c.command}`);
    expect(unknown).toEqual([]);
  });

  it("every call sends the arguments its command takes", () => {
    const problems: string[] = [];
    for (const call of calls) {
      const params = commands.get(call.command);
      if (!params || call.keys === null) continue;
      const names = new Set(params.map((p) => p.name));
      const missing = params
        .filter((p) => !p.optional && !call.keys!.includes(p.name))
        .map((p) => p.name);
      const ignored = IGNORED_EXTRAS[call.command] ?? [];
      const extra = call.keys.filter(
        (k) => !names.has(k) && !ignored.includes(k),
      );
      if (missing.length || extra.length)
        problems.push(
          `${call.file}: ${call.command} missing [${missing}] unknown [${extra}]`,
        );
    }
    expect(problems).toEqual([]);
  });
});
