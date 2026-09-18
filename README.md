# pi-chain-skills-prompts

Chain multiple Pi prompt templates and skills into one prompt while preserving the text that follows the command chain.

## Requirements

- Pi with prompt templates and/or skills available as slash commands.
- Node.js 20 or newer when running the package's development checks.

The extension uses Pi's public extension API and Node.js file APIs. It does not require a build step at runtime.

## Installation

```bash
pi install npm:@yukikisaku/pi-chain-skills-prompts
```

## Usage

Start the input with two or more prompt-template or skill commands:

```text
/review /refactor src/app.ts
```

Prompt templates and skills can be mixed:

```text
/review /skill:grill-me explain this design
```

For skills, the `skill:` prefix can be omitted inside a chain when the shortened name uniquely matches an available skill:

```text
/review /grill-me explain this design
```

The extension reads only the selected prompt or skill Markdown files that Pi has already exposed as commands. It removes frontmatter, clears template argument placeholders such as `$ARGUMENTS`, `$@`, `$1`, and `${@:N}`, joins the selected content, and appends the trailing input once. Multiline text and consecutive spaces in that trailing input are preserved.

After the first combinable slash command, autocomplete also offers prompt templates and skills for later commands in the chain.

The package does not bundle your local prompt or skill files, persist their contents, or send them anywhere by itself. The combined text becomes the Pi input for the normal request flow.

## Configuration

No package-specific configuration is required.

## Uninstallation

```bash
pi remove npm:@yukikisaku/pi-chain-skills-prompts
```

## License

MIT. See [LICENSE](LICENSE).

Parts of the argument parsing and substitution logic are adapted from Pi's MIT-licensed prompt-template implementation. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
