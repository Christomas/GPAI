#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GPAI_DIR="${GPAI_DIR:-$HOME/.gpai}"

mkdir -p "$GPAI_DIR/config" "$GPAI_DIR/data/memory" "$GPAI_DIR/data/work" "$GPAI_DIR/hooks"

echo "🚀 GPAI Initialization Wizard"

read -r -p "你的名字 [John Doe]: " USER_NAME
USER_NAME="${USER_NAME:-John Doe}"

read -r -p "AI助手名称 [Kai]: " AI_NAME
AI_NAME="${AI_NAME:-Kai}"

read -r -p "你的使命 [构建安全的系统]: " MISSION
MISSION="${MISSION:-构建安全的系统}"

read -r -p "当前目标 [提高代码质量，找出漏洞]: " GOAL
GOAL="${GOAL:-提高代码质量，找出漏洞}"

read -r -p "工作风格 [直接、注重细节]: " STYLE
STYLE="${STYLE:-直接、注重细节}"

read -r -p "倾向的Agent（逗号分隔） [engineer,analyst]: " AGENTS
AGENTS="${AGENTS:-engineer,analyst}"

read -r -p "Google API Key [sk-xxx...]: " GOOGLE_API_KEY
GOOGLE_API_KEY="${GOOGLE_API_KEY:-sk-xxx...}"

if [ -f "$ROOT_DIR/config/agents.json" ]; then
  cp "$ROOT_DIR/config/agents.json" "$GPAI_DIR/config/agents.json"
fi
if [ -f "$ROOT_DIR/config/patterns.yaml" ]; then
  cp "$ROOT_DIR/config/patterns.yaml" "$GPAI_DIR/config/patterns.yaml"
fi
if [ -f "$ROOT_DIR/config/prompts.json" ]; then
  cp "$ROOT_DIR/config/prompts.json" "$GPAI_DIR/config/prompts.json"
fi

cat > "$GPAI_DIR/data/profile.json" <<JSON
{
  "user": {
    "name": "$USER_NAME",
    "aiName": "$AI_NAME"
  },
  "mission": "$MISSION",
  "goals": ["$GOAL"],
  "preferences": {
    "communicationStyle": "$STYLE",
    "preferredAgents": ["${AGENTS//,/\",\"}"],
    "councilMode": true,
    "learningEnabled": true
  }
}
JSON

: > "$GPAI_DIR/data/memory/hot.jsonl"
: > "$GPAI_DIR/data/memory/warm.jsonl"
: > "$GPAI_DIR/data/memory/cold.jsonl"

cat > "$GPAI_DIR/.env" <<ENVVARS
GOOGLE_API_KEY=$GOOGLE_API_KEY
GPAI_DIR=$GPAI_DIR
GPAI_DEBUG=false
MEMORY_MODE=jsonl
ENVVARS

echo "✓ GPAI 初始化完成"
echo "目录: $GPAI_DIR"
