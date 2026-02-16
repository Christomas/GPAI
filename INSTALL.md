# GPAI Installation Guide

## Requirements

- Node.js >= 18
- npm >= 9
- Gemini CLI >= 0.28.0
- Google Gemini API key

## Fresh Install

```bash
npm install
npm run build
npm run init
npm run install-extension
```

Notes:
- `init` only asks for `name` / `aiName` / `timeZone`.
- `~/.gpai/.env` is created automatically. If `GOOGLE_API_KEY` was not set in your shell during init, update `~/.gpai/.env` manually.

## Full Reinstall (Clean Old Installation)

### Option A: Clean reinstall but keep your data (`~/.gpai`)

Use this if you only want to replace extension binaries/config under Gemini:

```bash
# 1) Stop running Gemini sessions first

# 2) Remove old extension registration
gemini extensions uninstall gpai-core >/dev/null 2>&1 || true

# 3) Remove any leftover extension files (old local/link installs)
rm -rf ~/.gemini/extensions/gpai-core

# 4) Rebuild and reinstall from this repo
npm install
npm run build
npm run install-extension
```

### Option B: Full reset (remove extension + user data, start from scratch)

Use this if you want a totally new environment:

```bash
# 1) Stop running Gemini sessions first

# 2) Optional backup
cp -R ~/.gpai ~/.gpai.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true

# 3) Remove old extension registration/files
gemini extensions uninstall gpai-core >/dev/null 2>&1 || true
rm -rf ~/.gemini/extensions/gpai-core

# 4) Remove GPAI runtime data
rm -rf ~/.gpai

# 5) Recreate everything
npm install
npm run build
npm run init
npm run install-extension
```

## Confirm Install Mode

```bash
cat ~/.gemini/extensions/gpai-core/.gemini-extension-install.json
```

Expected:
- `"type": "local"` (installed copy)
- Not `"type": "link"`

## Verify Hook Files

```bash
ls ~/.gemini/extensions/gpai-core/hooks/hooks.json
ls ~/.gemini/extensions/gpai-core/dist/hooks/runner.js
```

## Validate

```bash
npm test
npm run test:integration
```

Expected:
- Jest test suites pass.
- Integration test may print warnings for unsupported Gemini CLI subcommands (for example no `gemini hooks list` / `test-gpai`), this is normal.
- Success-pattern recompute runs automatically by threshold (history delta 30 / rated delta 10, with 15-minute cooldown).
- Thresholds are configurable via `~/.gpai/config/learning.json`.

## Runtime Smoke Check

```bash
# Start a Gemini session and run one prompt, then in another terminal:
tail -n 50 ~/.gpai/data/logs/hooks-$(date +%F).jsonl
```

You should see events such as `SessionStart`, `BeforeAgent`, `AfterAgent`.

## Antigravity (Optional, Shared Memory with Gemini CLI)

If you also use Antigravity, point MCP to the installed extension entry:

```json
{
  "mcpServers": {
    "GPAI": {
      "command": "node",
      "args": [
        "/Users/<YOUR_USER>/.gemini/extensions/gpai-core/dist/index.js"
      ]
    }
  }
}
```

Use an absolute path. Do not use `$HOME` or `~` in `args` unless your MCP host explicitly expands them.

Then in Antigravity:
- Go to `Customizations -> Workflows` and create a workspace workflow (recommended).
- Paste the workflow policy from `README.md` section `Antigravity Workflow Rule (Copy/Paste)`.
- Trigger with `//`.

Important:
- If you want to avoid cross-environment prompt pollution, do not put this policy in `Rules`.
- Keep it in `Workflows` so Gemini CLI rule behavior is not globally affected.

## Reinstall After Source Changes

If extension source changes, rebuild and reinstall:

```bash
npm run build
npm run install-extension
```
