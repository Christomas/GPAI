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

DETECTED_TIMEZONE="$(node -e 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")')"
read -r -p "时区 [$DETECTED_TIMEZONE]: " TIME_ZONE
TIME_ZONE="${TIME_ZONE:-$DETECTED_TIMEZONE}"

if [ -f "$ROOT_DIR/config/agents.json" ]; then
  cp "$ROOT_DIR/config/agents.json" "$GPAI_DIR/config/agents.json"
fi
if [ -f "$ROOT_DIR/config/patterns.yaml" ]; then
  cp "$ROOT_DIR/config/patterns.yaml" "$GPAI_DIR/config/patterns.yaml"
fi
if [ -f "$ROOT_DIR/config/prompts.json" ]; then
  cp "$ROOT_DIR/config/prompts.json" "$GPAI_DIR/config/prompts.json"
fi
if [ -f "$ROOT_DIR/config/learning.json" ]; then
  cp "$ROOT_DIR/config/learning.json" "$GPAI_DIR/config/learning.json"
fi

PROFILE_PATH="$GPAI_DIR/data/profile.json"
export USER_NAME AI_NAME TIME_ZONE PROFILE_PATH

node <<'NODE'
const fs = require('fs')
const path = require('path')
const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const profileTimeZone = (() => {
  const candidate = String(process.env.TIME_ZONE || '').trim()
  if (!candidate) {
    return detectedTimeZone
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    return detectedTimeZone
  }
})()

const profile = {
  user: {
    name: process.env.USER_NAME || 'John Doe',
    aiName: process.env.AI_NAME || 'Kai'
  },
  mission: '',
  goals: [],
  projects: [],
  beliefs: [],
  models: [],
  strategies: [],
  learnings: [],
  preferences: {
    communicationStyle: 'direct',
    detailLevel: 'medium',
    responseLength: 'concise',
    preferredAgents: [],
    councilMode: true,
    learningEnabled: true,
    timeZone: profileTimeZone
  }
}

const profilePath = process.env.PROFILE_PATH
fs.mkdirSync(path.dirname(profilePath), { recursive: true })
fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))
NODE

: > "$GPAI_DIR/data/memory/hot.jsonl"
: > "$GPAI_DIR/data/memory/warm.jsonl"
: > "$GPAI_DIR/data/memory/cold.jsonl"

GOOGLE_API_KEY_VALUE="${GOOGLE_API_KEY:-sk-xxx...}"

cat > "$GPAI_DIR/.env" <<ENVVARS
GOOGLE_API_KEY=$GOOGLE_API_KEY_VALUE
GPAI_DIR=$GPAI_DIR
GPAI_DEBUG=false
MEMORY_MODE=jsonl
ENVVARS

echo "✓ GPAI 初始化完成"
echo "目录: $GPAI_DIR"
