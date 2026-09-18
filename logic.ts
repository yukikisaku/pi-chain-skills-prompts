// ─── parseCombinedInput ───
// "/cmd1 /cmd2 trailing text" → { commands: ["cmd1", "cmd2"], trailingText: "trailing text" }
// 単一コマンド（/cmd）の場合は null を返す（結合ではないため）

export interface ParsedInput {
  commands: string[];
  trailingText: string;
}

export function parseCombinedInput(text: string): ParsedInput | null {
  // スラッシュで始まらない場合は対象外
  if (!text.startsWith("/")) return null;

  const commands: string[] = [];
  let cursor = 0;
  let trailingText = "";

  while (cursor < text.length && text[cursor] === "/") {
    const commandStart = cursor + 1;
    cursor = commandStart;

    while (cursor < text.length && !/\s/.test(text[cursor])) {
      cursor++;
    }
    commands.push(text.slice(commandStart, cursor));

    if (cursor >= text.length) break;

    const separatorStart = cursor;
    while (cursor < text.length && /\s/.test(text[cursor])) {
      cursor++;
    }

    if (cursor >= text.length) break;
    if (text[cursor] === "/") continue;

    // コマンドと本文の区切り1文字だけを除き、本文側の空白はそのまま残す。
    // CRLF は1つの改行として扱う。
    const separatorLength =
      text[separatorStart] === "\r" && text[separatorStart + 1] === "\n"
        ? 2
        : 1;
    trailingText = text.slice(separatorStart + separatorLength);
    break;
  }

  // コマンドが1つだけの場合は結合ではない
  if (commands.length < 2) return null;

  return { commands, trailingText };
}

// ─── stripFrontmatter ───
// YAML frontmatter (--- で囲まれた部分) を除去する

export function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return normalized;
  const body = normalized.slice(endIndex + 4).trim();
  return body;
}

// ─── substituteArgs ───
// テンプレート内の $ARGUMENTS, $@, $1, $2, ${@:N}, ${@:N:L} を置換する
// Pi本体の実装と同じロジック

export function substituteArgs(content: string, argsText: string): string {
  let result = content;

  if (!argsText) {
    // 引数なしの場合は $ARGUMENTS と $@ を空文字に置換
    result = result.replace(/\$ARGUMENTS/g, "");
    result = result.replace(/\$@/g, "");
    result = result.replace(/\$(\d+)/g, "");
    result = result.replace(/\$\{@:\d+(?::\d+)?\}/g, "");
    return result;
  }

  const args = parseCommandArgs(argsText);
  const allArgs = args.join(" ");

  // $1, $2, ... を先に置換（再帰置換を防ぐため）
  result = result.replace(/\$(\d+)/g, (_, num) => {
    const index = parseInt(num, 10) - 1;
    return args[index] ?? "";
  });

  // ${@:start} または ${@:start:length} を置換（$@ の前に処理）
  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr, lengthStr) => {
    let start = parseInt(startStr, 10) - 1; // 1-indexed → 0-indexed
    if (start < 0) start = 0;
    if (lengthStr) {
      const length = parseInt(lengthStr, 10);
      return args.slice(start, start + length).join(" ");
    }
    return args.slice(start).join(" ");
  });

  // $ARGUMENTS を置換
  result = result.replace(/\$ARGUMENTS/g, allArgs);

  // $@ を置換
  result = result.replace(/\$@/g, allArgs);

  return result;
}

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }

  return args;
}

// ─── buildCombinedContent ───
// 複数のパートを \n\n で結合する
// trailingText は既に substituteArgs で各テンプレートの $ARGUMENTS に置換済みなので
// ここでは追加しない

export function buildCombinedContent(parts: string[]): string {
  return parts.join("\n\n");
}

// ─── isCombinableSource ───
// template と skill だけ結合可能

export function isCombinableSource(source: string): boolean {
  return source === "prompt" || source === "skill";
}

// ─── resolveCommandName ───
// skill: プレフィックスなしの名前も解決する
// "search-pi-package" → "skill:search-pi-package"
// "review" → "review"
// "skill:grill-me" → "skill:grill-me" (そのまま)

export function resolveCommandName(
  name: string,
  commandNames: string[]
): string | null {
  // 完全一致
  if (commandNames.includes(name)) return name;
  // skill: プレフィックスなしで一致するか
  const withPrefix = `skill:${name}`;
  if (commandNames.includes(withPrefix)) return withPrefix;
  return null;
}

// 実行処理と入力補完で同じ省略名解決を使うための共通関数
export function resolveCommand<T extends { name: string }>(
  name: string,
  commands: readonly T[]
): T | null {
  const resolvedName = resolveCommandName(
    name,
    commands.map((command) => command.name)
  );
  if (!resolvedName) return null;
  return commands.find((command) => command.name === resolvedName) ?? null;
}

// ─── CommandEntry ───
// pi.getCommands() の結果から必要な情報を抽出した型

export interface CommandEntry {
  name: string;
  source: string;
  path: string;
  baseDir: string;
}
