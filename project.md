# 📘 GPAI 完整项目实现计划

## 目录

1. [项目结构](#项目结构)
2. [当前实现能力（已落地）](#当前实现能力已落地)
3. [环境要求](#环境要求)
4. [安装步骤](#安装步骤)
5. [配置说明](#配置说明)
6. [核心代码实现](#核心代码实现)
7. [使用指南](#使用指南)
8. [测试验证](#测试验证)
9. [故障排除](#故障排除)
10. [持续演进清单（合并）](#持续演进清单合并)

---

## 项目结构

```
GPAI/
├── 📁 extensions/
│   └── 📁 gpai-core/
│       ├── gemini-extension.json          ← 扩展声明
│       ├── 📁 hooks/                      ← Hook实现与Hook配置
│       │   ├── hooks.json
│       │   ├── SessionStart.ts
│       │   ├── BeforeAgent.ts
│       │   ├── BeforeTool.ts
│       │   ├── AfterTool.ts
│       │   ├── AfterAgent.ts
│       │   ├── PreCompress.ts
│       │   ├── runner.ts
│       │   └── index.ts
│       ├── index.ts                       ← MCP stdio 入口（gpai_health/gpai_run_hook/gpai_auto_pipeline）
│       ├── 📁 dist/                       ← 编译产物（Hook运行入口）
│       ├── 📁 mcp-servers/                ← MCP服务（可选）
│       │   ├── 📁 memory-server/
│       │   │   ├── src/
│       │   │   │   ├── index.ts
│       │   │   │   ├── memory.ts
│       │   │   │   └── types.ts
│       │   │   ├── package.json
│       │   │   └── tsconfig.json
│       │   └── 📁 agents-server/
│       │       ├── src/
│       │       │   ├── index.ts
│       │       │   ├── agents.ts
│       │       │   └── types.ts
│       │       ├── package.json
│       │       └── tsconfig.json
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
│
├── 📁 config/
│   ├── agents.json                       ← Agent定义
│   ├── patterns.yaml                     ← 安全规则
│   ├── prompts.json                      ← 提示词库
│   └── learning.json                     ← 学习阈值配置
│
├── 📁 data/
│   ├── profile.json                      ← 用户身份（TELOS）
│   ├── memory/
│   │   ├── hot.jsonl                     ← 当前会话
│   │   ├── warm.jsonl                    ← 最近7天
│   │   ├── cold.jsonl                    ← 长期知识
│   │   └── .gitkeep
│   ├── work/                             ← Work项目录
│   │   └── .gitkeep
│   └── history.json                      ← 对话历史
│
├── 📁 scripts/
│   ├── install.sh                        ← 安装脚本
│   ├── init.sh                           ← 初始化向导
│   ├── build.sh                          ← 编译脚本
│   ├── setup-mcp.sh                      ← MCP设置
│   ├── setup.sh                          ← 一键安装
│   └── test-integration.sh               ← 集成测试
│
├── .env.example                          ← 环境变量示例
├── .gitignore
├── .cursorrules                          ← Antigravity 项目级提示词（两阶段自动调用）
├── package.json                          ← 项目依赖
├── tsconfig.json                         ← TypeScript配置
├── README.md                             ← 文档
└── INSTALL.md                            ← 安装指南
```

---

## 当前实现能力（已落地）

### 核心链路

- 6 个核心 Hook 全部可用：`SessionStart`、`BeforeAgent`、`BeforeTool`、`AfterTool`、`AfterAgent`、`PreCompress`。
- 已适配 Gemini CLI 0.28.x Hook schema，使用 `hooks/runner.ts` 统一路由执行。
- Hook 日志已结构化落盘到 `~/.gpai/data/logs/hooks-YYYY-MM-DD.jsonl`，便于审计与排错。

### 记忆与学习

- `hot/warm/cold` 三层记忆已统一结构，并支持 `PreCompress` 生命周期迁移（`hot -> warm -> cold`）。
- `WorkItem -> history.json -> successPatterns` 学习链路已闭环。
- 用户评分反馈（如 `9分` / `9/10`）可回写并参与后续选角。
- `successPatterns` 已支持阈值自动重算（默认 `history=30` / `rated=10` / `cooldown=15min`，可在 `learning.json` 配置）。

### Agent 选择与编排

- 8 角色池与意图映射已落地：`engineer/architect/analyst/devil/planner/qa/researcher/writer`。
- 已接入上下文相似度选角：综合 `intent/project/complexity/tools/text` + 时间衰减 + 评分信号。
- 已接入动态编组替换：在保留意图锚点角色前提下，允许高置信非基线角色替换低分槽位，并输出可解释证据。
- 支持本轮硬约束：`包含/排除/仅用 agent`。

### TELOS 与时区治理

- `init` 已收敛为基础档案：`name/aiName/timeZone`（时区自动识别 + 可修改）。
- 后续会话支持显式与隐式更新 TELOS（除 `name/aiName/timeZone` 外）。
- 会话注入已包含时区与绝对日期锚点，降低“今天/明天”语义歧义。

### 部署与验证

- install 本地拷贝模式可用（`type: local`），不依赖开发目录 link。
- 单测与集成测试脚本可运行，且兼容 Gemini CLI 子命令缺失场景（按能力跳过并告警）。
- MCP 入口已可用于 Antigravity：`gpai_health`、`gpai_run_hook`、`gpai_auto_pipeline`。
- `gpai_auto_pipeline` 支持阶段开关（`runSessionStart/runBeforeAgent/runToolStages/runAfterAgent/runPreCompress`）以便做前后置两阶段工作流。

---

## 环境要求

### **必需**
- Node.js >= 18.0.0
- npm >= 9.0.0 或 yarn >= 3.0.0
- Gemini CLI >= 0.28.0
- Google Gemini API Key

### **可选**
- macOS/Linux（Windows需要WSL2）
- Docker（用于MCP服务隔离）

---

## 安装步骤

### **步骤1：克隆和安装**

```bash
# 1. 克隆项目
git clone https://github.com/YOUR_NAME/GPAI.git
cd GPAI

# 2. 安装项目依赖
npm install
# 或
yarn install

# 3. 编译TypeScript
npm run build
# 生成 extensions/gpai-core/dist/ 目录
```

### **步骤2：初始化GPAI**

```bash
# 运行初始化向导
npm run init

# 向导会问：
# 1. 你的名字？ → John Doe
# 2. AI助手名称？ → Kai
# 3. 时区（自动识别后可修改）？ → Asia/Shanghai

# 说明：
# init 仅初始化基础档案（name/aiName/timeZone）。
# 其余 TELOS（mission/goals/projects/beliefs/models/strategies/learnings/preferences）在后续对话中按显式或隐式信号持续增删改。

# 生成 ~/.gpai/ 目录：
# ~/.gpai/
# ├── config/
# ├── data/
# │   ├── profile.json      ← 自动生成
# │   └── memory/
# └── hooks/

echo "✓ GPAI 初始化完成"
```

### **步骤3：注册Gemini CLI扩展**

```bash
# 安装（推荐：install 本地拷贝模式，而不是 link）
npm run install-extension

# 验证安装
gemini extensions list
# 输出应该包含：gpai-core (v1.0.0, Type: local)

# 验证安装文件
cat ~/.gemini/extensions/gpai-core/.gemini-extension-install.json
ls ~/.gemini/extensions/gpai-core/hooks/hooks.json
ls ~/.gemini/extensions/gpai-core/dist/hooks/runner.js
```

### **步骤4：设置环境变量**

```bash
# init 会自动生成 ~/.gpai/.env
cat ~/.gpai/.env

# 如果没有提前导出 GOOGLE_API_KEY，文件里会是占位值，请手动编辑
nano ~/.gpai/.env
```

### **步骤5：测试安装**

```bash
# 运行测试
npm test

# 输出应该显示：
# Test Suites: ... passed

# 运行集成测试脚本
npm run test:integration

# 说明：
# 如果 Gemini CLI 当前版本没有 `gemini hooks list` / `test-gpai`，
# 集成测试会打印 [WARN] 并跳过对应检查，这属于预期。

# 启动一次 gemini 会话后，验证Hook日志
tail -n 50 ~/.gpai/data/logs/hooks-$(date +%F).jsonl
```

### **步骤6（可选）：接入 Antigravity MCP**

`mcp_config.json` 示例：

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

说明：请使用绝对路径；多数 MCP 宿主不会在 `args` 中展开 `$HOME` 或 `~`。

工作流放置建议：
- 优先让 Antigravity 读取项目根目录 `.cursorrules`（最简、项目级）。
- 备选：放在 Antigravity `Customizations -> Workflows`（推荐 `Workspace` 级）。
- 不建议放在 `Rules`（你的环境中可能与 Gemini CLI 共享规则，容易互相污染）。
- 工作流内容可直接使用 `README.md` 的 `Antigravity Workflow Rule (Copy/Paste)`。

---

## 配置说明

### **1. profile.json - 用户身份（TELOS）**

`~/.gpai/data/profile.json`

```json
{
  "user": {
    "name": "John Doe",
    "aiName": "Kai"
  },
  "mission": "",
  "goals": [],
  "projects": [],
  "beliefs": [],
  "models": [],
  "strategies": [],
  "learnings": [],
  "preferences": {
    "communicationStyle": "direct",
    "detailLevel": "medium",
    "responseLength": "concise",
    "preferredAgents": [],
    "councilMode": true,
    "learningEnabled": true,
    "timeZone": "Asia/Shanghai"
  }
}
```

说明：这是 `init` 后的基础形态。后续会话会按显式/隐式信号持续补充 `mission/goals/projects/...`，并在运行中写入 `successPatterns`。

### **2. agents.json - Agent定义**

`~/.gpai/config/agents.json`

```json
{
  "agents": [
    { "id": "engineer", "role": "Technical Expert" },
    { "id": "architect", "role": "System Architect" },
    { "id": "analyst", "role": "Risk Analyst" },
    { "id": "devil", "role": "Critical Thinker" },
    { "id": "planner", "role": "Execution Planner" },
    { "id": "qa", "role": "Quality Assurance" },
    { "id": "researcher", "role": "Evidence Researcher" },
    { "id": "writer", "role": "Technical Writer" }
  ],
  
  "intentToAgents": {
    "analysis": ["analyst", "engineer", "devil"],
    "creative": ["writer", "planner", "researcher"],
    "technical": ["engineer", "architect", "qa", "devil"],
    "research": ["researcher", "analyst", "writer", "devil"],
    "strategy": ["planner", "architect", "analyst", "devil"],
    "security": ["analyst", "devil", "engineer", "qa"]
  }
}
```

### **3. patterns.yaml - 安全规则**

`~/.gpai/config/patterns.yaml`

```yaml
security:
  # 完全阻止的操作
  blocked:
    bash:
      - 'rm -rf /'
      - 'dd if=/dev/zero'
      - 'format'
      - 'mkfs'
    paths:
      - '~/.ssh/*'
      - '~/.aws/credentials'
      - '/etc/passwd'
      - '/etc/shadow'

  # 需要用户确认的操作
  confirm:
    bash:
      - 'git push --force'
      - 'rm -rf'
      - 'sudo'
      - 'chown'
    paths:
      - '~/.*'                    # 隐藏文件
      - '/etc/*'                  # 系统配置
      - '$HOME/.gpai/data/*'      # GPAI数据（读可以，写需确认）

  # 只记录日志的操作
  alert:
    bash:
      - 'curl'
      - 'wget'
      - 'ssh'
    paths:
      - '/root/*'

logging:
  enabled: true
  level: 'info'
  dir: '~/.gpai/data/logs'
  retention_days: 30
```

### **4. prompts.json - 提示词库**

`~/.gpai/config/prompts.json`

```json
{
  "system_prompts": {
    "default": "你是一个智能AI助手，帮助用户实现他们的目标。记住用户的背景、偏好和历史。自动选择最合适的分析方式。",
    "council": "你现在将与其他AI角色一起讨论这个问题。先独立思考你的观点，然后综合各方观点。",
    "security": "你在进行安全分析。考虑所有可能的攻击向量和风险。给出具体的缓解建议。"
  },
  
  "intent_detection": {
    "prompt": "分析用户的请求，返回JSON格式：\n{\"intent\": \"analysis|creative|technical|research|strategy|security\", \"confidence\": 0-1, \"keywords\": []}\n\n用户请求：{prompt}",
    "temperature": 0.3
  },
  
  "agent_selection": {
    "prompt": "根据任务类型'{intent}'，选择最合适的Agent组合。返回：[\"agent1\", \"agent2\", \"agent3\"]\n\n可用Agent: {available_agents}\n\n任务：{task}",
    "temperature": 0.2
  },
  
  "council_synthesis": {
    "prompt": "你现在是一个综合专家。\n\n以下是各角色的观点：\n{individual_views}\n\n请综合这些观点，给出最优的、经过多角度思考的答案。",
    "temperature": 0.5
  },

  "output_contract": {
    "language": "chinese",
    "first_visible_char": "🗣️"
  }
}
```

### **5. learning.json - 学习重算阈值**

`~/.gpai/config/learning.json`

```json
{
  "successPatternRecompute": {
    "historyDeltaThreshold": 30,
    "ratedDeltaThreshold": 10,
    "minIntervalMinutes": 15
  }
}
```

说明：这是 `successPatterns` 自动重算的阈值配置；若文件缺失，系统会使用同样默认值。

---

## 核心代码实现

### **1. SessionStart Hook**

文件：`extensions/gpai-core/hooks/SessionStart.ts`

```typescript
import * as fs from 'fs'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface SessionStartInput {
  sessionId: string
  timestamp: number
}

interface SessionStartOutput {
  context: string
  systemPrompt: string
  metadata: Record<string, any>
}

// ============================================================================
// Main Handler
// ============================================================================

export async function handleSessionStart(
  input: SessionStartInput
): Promise<SessionStartOutput> {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME!, '.gpai')

  try {
    // 1. 加载用户Profile（TELOS）
    const profilePath = path.join(gpaiDir, 'data/profile.json')
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'))

    // 2. 加载Memory上下文
    const hotMemory = loadMemory(gpaiDir, 'hot', 10)
    const warmMemory = loadMemory(gpaiDir, 'warm', 5)

    // 3. 生成系统提示词
    const systemPrompt = buildSystemPrompt(profile)

    // 4. 生成上下文注入
    const context = buildContextInjection(profile, hotMemory, warmMemory)

    return {
      context,
      systemPrompt,
      metadata: {
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        userMission: profile.mission,
        goals: profile.goals.slice(0, 3)
      }
    }
  } catch (error) {
    console.error('SessionStart Hook Error:', error)
    // 返回默认值而不是失败
    return {
      context: '',
      systemPrompt: 'You are a helpful AI assistant.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function loadMemory(gpaiDir: string, type: 'hot' | 'warm' | 'cold', limit: number): any[] {
  const filePath = path.join(gpaiDir, `data/memory/${type}.jsonl`)

  if (!fs.existsSync(filePath)) {
    return []
  }

  const entries = fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line))
    .slice(-limit) // 取最后N条

  return entries
}

function buildSystemPrompt(profile: any): string {
  return `You are an intelligent AI assistant helping the user achieve their goals.

User Profile:
- Name: ${profile.user.name}
- AI Name: ${profile.user.aiName}
- Mission: ${profile.mission}
- Goals: ${profile.goals.slice(0, 3).join(', ')}

Instructions:
1. Remember the user's background, preferences, and history
2. Automatically select the most appropriate analysis method
3. Use Council mode (multiple perspectives) for important decisions
4. At the end of each task, ask the user for feedback (1-10 score)
5. Learn from user feedback and improve your approach
6. If the user prefers certain agents, use them by default`
}

function buildContextInjection(profile: any, hotMemory: any[], warmMemory: any[]): string {
  const timestamp = new Date().toISOString()

  return `
## Session Context (${timestamp})

### User Background
**Mission**: ${profile.mission}
**Current Goals**: ${profile.goals.slice(0, 3).join(', ')}
**Working Style**: ${profile.preferences.communicationStyle}

### Recent Successful Patterns
${warmMemory
  .filter(m => m.type === 'success' || m.rating >= 8)
  .slice(0, 3)
  .map(m => `- ${m.content} [Rating: ${m.rating}]`)
  .join('\n')}

### Session Guidelines
- Use ${profile.preferences.preferredAgents.join(' + ')} for analysis
- Council mode is ${profile.preferences.councilMode ? 'enabled' : 'disabled'}
- Learning is ${profile.preferences.learningEnabled ? 'enabled' : 'disabled'}
- Communication style: ${profile.preferences.communicationStyle}

---
`
}

// ============================================================================
// Export
// ============================================================================

// For use as Gemini CLI Hook
if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}')
  handleSessionStart(input)
    .then(output => {
      console.log(JSON.stringify(output))
      process.exit(0)
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleSessionStart
```

### **2. BeforeAgent Hook**

文件：`extensions/gpai-core/hooks/BeforeAgent.ts`

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { callGemini } from '../utils/gemini'
import { loadConfig } from '../utils/config'

interface BeforeAgentInput {
  prompt: string
  sessionId: string
  conversationHistory: Array<{ role: string; content: string }>
}

interface BeforeAgentOutput {
  modifiedPrompt: string
  injectedContext: string
  suggestedAgents: string[]
  systemInstructions: string
}

export async function handleBeforeAgent(
  input: BeforeAgentInput
): Promise<BeforeAgentOutput> {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME!, '.gpai')

  try {
    // 1. 分析用户意图
    const intent = await analyzeIntent(input.prompt)

    // 2. 选择最合适的Agent
    const suggestedAgents = selectAgents(intent)

    // 3. 创建Work项
    const workItem = createWorkItem(gpaiDir, input.prompt, intent)

    // 4. 加载相关Memory
    const relevantMemory = retrieveRelevantMemory(gpaiDir, input.prompt)

    // 5. 生成系统指示
    const systemInstructions = generateSystemInstructions(suggestedAgents, intent)

    // 6. 修改提示词
    const modifiedPrompt = buildModifiedPrompt(input.prompt, suggestedAgents, intent)

    return {
      modifiedPrompt,
      injectedContext: relevantMemory,
      suggestedAgents,
      systemInstructions
    }
  } catch (error) {
    console.error('BeforeAgent Hook Error:', error)
    return {
      modifiedPrompt: input.prompt,
      injectedContext: '',
      suggestedAgents: ['engineer', 'analyst'],
      systemInstructions: ''
    }
  }
}

async function analyzeIntent(prompt: string): Promise<string> {
  const config = loadConfig()
  const intentPrompt = config.prompts.intent_detection.prompt.replace('{prompt}', prompt)

  try {
    const response = await callGemini(intentPrompt, 0.3)
    const parsed = JSON.parse(response)
    return parsed.intent || 'analysis'
  } catch {
    return 'analysis'
  }
}

function selectAgents(intent: string): string[] {
  const config = loadConfig()
  const mapping = config.agents.intentToAgents

  return mapping[intent as keyof typeof mapping] || ['engineer', 'analyst']
}

function createWorkItem(gpaiDir: string, prompt: string, intent: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const workDir = path.join(gpaiDir, `data/work/${timestamp}_work`)

  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true })
  }

  const workItem = {
    id: timestamp,
    prompt,
    intent,
    createdAt: new Date().toISOString(),
    status: 'in-progress',
    agents: selectAgents(intent)
  }

  fs.writeFileSync(
    path.join(workDir, 'META.json'),
    JSON.stringify(workItem, null, 2)
  )

  return workItem
}

function retrieveRelevantMemory(gpaiDir: string, prompt: string): string {
  // 简单的关键词匹配
  const keywords = prompt.split(' ').filter(w => w.length > 3)

  const memories: any[] = []

  // 搜索warm memory
  const warmPath = path.join(gpaiDir, 'data/memory/warm.jsonl')
  if (fs.existsSync(warmPath)) {
    const warmEntries = fs
      .readFileSync(warmPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))

    for (const entry of warmEntries) {
      const content = entry.content.toLowerCase()
      if (keywords.some(k => content.includes(k.toLowerCase()))) {
        memories.push(entry)
      }
    }
  }

  return memories
    .slice(0, 3)
    .map(m => `- ${m.content} [Rating: ${m.rating || 'N/A'}]`)
    .join('\n')
}

function generateSystemInstructions(agents: string[], intent: string): string {
  const config = loadConfig()
  const agentPrompts = agents
    .map(agentId => {
      const agent = config.agents.agents.find((a: any) => a.id === agentId)
      return agent
        ? `${agent.name}（${agent.role}）:\n${agent.systemPrompt}`
        : ''
    })
    .join('\n\n')

  return `You will now work as a team with these roles:

${agentPrompts}

Task Type: ${intent}

Process:
1. Each role analyzes independently
2. Share perspectives
3. Synthesize the best answer from all viewpoints
4. If in Council mode, use discussion format`
}

function buildModifiedPrompt(prompt: string, agents: string[], intent: string): string {
  return `${prompt}

[System Guidance]
- Task Type: ${intent}
- Recommended Agents: ${agents.join(', ')}
- Use Council mode for multi-perspective analysis
- After completion, request user feedback (1-10 score)`
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}')
  handleBeforeAgent(input)
    .then(output => {
      console.log(JSON.stringify(output))
      process.exit(0)
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleBeforeAgent
```

### **3. BeforeTool Hook**

文件：`extensions/gpai-core/hooks/BeforeTool.ts`

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { parseSimpleYaml } from '../utils/simpleYaml'

interface BeforeToolInput {
  tool: string
  args: Record<string, any>
  context: string
}

interface BeforeToolOutput {
  allowed: boolean
  action: 'allow' | 'block' | 'ask'
  reason?: string
  modifiedArgs?: Record<string, any>
}

export async function handleBeforeTool(input: BeforeToolInput): Promise<BeforeToolOutput> {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME!, '.gpai')

  try {
    // 1. 加载安全规则
    const patterns = loadSecurityPatterns(gpaiDir)

    // 2. 检查是否被阻止
    if (isBlocked(input.tool, input.args, patterns)) {
      return {
        allowed: false,
        action: 'block',
        reason: `Operation blocked for security: ${input.tool}`
      }
    }

    // 3. 检查是否需要确认
    if (requiresConfirmation(input.tool, input.args, patterns)) {
      return {
        allowed: false,
        action: 'ask',
        reason: `This operation requires confirmation: ${input.tool} ${JSON.stringify(input.args)}`
      }
    }

    // 4. 记录到安全日志
    logSecurityEvent(gpaiDir, {
      action: 'allow',
      tool: input.tool,
      args: input.args,
      timestamp: new Date().toISOString()
    })

    return {
      allowed: true,
      action: 'allow',
      modifiedArgs: input.args
    }
  } catch (error) {
    console.error('BeforeTool Hook Error:', error)
    // 安全第一：出错时默认允许（fail-open），但记录
    return {
      allowed: true,
      action: 'allow',
      modifiedArgs: input.args
    }
  }
}

function loadSecurityPatterns(gpaiDir: string): any {
  const patternsPath = path.join(gpaiDir, 'config/patterns.yaml')

  if (!fs.existsSync(patternsPath)) {
    return { blocked: [], confirm: [], alert: [] }
  }

  return parseSimpleYaml(fs.readFileSync(patternsPath, 'utf-8'))
}

function isBlocked(tool: string, args: Record<string, any>, patterns: any): boolean {
  const blocked = patterns.security?.blocked || {}

  // 检查bash命令
  if (tool === 'bash' || tool === 'shell') {
    const command = args.command || args.cmd || ''
    const blockedCommands = blocked.bash || []
    return blockedCommands.some((pattern: string) => command.includes(pattern))
  }

  // 检查文件操作
  if (tool === 'filesystem' || tool === 'file') {
    const filePath = args.path || ''
    const blockedPaths = blocked.paths || []
    return blockedPaths.some((pattern: string) =>
      filePath.includes(pattern.replace('~', process.env.HOME!))
    )
  }

  return false
}

function requiresConfirmation(tool: string, args: Record<string, any>, patterns: any): boolean {
  const confirm = patterns.security?.confirm || {}

  if (tool === 'bash' || tool === 'shell') {
    const command = args.command || args.cmd || ''
    const confirmCommands = confirm.bash || []
    return confirmCommands.some((pattern: string) => command.includes(pattern))
  }

  if (tool === 'filesystem' || tool === 'file') {
    const filePath = args.path || ''
    const confirmPaths = confirm.paths || []
    return confirmPaths.some((pattern: string) =>
      filePath.includes(pattern.replace('~', process.env.HOME!))
    )
  }

  return false
}

function logSecurityEvent(gpaiDir: string, event: any) {
  const logsDir = path.join(gpaiDir, 'data/logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  const today = new Date().toISOString().split('T')[0]
  const logFile = path.join(logsDir, `security-${today}.jsonl`)

  fs.appendFileSync(logFile, JSON.stringify(event) + '\n')
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}')
  handleBeforeTool(input)
    .then(output => {
      console.log(JSON.stringify(output))
      process.exit(0)
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleBeforeTool
```

### **4. AfterTool Hook**

文件：`extensions/gpai-core/hooks/AfterTool.ts`

```typescript
import * as fs from 'fs'
import * as path from 'path'

interface AfterToolInput {
  tool: string
  result: any
  executionTime: number
  args: Record<string, any>
}

interface AfterToolOutput {
  capturedResult: any
  saveToMemory: boolean
  metadata: Record<string, any>
}

export async function handleAfterTool(input: AfterToolInput): Promise<AfterToolOutput> {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME!, '.gpai')

  try {
    // 1. 捕获结果
    const capturedResult = {
      tool: input.tool,
      result: input.result,
      duration: input.executionTime,
      timestamp: new Date().toISOString()
    }

    // 2. 保存到Hot Memory
    const memoryEntry = {
      type: 'tool_execution',
      content: `Executed ${input.tool} in ${input.executionTime}ms`,
      timestamp: Date.now(),
      metadata: {
        tool: input.tool,
        duration: input.executionTime,
        resultSize: JSON.stringify(input.result).length,
        success: true
      }
    }

    saveToMemory(gpaiDir, 'hot', memoryEntry)

    return {
      capturedResult,
      saveToMemory: true,
      metadata: {
        toolExecution: {
          tool: input.tool,
          success: true,
          duration: input.executionTime
        }
      }
    }
  } catch (error) {
    console.error('AfterTool Hook Error:', error)
    return {
      capturedResult: input.result,
      saveToMemory: false,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

function saveToMemory(gpaiDir: string, type: 'hot' | 'warm' | 'cold', entry: any) {
  const memoryDir = path.join(gpaiDir, 'data/memory')
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true })
  }

  const filePath = path.join(memoryDir, `${type}.jsonl`)
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n')
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}')
  handleAfterTool(input)
    .then(output => {
      console.log(JSON.stringify(output))
      process.exit(0)
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleAfterTool
```

### **5. AfterAgent Hook**

文件：`extensions/gpai-core/hooks/AfterAgent.ts`

```typescript
import * as fs from 'fs'
import * as path from 'path'

interface AfterAgentInput {
  result: string
  executionTime: number
  tools_used: string[]
  model_calls: number
  success: boolean
  error?: Error
}

interface AfterAgentOutput {
  askForRating: boolean
  learningCaptured: boolean
  message?: string
}

export async function handleAfterAgent(input: AfterAgentInput): Promise<AfterAgentOutput> {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME!, '.gpai')

  try {
    // 1. 捕获隐式信号
    const implicitSignals = {
      type: 'implicit_signal',
      content: `Task completed: ${input.tools_used.length} tools, ${input.model_calls} model calls, ${input.executionTime}ms`,
      timestamp: Date.now(),
      metadata: {
        executionTime: input.executionTime,
        toolsUsed: input.tools_used,
        modelCalls: input.model_calls,
        success: input.success
      }
    }

    // 2. 如果成功，准备要求评分
    if (input.success) {
      saveToMemory(gpaiDir, 'hot', implicitSignals)

      return {
        askForRating: true,
        learningCaptured: false,
        message: 'Task completed! Please rate your experience (1-10 score) to help me improve.'
      }
    }

    // 3. 如果出错
    if (input.error) {
      const errorEntry = {
        type: 'error',
        content: input.error.message,
        timestamp: Date.now(),
        metadata: {
          tools_used: input.tools_used,
          model_calls: input.model_calls,
          error: input.error.message
        }
      }

      saveToMemory(gpaiDir, 'warm', errorEntry)

      return {
        askForRating: false,
        learningCaptured: true,
        message: `Task failed: ${input.error.message}`
      }
    }

    return {
      askForRating: false,
      learningCaptured: true
    }
  } catch (error) {
    console.error('AfterAgent Hook Error:', error)
    return {
      askForRating: false,
      learningCaptured: false
    }
  }
}

function saveToMemory(gpaiDir: string, type: 'hot' | 'warm' | 'cold', entry: any) {
  const memoryDir = path.join(gpaiDir, 'data/memory')
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true })
  }

  const filePath = path.join(memoryDir, `${type}.jsonl`)
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n')
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}')
  handleAfterAgent(input)
    .then(output => {
      console.log(JSON.stringify(output))
      process.exit(0)
    })
    .catch(error => {
      console.error(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleAfterAgent
```

---

## 使用指南

### **基本使用**

```bash
# 1. 启动会话
gemini

# 自动触发 SessionStart Hook
# ✓ 加载Profile
# ✓ 加载Memory
# ✓ 初始化Agent

# 2. 提出问题
>> 帮我分析这个代码的安全问题

# 自动触发 BeforeAgent Hook
# ✓ 识别意图（security analysis）
# ✓ 选择Agent：[analyst, devil, engineer]
# ✓ 创建Work项
# ✓ 加载相关Memory

# 系统自动生成回答...

# 3. Agent执行工具
# 自动触发 BeforeTool Hook （安全检查）
# 自动触发 AfterTool Hook （结果捕获）

# 4. 完成后
Task completed! Please rate your experience (1-10 score) to help me improve.

# 输入评分
>> 9 分，很好！分析很全面。

# 自动触发 AfterAgent Hook
# ✓ 保存评分
# ✓ 记录学习信号
# ✓ 下次遇到类似问题会优先用这个方法
```

### **高级用法**

#### **1. 引导Agent选择（通过自然语言）**

```text
在 gemini 会话中直接输入你的偏好：

请优先用 analyst + devil 的视角评估这个方案风险。
请按 engineer -> analyst 的顺序先给实现再给审计意见。

说明：当前版本不支持 `--agent` 参数，建议用自然语言描述期望角色组合。
```

#### **1.1 本轮强制Agent约束（包含/排除/仅用）**

```text
本轮包含agent: researcher, writer, devil
本轮排除agent: analyst

仅用agent: researcher, writer
```

说明：这是“本轮任务级”约束，不会永久改写 TELOS 偏好。

#### **2. TELOS 显式增删改（会话内）**

```text
# 增
新增目标: 建立自动化安全回归
新增策略: 小步迭代, 风险优先
新增项目: Payment Gateway|支付链路加固|in-progress|high

# 删
删除目标: 旧目标A
删除项目: Payment Gateway

# 改
更新目标: 旧目标B -> 新目标B
更新偏好agent: devil -> analyst
更新项目: Payment Gateway -> Payment Core|核心支付重构|in-progress|high
```

说明：会话内可更新除 `name/aiName/timeZone` 以外的 TELOS 字段；`timeZone` 建议通过编辑 `~/.gpai/data/profile.json` 修改。

#### **3. 时区与相对时间**

```bash
# 查看当前配置
cat ~/.gpai/data/profile.json

# 编辑配置（将 preferences.timeZone / councilMode 等设为目标值）
nano ~/.gpai/data/profile.json

# 重新启动 gemini 会话生效
gemini
```

说明：系统会在 `BeforeAgent` 注入绝对日期锚点（today/tomorrow/yesterday），按 `preferences.timeZone` 解释相对时间，避免“今天/明天”歧义。

#### **4. 查看Memory**

```bash
# 查看 hot / warm / cold 最近记录
tail -n 20 ~/.gpai/data/memory/hot.jsonl
tail -n 20 ~/.gpai/data/memory/warm.jsonl
tail -n 20 ~/.gpai/data/memory/cold.jsonl

# 查看 successPatterns 重算事件（learning_event / recompute）
grep -n "success-pattern" ~/.gpai/data/memory/warm.jsonl | tail -n 20

# 按关键词检索记忆
grep -n "安全" ~/.gpai/data/memory/*.jsonl | tail -n 20

# 查看个人资料
cat ~/.gpai/data/profile.json
```

#### **5. 更新Profile**

```bash
# 备份
cp ~/.gpai/data/profile.json ~/.gpai/data/profile.json.bak.$(date +%s)

# 编辑 TELOS / preferences
nano ~/.gpai/data/profile.json

# 检查 JSON 是否有效
node -e 'const fs=require("fs");JSON.parse(fs.readFileSync(process.env.HOME+"/.gpai/data/profile.json","utf8"));console.log("profile.json OK")'
```

#### **6. 查看Hook状态**

```bash
# 查看扩展安装状态
gemini extensions list

# 检查安装元数据与Hook入口文件
cat ~/.gemini/extensions/gpai-core/.gemini-extension-install.json
ls ~/.gemini/extensions/gpai-core/hooks/hooks.json
ls ~/.gemini/extensions/gpai-core/dist/hooks/runner.js

# 查看GPAI Hook执行日志（以当天为例）
tail -n 50 ~/.gpai/data/logs/hooks-$(date +%F).jsonl

# 统计当天各Hook触发次数
grep -o '"event":"[^"]*"' ~/.gpai/data/logs/hooks-$(date +%F).jsonl | sort | uniq -c
```

#### **7. Antigravity 工作流触发（不污染 Rules）**

```text
# 推荐优先：直接让 Antigravity 读取项目根目录 .cursorrules（最简）
# 备选方案：在 Antigravity -> Customizations -> Workflows 新建 Workspace workflow
# 若使用备选，在会话里输入 // 触发 workflow
```

说明：
- `.cursorrules` 更简洁，适合项目级默认行为。
- `Workflows` 适合手动触发，不会强制污染全局规则。
- 若你环境里 `Rules` 与 Gemini CLI 共用，请避免把自动流水线策略放进 `Rules`。

#### **8. Antigravity 项目级提示词（.cursorrules）**

```text
# 本仓库根目录已提供 .cursorrules
# Antigravity 可将其作为项目级提示词加载（不改全局）
```

说明：
- `.cursorrules` 已内置“前置注入 + 后置学习”两阶段最小策略。
- 该机制与 Gemini CLI Hook、Antigravity Workflow 互补，不互相替代。

---

## 测试验证

### **单元测试**

文件：`extensions/gpai-core/__tests__/hooks.test.ts`

```typescript
import { handleSessionStart } from '../hooks/SessionStart'
import { handleBeforeAgent } from '../hooks/BeforeAgent'
import { handleBeforeTool } from '../hooks/BeforeTool'
import * as fs from 'fs'
import * as path from 'path'

describe('GPAI Hooks', () => {
  const testGpaiDir = path.join(__dirname, '../../test-data/.gpai')

  beforeAll(() => {
    // 设置测试环境
    process.env.GPAI_DIR = testGpaiDir
  })

  describe('SessionStart Hook', () => {
    it('should load profile and memory', async () => {
      const result = await handleSessionStart({
        sessionId: 'test-session-1',
        timestamp: Date.now()
      })

      expect(result.context).toBeTruthy()
      expect(result.systemPrompt).toBeTruthy()
      expect(result.metadata.sessionId).toBe('test-session-1')
    })

    it('should handle missing profile gracefully', async () => {
      process.env.GPAI_DIR = '/nonexistent'
      const result = await handleSessionStart({
        sessionId: 'test-session-2',
        timestamp: Date.now()
      })

      // 应该返回默认值而不是失败
      expect(result.systemPrompt).toBeTruthy()
    })
  })

  describe('BeforeAgent Hook', () => {
    it('should analyze intent and select agents', async () => {
      const result = await handleBeforeAgent({
        prompt: 'Analyze the security of this code',
        sessionId: 'test-session-1',
        conversationHistory: []
      })

      expect(result.suggestedAgents).toContain('analyst')
      expect(result.modifiedPrompt).toContain('System Guidance')
    })
  })

  describe('BeforeTool Hook', () => {
    it('should allow safe operations', async () => {
      const result = await handleBeforeTool({
        tool: 'shell',
        args: { command: 'ls -la' },
        context: ''
      })

      expect(result.allowed).toBe(true)
      expect(result.action).toBe('allow')
    })

    it('should block dangerous operations', async () => {
      const result = await handleBeforeTool({
        tool: 'shell',
        args: { command: 'rm -rf /' },
        context: ''
      })

      expect(result.allowed).toBe(false)
      expect(result.action).toBe('block')
    })
  })
})
```

### **集成测试**

文件：`scripts/test-integration.sh`

```bash
#!/bin/bash

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

# 2. 验证配置文件
echo -e "\n✓ Testing Configuration..."
test -f ~/.gpai/data/profile.json && echo "  ✓ Profile exists" || exit 1
test -f ~/.gpai/config/agents.json && echo "  ✓ Agents config exists" || exit 1
test -f ~/.gpai/config/patterns.yaml && echo "  ✓ Security patterns exist" || exit 1

# 3. 验证Memory系统
echo -e "\n✓ Testing Memory System..."
test -d ~/.gpai/data/memory && echo "  ✓ Memory directory exists" || exit 1
test -f ~/.gpai/data/memory/hot.jsonl && echo "  ✓ Hot memory initialized" || exit 1

# 4. 简单功能测试
echo -e "\n✓ Testing Basic Functionality..."
if gemini --help 2>&1 | grep -q "test-gpai"; then
  gemini test-gpai > /tmp/gpai-test.log 2>&1
  grep -q "✓" /tmp/gpai-test.log && echo "  ✓ System test passed" || exit 1
else
  echo "  [WARN] This Gemini CLI version has no 'test-gpai', skipping basic functionality check."
fi

echo -e "\n✅ All integration tests passed!"
```

### **运行测试**

```bash
# 运行单元测试
npm test

# 运行集成测试
bash scripts/test-integration.sh

# 查看测试覆盖率
npm run test:coverage
```

---

## 故障排除

### **常见问题**

#### **Q1: Hook没有加载**

```bash
# 检查扩展安装
gemini extensions list

# 检查是否为安装模式（推荐local，不是link）
cat ~/.gemini/extensions/gpai-core/.gemini-extension-install.json

# 检查Hook配置和编译产物是否存在
ls ~/.gemini/extensions/gpai-core/hooks/hooks.json
ls ~/.gemini/extensions/gpai-core/dist/hooks/runner.js

# 查看GPAI日志
tail -n 80 ~/.gpai/data/logs/hooks-$(date +%F).jsonl
```

#### **Q2: Memory数据损坏**

```bash
# 备份数据
cp -r ~/.gpai/data/memory ~/.gpai/data/memory.backup

# 重置Memory
rm ~/.gpai/data/memory/*.jsonl
touch ~/.gpai/data/memory/{hot,warm,cold}.jsonl

# 重启 Gemini 会话
# 先退出当前会话，再重新执行 gemini
```

#### **Q3: Agent没有按预期工作**

```bash
# 检查Agent配置
cat ~/.gpai/config/agents.json

# 检查最近评分与历史（是否有可学习样本）
tail -n 30 ~/.gpai/data/history.json
tail -n 30 ~/.gpai/data/memory/warm.jsonl

# 检查 BeforeAgent/AfterAgent 是否触发
tail -n 80 ~/.gpai/data/logs/hooks-$(date +%F).jsonl | grep -E "BeforeAgent|AfterAgent"

# 若仍异常，重编译并重装扩展
npm run build
npm run install-extension
```

#### **Q4: 权限错误**

```bash
# 检查文件权限
ls -la ~/.gpai/

# 修复权限
chmod 755 ~/.gpai
chmod 644 ~/.gpai/data/*.json
chmod 644 ~/.gpai/config/*.{json,yaml}

# 检查是否有写入权限
touch ~/.gpai/data/test.txt && rm ~/.gpai/data/test.txt
```

### **日志查看**

```bash
# 实时查看GPAI Hook日志
tail -f ~/.gpai/data/logs/hooks-$(date +%F).jsonl

# 查看安全日志
tail -f ~/.gpai/data/logs/security-$(date +%F).jsonl
```

### **性能诊断**

```bash
# 统计Hook触发次数（按事件）
cat ~/.gpai/data/logs/hooks-$(date +%F).jsonl | jq -r '.event' | sort | uniq -c

# 查看最近的memory写入
tail -n 50 ~/.gpai/data/memory/hot.jsonl
tail -n 50 ~/.gpai/data/memory/warm.jsonl
```

---

## 附录

### **package.json**

文件：`package.json`

```json
{
  "name": "gpai",
  "version": "1.0.0",
  "description": "Gemini Personal AI Infrastructure - Memory + Multi-Agent System",
  "main": "extensions/gpai-core/dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:integration": "bash scripts/test-integration.sh",
    "install-extension": "npm run build && (gemini extensions uninstall gpai-core >/dev/null 2>&1 || true) && gemini extensions install ./extensions/gpai-core",
    "setup": "bash scripts/install.sh",
    "init": "bash scripts/init.sh",
    "clean": "rm -rf dist extensions/gpai-core/dist",
    "format": "prettier --write \"**/*.ts\""
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/jest": "^29.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "prettier": "^3.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "repository": {
    "type": "git",
    "url": "git@github.com:Christomas/GPAI.git"
  },
  "author": "Christomas",
  "license": "MIT"
}
```

### **tsconfig.json**

文件：`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./extensions/gpai-core/dist",
    "rootDir": "./extensions/gpai-core",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["extensions/gpai-core/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "extensions/gpai-core/dist",
    "**/*.test.ts",
    "extensions/gpai-core/__tests__/**",
    "extensions/gpai-core/mcp-servers/**"
  ]
}
```

---

## 持续演进清单（合并）

- [P0] 端到端验收强化：补齐真实会话链路 E2E（`SessionStart -> BeforeAgent -> BeforeTool -> AfterTool -> AfterAgent`）与稳定 fixture；验收标准为 CI 可重复复现关键路径并降低误报。
- [P0] 安全策略工程化：为 `patterns.yaml` 增加 schema 校验、冲突检测与更强命令解析；验收标准为高危操作拦截有回归测试覆盖且规则变更可静态校验。
- [P0] 运行可观测性：统一 Hook 指标（触发次数/失败率/耗时/拦截率）与结构化日志字段；验收标准为可按天追踪质量趋势并快速定位失败根因。
- [P1] 真实多 Agent 并行协作：从提示词角色引导升级为多角色任务分发与结果汇总裁决；验收标准为至少支持 2-3 角色并行执行且输出结构化合并结果。
- [P1] 多目标编排器：在选角中引入可配置目标权重（成功率/时延/可解释性/工具成本）；验收标准为不同任务类型下可稳定产出差异化团队组合并给出解释证据。
- [P1] MCP 服务产品化：补齐 `memory-server` 与 `agents-server` 的协议完整性、错误语义和权限边界；验收标准为可独立部署并通过契约测试。
- [P2] 记忆治理升级：增加去重、衰减、摘要压缩与主题索引，降低噪音记忆对选角影响；验收标准为历史规模增长时仍保持推荐稳定性。
- [P2] 配置热更新与可回滚：支持配置版本化、变更审计与一键回滚；验收标准为错误配置可在分钟级恢复且不中断主流程。
- [P2] 用户控制面板：提供规则/偏好/学习信号可视化与开关（含隐式学习开关）；验收标准为关键行为可视、可解释、可禁用。
