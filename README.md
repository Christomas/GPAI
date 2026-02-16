# GPAI

GPAI (Gemini Personal AI Infrastructure) provides:

- Gemini CLI extension hooks (`SessionStart`, `BeforeAgent`, `BeforeTool`, `AfterTool`, `AfterAgent`, `PreCompress`)
- Personal profile + memory layers (`hot`/`warm`/`cold`)
- TELOS profile context (mission/goals/projects/beliefs/models/strategies/learnings)
- 8-role agent pool (`engineer`, `architect`, `analyst`, `devil`, `planner`, `qa`, `researcher`, `writer`)
- Multi-agent mapping and prompt templates
- Automatic success-pattern recompute (threshold-based)
- Context-similarity agent reranking from historical outcomes (intent/project/complexity/tools/text)
- Dynamic composition override: high-confidence non-baseline agents can replace baseline slots with safeguards
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
   `init` only asks for `name` / `aiName` plus timezone (auto-detect + optional override).
   Later conversations can explicitly/implicitly update TELOS fields except `name` / `aiName` / `timeZone`.
   If `GOOGLE_API_KEY` was not exported before init, edit `~/.gpai/.env` after init.
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

`npm run test:integration` may show warnings when your Gemini CLI version lacks `gemini hooks list` or `test-gpai`; this is expected.

Success-pattern recompute is triggered automatically by thresholds:
- history delta >= 30, or rated-history delta >= 10
- cooldown: 15 minutes (unless forced by large delta)

Config file:
- `~/.gpai/config/learning.json` (fallback: project `config/learning.json`)

Per-turn hard constraints (optional):
- `本轮包含agent: researcher, writer, devil`
- `本轮排除agent: analyst`
- `仅用agent: researcher, writer`

By default, `BeforeAgent` also applies context-similarity signals from `~/.gpai/data/history.json`
to rerank agents, and writes evidence lines into `systemInstructions` (`Context similarity boost` / `Context-similar case`).
Dynamic composition then applies threshold-based replacement:
- keeps an intent baseline anchor agent (e.g. `technical` keeps `engineer`)
- allows non-baseline injection only when context-similarity or score confidence is high
- records evidence in `systemInstructions` (`Dynamic composition injected` / `Dynamic composition replaced baseline`)

## AI Constraints (Where to Modify)

### Directly Editable (takes effect from next hook run/session)

- `~/.gpai/config/patterns.yaml`
  - Tool security rules: `blocked` / `confirm` / `alert`
- `~/.gpai/config/agents.json`
  - Agent role prompts (`systemPrompt`) and intent-to-agent mapping (`intentToAgents`)
- `~/.gpai/config/prompts.json`
  - Intent detection prompt template (`intent_detection.prompt`)
- `~/.gpai/data/profile.json`
  - TELOS/runtime preferences (`communicationStyle`, `preferredAgents`, `councilMode`, `learningEnabled`, `timeZone`)

### Code-Level Constraints (require rebuild + reinstall)

- `extensions/gpai-core/hooks/SessionStart.ts`
  - Session-level system prompt scaffold
- `extensions/gpai-core/hooks/BeforeAgent.ts`
  - Team process scaffold, scoring policy, dynamic composition policy
- `extensions/gpai-core/hooks/BeforeTool.ts`
  - Security rule evaluation behavior

### Priority and Boundaries

- Config priority: `~/.gpai/config/*` overrides project `config/*`.
- If you changed TypeScript source under `extensions/gpai-core`, run:
  ```bash
  npm run build
  npm run install-extension
  ```
- Gemini CLI/model provider guardrails are outside this project and cannot be overridden by GPAI repo config.

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
