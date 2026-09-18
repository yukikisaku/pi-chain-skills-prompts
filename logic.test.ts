import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  parseCombinedInput,
  stripFrontmatter,
  substituteArgs,
  buildCombinedContent,
  isCombinableSource,
  resolveCommandName,
  resolveCommand,
} from "./logic.js";

// ─── parseCombinedInput ───

describe("parseCombinedInput", () => {
  it("単一のプロンプトテンプレートは結合とみなさず null を返す", () => {
    expect(parseCombinedInput("/review")).toBeNull();
  });

  it("単一のスキルコマンドは結合とみなさず null を返す", () => {
    expect(parseCombinedInput("/skill:search")).toBeNull();
  });

  it("スラッシュで始まらない入力は null を返す", () => {
    expect(parseCombinedInput("hello world")).toBeNull();
  });

  it("/cmd1 /cmd2 の2つを解析できる", () => {
    const result = parseCombinedInput("/review /refactor");
    expect(result).toEqual({
      commands: ["review", "refactor"],
      trailingText: "",
    });
  });

  it("/cmd1 /cmd2 /cmd3 の3つを解析できる", () => {
    const result = parseCombinedInput("/review /refactor /pi-docs");
    expect(result).toEqual({
      commands: ["review", "refactor", "pi-docs"],
      trailingText: "",
    });
  });

  it("末尾テキストを trailingText として取得できる", () => {
    const result = parseCombinedInput(
      "/opencode-docs /review Tailwind CSS について"
    );
    expect(result).toEqual({
      commands: ["opencode-docs", "review"],
      trailingText: "Tailwind CSS について",
    });
  });

  it("skill:プレフィックスのコマンドも解析できる", () => {
    const result = parseCombinedInput("/review /skill:search");
    expect(result).toEqual({
      commands: ["review", "skill:search"],
      trailingText: "",
    });
  });

  it("skill:プレフィックスだけの組み合わせも動く", () => {
    const result = parseCombinedInput("/skill:search /skill:grill-me");
    expect(result).toEqual({
      commands: ["skill:search", "skill:grill-me"],
      trailingText: "",
    });
  });

  it("skill + template の混在も動く", () => {
    const result = parseCombinedInput("/skill:search /pi-docs 質問内容");
    expect(result).toEqual({
      commands: ["skill:search", "pi-docs"],
      trailingText: "質問内容",
    });
  });

  it("テンプレートとskillを織り交ぜても動く", () => {
    const result = parseCombinedInput("/review /skill:search /refactor 引数");
    expect(result).toEqual({
      commands: ["review", "skill:search", "refactor"],
      trailingText: "引数",
    });
  });

  it("引数なしの2つだけの場合", () => {
    const result = parseCombinedInput("/add-comments /ask-user-question");
    expect(result).toEqual({
      commands: ["add-comments", "ask-user-question"],
      trailingText: "",
    });
  });

  it("ハイフン付きコマンド名を解析できる", () => {
    const result = parseCombinedInput("/add-comments /ask-user-question");
    expect(result).toEqual({
      commands: ["add-comments", "ask-user-question"],
      trailingText: "",
    });
  });

  it("skill:ハイフン付きも解析できる", () => {
    const result = parseCombinedInput("/skill:grill-me /skill:search-query");
    expect(result).toEqual({
      commands: ["skill:grill-me", "skill:search-query"],
      trailingText: "",
    });
  });

  it("末尾テキストにスラッシュが含まれる場合は2つ目のコマンドとして扱わない", () => {
    // "React/Vue を比較" のようなケース
    // 最初の連続する /xxx だけをコマンドとしてパースする
    const result = parseCombinedInput("/review src/components/App.tsx");
    // src/components は / で始まらないので trailingText 扱い
    expect(result).toBeNull(); // 1つだけなので結合ではない
  });

  it("空白が多い場合でも正しくパースする", () => {
    const result = parseCombinedInput("/review  /refactor");
    expect(result).toEqual({
      commands: ["review", "refactor"],
      trailingText: "",
    });
  });

  it("複数行の末尾本文を原文どおり保持する", () => {
    const trailingText = "1行目\n2行目\n\n4行目\n";
    const result = parseCombinedInput(`/review /refactor ${trailingText}`);

    expect(result?.trailingText).toBe(trailingText);
  });

  it("コードブロック内の改行と空白を原文どおり保持する", () => {
    const trailingText = "```ts\nconst value = \"a  b\";\n  console.log(value);\n```\n";
    const result = parseCombinedInput(`/review /refactor ${trailingText}`);

    expect(result?.trailingText).toBe(trailingText);
  });

  it("本文先頭と本文中の連続空白を原文どおり保持する", () => {
    const trailingText = "  先頭に空白\n単語の  間にも空白";
    const result = parseCombinedInput(`/review /refactor ${trailingText}`);

    expect(result?.trailingText).toBe(trailingText);
  });

  it("skill: を省略したコマンド列を解析できる", () => {
    expect(parseCombinedInput("/grill-me /search-pi-package 本文")).toEqual({
      commands: ["grill-me", "search-pi-package"],
      trailingText: "本文",
    });
  });
});

// ─── stripFrontmatter ───

describe("stripFrontmatter", () => {
  it("frontmatter付きの.mdから本文だけを取り出す", () => {
    const input = `---
description: コードレビュー
argument-hint: "<ファイル名>"
---
コードをレビューしてください`;
    expect(stripFrontmatter(input)).toBe("コードをレビューしてください");
  });

  it("frontmatterなしの.mdはそのまま返す", () => {
    const input = "コードをレビューしてください";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("複数行のfrontmatterを処理できる", () => {
    const input = `---
description: テスト
author: me
---

本文内容`;
    expect(stripFrontmatter(input)).toBe("本文内容");
  });

  it("空のfrontmatterも処理できる", () => {
    const input = `---
---

本文`;
    expect(stripFrontmatter(input)).toBe("本文");
  });
});

// ─── substituteArgs ───

describe("substituteArgs", () => {
  it("$ARGUMENTS を置換する", () => {
    const template = "質問に答えて: $ARGUMENTS";
    expect(substituteArgs(template, "Tailwind")).toBe(
      "質問に答えて: Tailwind"
    );
  });

  it("$@ を置換する", () => {
    const template = "レビューして: $@";
    expect(substituteArgs(template, "Button.tsx")).toBe("レビューして: Button.tsx");
  });

  it("$1, $2 を置換する", () => {
    const template = "$1と$2を比較して";
    // trailingText はスペース区切りで引数分割
    expect(substituteArgs(template, "React Vue")).toBe(
      "ReactとVueを比較して"
    );
  });

  it("引数なしの場合は $ARGUMENTS と $@ が空になる", () => {
    const template = "レビューして$@";
    expect(substituteArgs(template, "")).toBe("レビューして");
  });

  it("引数なしの場合は $1 が空になる", () => {
    const template = "$1をレビュー";
    expect(substituteArgs(template, "")).toBe("をレビュー");
  });

  it("${@:N} を置換する", () => {
    const template = "最初の引数: ${@:1}";
    expect(substituteArgs(template, "React Vue")).toBe("最初の引数: React Vue");
  });

  it("${@:N:L} を置換する", () => {
    const template = "引数: ${@:1:1}";
    expect(substituteArgs(template, "React Vue Svelte")).toBe(
      "引数: React"
    );
  });

  it("$ARGUMENTS がないテンプレートは変更されない", () => {
    const template = "コードをレビューしてください";
    expect(substituteArgs(template, "引数")).toBe("コードをレビューしてください");
  });
});

// ─── buildCombinedContent ───

describe("buildCombinedContent", () => {
  it("複数のパートを \\n\\n で結合する", () => {
    const parts = ["パート1", "パート2", "パート3"];
    expect(buildCombinedContent(parts)).toBe(
      "パート1\n\nパート2\n\nパート3"
    );
  });
});

// ─── isCombinableSource ───

describe("isCombinableSource", () => {
  it("prompt は結合可能", () => {
    expect(isCombinableSource("prompt")).toBe(true);
  });

  it("skill は結合可能", () => {
    expect(isCombinableSource("skill")).toBe(true);
  });

  it("extension は結合不可", () => {
    expect(isCombinableSource("extension")).toBe(false);
  });

  it("builtin は結合不可", () => {
    expect(isCombinableSource("builtin")).toBe(false);
  });
});

// ─── resolveCommandName ───

describe("resolveCommandName", () => {
  const commandNames = ["review", "refactor", "skill:search-pi-package", "skill:grill-me"];

  it("完全一致する名前を返す", () => {
    expect(resolveCommandName("review", commandNames)).toBe("review");
  });

  it("skill: プレフィックスありの名前をそのまま返す", () => {
    expect(resolveCommandName("skill:grill-me", commandNames)).toBe("skill:grill-me");
  });

  it("skill: プレフィックスなしの名前を解決する", () => {
    expect(resolveCommandName("search-pi-package", commandNames)).toBe("skill:search-pi-package");
  });

  it("grill-me も skill: 付きに解決する", () => {
    expect(resolveCommandName("grill-me", commandNames)).toBe("skill:grill-me");
  });

  it("存在しない名前は null を返す", () => {
    expect(resolveCommandName("notexist", commandNames)).toBeNull();
  });

  it("skill: 付きで存在する名前のプレフィックスなしは解決する", () => {
    expect(resolveCommandName("search-pi-package", commandNames)).toBe("skill:search-pi-package");
  });
});

// ─── resolveCommand ───

describe("resolveCommand", () => {
  const commands = [
    { name: "review", source: "prompt" },
    { name: "skill:grill-me", source: "skill" },
  ];

  it("実行と入力補完で使う共通処理がskill省略名を解決する", () => {
    expect(resolveCommand("grill-me", commands)).toBe(commands[1]);
  });

  it("完全名も同じコマンドへ解決する", () => {
    expect(resolveCommand("skill:grill-me", commands)).toBe(commands[1]);
  });
});

// ─── Integration: real prompt files ───

describe("integration: real prompt files", () => {
  const promptsDir = resolve(homedir(), ".pi/agent/prompts");
  const piDocsPath = resolve(promptsDir, "pi-docs.md");
  const combinedPromptPaths = [
    piDocsPath,
    resolve(promptsDir, "warp-docs.md"),
  ];

  it.skipIf(!existsSync(piDocsPath))(
    "実際のプロンプトファイルを frontmatter 除去して読める",
    () => {
      const body = stripFrontmatter(readFileSync(piDocsPath, "utf-8")).trim();
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toContain("description:");
      expect(body).not.toContain("argument-hint:");
    }
  );

  it.skipIf(!existsSync(piDocsPath))(
    "実際のプロンプトファイルで $ARGUMENTS をクリアできる",
    () => {
      const body = stripFrontmatter(readFileSync(piDocsPath, "utf-8")).trim();
      const result = substituteArgs(body, "");
      expect(result).not.toContain("$ARGUMENTS");
    }
  );

  it.skipIf(!combinedPromptPaths.every(existsSync))(
    "2つのプロンプトを結合できる（trailingText は末尾に1回）",
    () => {
      const parts = combinedPromptPaths.map((filePath) =>
        stripFrontmatter(readFileSync(filePath, "utf-8")).trim()
      );
      const combined = buildCombinedContent(parts);
      expect(combined).toContain("\n\n");
    }
  );
});
