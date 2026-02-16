#!/usr/bin/env bash
set -euo pipefail

echo "🧪 GPAI Integration Tests"

if ! command -v gemini >/dev/null 2>&1; then
  echo "[WARN] Gemini CLI not found, skipping integration checks."
  exit 0
fi

if [ ! -d "$HOME/.gpai" ]; then
  echo "[WARN] $HOME/.gpai not found. Run 'npm run init' first, then rerun integration tests."
  exit 0
fi

if [ ! -f "./extensions/gpai-core/dist/hooks/SessionStart.js" ]; then
  echo "[WARN] Extension build artifacts not found. Run 'npm run build' before integration tests."
  exit 0
fi

echo -e "\n✓ Testing Hook Loading..."
if gemini hooks --help 2>&1 | grep -q "list"; then
  gemini hooks list | grep -q "SessionStart" && echo "  ✓ SessionStart loaded" || exit 1
  gemini hooks list | grep -q "BeforeAgent" && echo "  ✓ BeforeAgent loaded" || exit 1
  gemini hooks list | grep -q "BeforeTool" && echo "  ✓ BeforeTool loaded" || exit 1
  gemini hooks list | grep -q "AfterAgent" && echo "  ✓ AfterAgent loaded" || exit 1
else
  echo "  [WARN] This Gemini CLI version has no 'gemini hooks list', skipping hook loading checks."
fi

echo -e "\n✓ Testing Configuration..."
test -f "$HOME/.gpai/data/profile.json" && echo "  ✓ Profile exists" || exit 1
test -f "$HOME/.gpai/config/agents.json" && echo "  ✓ Agents config exists" || exit 1
test -f "$HOME/.gpai/config/patterns.yaml" && echo "  ✓ Security patterns exist" || exit 1
if test -f "$HOME/.gpai/config/learning.json"; then
  echo "  ✓ Learning config exists"
else
  echo "  [WARN] learning.json not found, using built-in recompute defaults."
fi

echo -e "\n✓ Testing Memory System..."
test -d "$HOME/.gpai/data/memory" && echo "  ✓ Memory directory exists" || exit 1
test -f "$HOME/.gpai/data/memory/hot.jsonl" && echo "  ✓ Hot memory initialized" || exit 1

echo -e "\n✓ Testing Basic Functionality..."
if gemini --help 2>&1 | grep -q "test-gpai"; then
  gemini test-gpai > /tmp/gpai-test.log 2>&1
  grep -q "✓" /tmp/gpai-test.log && echo "  ✓ System test passed" || exit 1
else
  echo "  [WARN] This Gemini CLI version has no 'test-gpai', skipping basic functionality check."
fi

echo -e "\n✅ All integration tests passed!"
