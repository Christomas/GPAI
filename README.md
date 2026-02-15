# GPAI

GPAI (Gemini Personal AI Infrastructure) provides:

- Gemini CLI extension hooks (`SessionStart`, `BeforeAgent`, `BeforeTool`, `AfterTool`, `AfterAgent`, `PreCompress`)
- Personal profile + memory layers (`hot`/`warm`/`cold`)
- Multi-agent mapping and prompt templates
- Security guardrails for tool execution

## Compatibility

- Node.js >= 18
- npm >= 9
- Gemini CLI >= 0.28.0 (verified on 0.28.2)

## Quick Start (Recommended: Installed Copy, Not Link)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build TypeScript:
   ```bash
   npm run build
   ```
3. Initialize runtime data:
   ```bash
   npm run init
   ```
4. Install extension:
   ```bash
   npm run install-extension
   ```
   This installs a local copy under `~/.gemini/extensions/gpai-core` (`type: local`).

## Verify Installation

```bash
cat ~/.gemini/extensions/gpai-core/.gemini-extension-install.json
ls ~/.gemini/extensions/gpai-core/hooks/hooks.json
ls ~/.gemini/extensions/gpai-core/dist/hooks/runner.js
```

Expected:
- Install metadata contains `"type": "local"`
- Hook config and compiled runner exist in `~/.gemini/extensions/gpai-core/...`

## Runtime Verification

After starting a Gemini session, check hook logs:

```bash
tail -n 50 ~/.gpai/data/logs/hooks-$(date +%F).jsonl
```

You should see events such as `SessionStart`, `BeforeAgent`, `AfterAgent`.

## Update Workflow (When Code Changes)

If you modify extension code, reinstall the installed copy:

```bash
npm run build
npm run install-extension
```

## About `link` Mode

- `link` is for development only.
- It depends on your project directory at runtime.
- If you want stable usage independent of dev files, use `install` mode (recommended above).

Detailed setup: see `INSTALL.md` and `project.md`.
