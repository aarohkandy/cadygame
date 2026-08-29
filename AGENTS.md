<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project agent guidelines

## Code change workflow

### Python virtual environments

When work involves Python application code, tooling, or tests, look for a `.venv` directory before running Python-related commands. Check both the repository root and the Python package directory being worked in.

If a `.venv` exists, either activate it in the same shell session or invoke its executables by their full paths. Apply this consistently to `python`, `pip`, test runners, linters, formatters, and other environment-installed tools.

- macOS/Linux: `source .venv/bin/activate` or `<venv-path>/bin/python ...`
- Windows Command Prompt: `<venv-path>\Scripts\activate.bat`
- Windows PowerShell: `<venv-path>\Scripts\Activate.ps1`

### Verification after changes

After every code change:

1. Run the relevant tests and confirm they pass.
2. Verify the changed behavior through appropriate output, return values, logs, or direct interaction.
3. Inspect console output for errors, warnings, and unexpected messages.
4. For user-interface changes, open the affected page and capture a screenshot for visual verification.

## Code quality guardrails

When generating or modifying code:

1. Keep the whole system in view and align local changes with the architecture and product intent.
2. Avoid duplicate logic, dead paths, and incomplete integration points.
3. Prefer existing utilities and reusable abstractions over one-off implementations.
4. When fixing bugs, preserve behavior outside the intended scope.
5. Protect data correctness, invariants, and system consistency over implementation speed.
6. When adding or removing a component, identify components with similar responsibilities and determine whether the requested change should be isolated or applied consistently across them.

## Commit messages

Agent-authored commit messages must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types include `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.

- Use a short, imperative description that explains the user-visible or technical change.
- Add `!` after the type or scope for a breaking change, or include a `BREAKING CHANGE:` footer.
- Keep each commit focused on one coherent change.

Examples:

```text
feat(arena): add spectator reaction controls
fix(camera): prevent clipping near ring corners
docs: document local match setup
```

## User-facing UI and design

Before changing user-facing components—including marketing pages, application shell UI, shared styles, visible copy, or assets—read `STYLES.md` at the repository root when it exists. Follow its layout, typography, color, and vocabulary guidance unless the user explicitly requests otherwise.
