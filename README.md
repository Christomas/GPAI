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

Default output contract:
- response should be Chinese
- first visible character must be `🗣️`
- English proper nouns are allowed, but output must include Chinese content

Configurable at `~/.gpai/config/prompts.json`:
```json
{
  "output_contract": {
    "language": "chinese",
    "first_visible_char": "🗣️"
  }
}
```
`language` supports: `chinese`, `english`, `any`.

## Antigravity MCP Tools

When GPAI is used as an MCP server (for example in Antigravity), these tools are exposed:

- `gpai_health`: bridge health check.
- `gpai_run_hook`: run one hook event manually (`SessionStart` / `BeforeAgent` / `BeforeTool` / `AfterTool` / `AfterAgent` / `PreCompress`).
- `gpai_auto_pipeline`: run the full chain in one call:
  - `SessionStart -> BeforeAgent -> (BeforeTool/AfterTool)* -> AfterAgent -> PreCompress`

Boundary:
- Gemini CLI Hook execution still runs via `dist/hooks/runner.js`.
- MCP tools above are for MCP clients (such as Antigravity) and do not replace Gemini Hook registration.

Notes for `gpai_auto_pipeline`:
- Provide `result` if you want `AfterAgent` to execute; otherwise `AfterAgent` is skipped.
- `toolExecutions` is optional; when provided, each item can include:
  - `tool` / `args` / `result` / `executionTime`
- `PreCompress` runs only when threshold is met (or `forcePreCompress=true`).
- Stage switches are supported:
  - `runSessionStart` / `runBeforeAgent` / `runToolStages` / `runAfterAgent` / `runPreCompress`
  - all default to `true`.

### Antigravity Workflow Rule (Copy/Paste)

Use this as workflow policy so each turn runs GPAI automatically with two phases:

```text
[Rule: GPAI Auto Pipeline]
For every user turn, execute these steps in order:

Step 1 (Pre-stage, before drafting final answer):
Call MCP tool `gpai_auto_pipeline` with:
{
  "sessionId": "{{conversation.id}}",
  "timestamp": {{now_ms}},
  "prompt": "{{user_message}}",
  "conversationHistory": {{conversation.history}},
  "runSessionStart": true,
  "runBeforeAgent": true,
  "runToolStages": false,
  "runAfterAgent": false,
  "runPreCompress": false
}
Then use returned `sessionStart` + `beforeAgent` as hidden planning context.

Step 2 (Execute task):
Run tools as needed and collect tool traces:
[
  { "tool": "...", "args": {...}, "result": {...}, "executionTime": 123 }
]

Step 3 (Post-stage, after final answer draft):
Call MCP tool `gpai_auto_pipeline` with:
{
  "sessionId": "{{conversation.id}}",
  "prompt": "{{user_message}}",
  "result": "{{assistant_final_text}}",
  "success": true,
  "modelCalls": {{model_call_count}},
  "executionTime": {{elapsed_ms}},
  "toolExecutions": {{tool_traces}},
  "runSessionStart": false,
  "runBeforeAgent": false,
  "runToolStages": true,
  "runAfterAgent": true,
  "runPreCompress": true,
  "tokenUsage": {{context_tokens}},
  "maxTokens": {{context_limit}}
}

Fallback:
If Step 3 fails, call `gpai_run_hook` for `AfterAgent` to persist learning data.
Always keep user-visible answer compliant with configured output contract.
```

Placement recommendation:
- Recommended (simplest): let Antigravity load project file `/Users/liyanzhao/All-new/project/GPAI/.cursorrules`.
- Fallback: put this policy in Antigravity `Customizations -> Workflows` (`Workspace` scope).
- Avoid putting it in `Rules` when you do not want shared global constraints.

## Project Prompt File (`.cursorrules`)

This repository provides a minimal project-level prompt file:
- `/Users/liyanzhao/All-new/project/GPAI/.cursorrules`

What it does:
- Runs `GPAI.gpai_auto_pipeline` in two stages (pre-injection + post-learning).
- Keeps behavior project-scoped (not global).
- Adds a hard constraint: if MCP tools are available, do not finish a turn before pre + post pipeline calls.
- Prefers tool name `GPAI.gpai_auto_pipeline` (fallback: `gpai_auto_pipeline` if host does not expose prefixed names).
- If tools are unavailable in current session, report `GPAI MCP tools unavailable` and stop (no substitution with shell/test commands).

Boundary:
- `.cursorrules` is project prompt only.
- Gemini CLI hooks still run through `dist/hooks/runner.js`.

Quick verification (did Antigravity really call GPAI MCP tools?):
```bash
LATEST_LOG="$(
  (ls -1t ~/.gpai/data/logs/mcp-tools-*.jsonl 2>/dev/null || true)
  (ls -1t ./.gpai/data/logs/mcp-tools-*.jsonl 2>/dev/null || true)
  (ls -1t /tmp/gpai-mcp-tools-*.jsonl 2>/dev/null || true)
  | head -n 1
)"
[ -n "$LATEST_LOG" ] && tail -n 50 "$LATEST_LOG" || echo "No mcp-tools log found"
```
Expected for one turn:
- `tool=gpai_auto_pipeline, phase=start`
- `tool=gpai_auto_pipeline, phase=done`

If you changed extension code, rebuild + reinstall before retrying in Antigravity:
```bash
npm run build
npm run install-extension
```

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
- `extensions/gpai-core/hooks/AfterAgent.ts`
  - Output contract validation and success/failure override

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
