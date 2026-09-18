// pi-chain-skills-prompts: 複数の prompt template / skill を結合する extension
//
// 構文: /templateA /templateB /skill:foo 末尾テキスト
// - template と skill だけ結合対象
// - $ARGUMENTS / $1 / $@ はクリアして結合後末尾に1回追加
// - エラー時は通知して送信しない

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  parseCombinedInput,
  stripFrontmatter,
  substituteArgs,
  buildCombinedContent,
  isCombinableSource,
  resolveCommand,
  type CommandEntry,
} from "./logic.ts";

export default function (pi: ExtensionAPI) {
  // ─── inputイベント: 複数プロンプト/スキルを結合 ───
  pi.on("input", async (event, ctx) => {
    const parsed = parseCombinedInput(event.text);
    if (!parsed) return { action: "continue" };

    const { commands: commandNames, trailingText } = parsed;
    const allCommands = pi.getCommands();

    // 各コマンド名を解決（skill: プレフィックスなしでも可）
    const entries: CommandEntry[] = [];
    for (const name of commandNames) {
      const cmd = resolveCommand(name, allCommands);
      if (!cmd) {
        ctx.ui.notify(`コマンド "${name}" が見つかりません`, "error");
        return { action: "handled" };
      }
      if (!isCombinableSource(cmd.source)) {
        // 結合不可のコマンドが混ざっていたら Pi 本体に任せる
        return { action: "continue" };
      }
      if (!cmd.sourceInfo?.path) {
        ctx.ui.notify(`コマンド "${name}" のパスが取得できません`, "error");
        return { action: "handled" };
      }
      entries.push({
        name: cmd.name,
        source: cmd.source,
        path: cmd.sourceInfo.path,
        baseDir: cmd.sourceInfo.baseDir ?? dirname(cmd.sourceInfo.path),
      });
    }

    // .md ファイルを読んで frontmatter 除去 + $ARGUMENTS クリア
    const parts: string[] = [];
    for (const entry of entries) {
      try {
        const raw = readFileSync(entry.path, "utf-8");
        const body = stripFrontmatter(raw).trim();
        const cleaned = substituteArgs(body, ""); // $ARGUMENTS を空文字に
        parts.push(cleaned);
      } catch (err) {
        ctx.ui.notify(
          `コマンド "${entry.name}" の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
        return { action: "handled" };
      }
    }

    // 結合後に trailingText を末尾に1回追加
    let combined = buildCombinedContent(parts);
    if (trailingText) {
      combined += "\n\n" + trailingText;
    }
    return { action: "transform", text: combined };
  });

  // ─── addAutocompleteProvider: 2つ目以降の / で template + skill を候補出し ───
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const currentLine = lines[cursorLine] || "";
        const textBeforeCursor = currentLine.slice(0, cursorCol);

        // 行が / で始まらない → 委譲
        if (!textBeforeCursor.startsWith("/")) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }

        // スペースがない → 1つ目のコマンド入力中 → 委譲
        const firstSpaceIdx = textBeforeCursor.indexOf(" ");
        if (firstSpaceIdx === -1) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }

        // 最初のコマンド名
        const firstName = textBeforeCursor.slice(1, firstSpaceIdx);

        // 1つ目が結合可能かチェック
        const allCommands = pi.getCommands();
        const firstCmd = resolveCommand(firstName, allCommands);
        if (!firstCmd || !isCombinableSource(firstCmd.source)) {
          // 結合不可 → 候補を出さない
          return null;
        }

        // 最後のトークンが / で始まるか？
        const tokens = textBeforeCursor.split(/\s+/);
        const lastToken = tokens[tokens.length - 1];
        if (!lastToken || !lastToken.startsWith("/")) {
          // カーソルが引数部分にある → 補完不要
          return null;
        }

        const secondPrefix = lastToken.slice(1); // / を除去

        // template + skill のみ候補に出す
        // skill: プレフィックスなしでもマッチするように
        const combinableCommands = allCommands.filter((c) =>
          isCombinableSource(c.source)
        );
        const filtered = combinableCommands
          .filter((c) => {
            const name = c.name.toLowerCase();
            const prefix = secondPrefix.toLowerCase();
            // 完全マッチ
            if (name.startsWith(prefix)) return true;
            // skill: プレフィックスを外してマッチ
            if (name.startsWith("skill:") && name.slice(6).startsWith(prefix)) return true;
            return false;
          })
          .map((c) => ({
            value: c.name,
            label: c.name.startsWith("skill:") ? c.name.slice(6) + ` (${c.name})` : c.name,
            description: c.description || undefined,
          }));

        if (filtered.length === 0) return null;

        return {
          items: filtered,
          prefix: lastToken, // "/re" のように / 含む
        };
      },

      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        // prefix は "/search-p" のように / 含む
        // item.value は "skill:search-pi-package" または "review" のような完全なコマンド名
        // 補完後は "/skill:search-pi-package " または "/review " になる
        const currentLine = lines[cursorLine] || "";
        const before = currentLine.slice(0, cursorCol - prefix.length);
        const after = currentLine.slice(cursorCol);
        const newLine = `${before}/${item.value} ${after}`;
        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: before.length + item.value.length + 2, // / + value + space
        };
      },

      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      },
    }));
  });
}
