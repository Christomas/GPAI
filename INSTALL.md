# GPAI Installation Guide

## Requirements

- Node.js >= 18
- npm >= 9
- Gemini CLI >= 0.28.0
- Google Gemini API key

## Setup

```bash
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

If Gemini CLI is not available, integration checks are skipped.

## Reinstall After Changes

If extension source changes, rebuild and reinstall:

```bash
npm run build
npm run install-extension
```
