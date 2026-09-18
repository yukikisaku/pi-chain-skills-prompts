import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-chain-skills-prompts-test-"));
  tempDirs.push(root);

  const promptPath = join(root, "review.md");
  const skillPath = join(root, "grill-me.md");
  writeFileSync(
    promptPath,
    `---\ndescription: review\n---\nPrompt body $ARGUMENTS`,
    "utf8",
  );
  writeFileSync(skillPath, "Skill body $1 / $@", "utf8");

  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const commands = [
    {
      name: "review",
      description: "Review",
      source: "prompt",
      sourceInfo: { path: promptPath, baseDir: root },
    },
    {
      name: "skill:grill-me",
      description: "Grill",
      source: "skill",
      sourceInfo: { path: skillPath, baseDir: root },
    },
  ];

  const pi = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getCommands() {
      return commands;
    },
  };

  extension(pi as any);
  return { handlers };
}

describe("extension registration", () => {
  it("registers exactly one input transform and one autocomplete setup path", async () => {
    const { handlers } = makeFixture();

    expect(handlers.get("input")).toHaveLength(1);
    expect(handlers.get("session_start")).toHaveLength(1);

    const addAutocompleteProvider = vi.fn();
    await handlers.get("session_start")![0](
      { reason: "startup" },
      { ui: { addAutocompleteProvider } },
    );

    expect(addAutocompleteProvider).toHaveBeenCalledTimes(1);
  });

  it("chains a prompt and a shorthand skill while preserving multiline whitespace", async () => {
    const { handlers } = makeFixture();
    const notify = vi.fn();
    const trailingText = "  first line\nsecond  line\n";

    const result = await handlers.get("input")![0](
      { text: `/review /grill-me ${trailingText}` },
      { ui: { notify } },
    );

    expect(result).toEqual({
      action: "transform",
      text: `Prompt body \n\nSkill body  / \n\n${trailingText}`,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
