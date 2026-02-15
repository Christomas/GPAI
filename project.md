# 📘 GPAI 完整项目实现计划

## 目录

1. [项目结构](#项目结构)
2. [环境要求](#环境要求)
3. [安装步骤](#安装步骤)
4. [配置说明](#配置说明)
5. [核心代码实现](#核心代码实现)
6. [使用指南](#使用指南)
7. [测试验证](#测试验证)
8. [故障排除](#故障排除)

---

## 项目结构

```
GPAI/
├── 📁 extensions/
│   └── 📁 gpai-core/
│       ├── gemini-extension.json          ← 扩展声明
│       ├── hooks.json                     ← Hook配置
│       ├── 📁 hooks/                      ← Hook实现
│       │   ├── SessionStart.ts
│       │   ├── BeforeAgent.ts
│       │   ├── BeforeTool.ts
│       │   ├── AfterTool.ts
│       │   ├── AfterAgent.ts
│       │   ├── PreCompress.ts
│       │   └── index.ts
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
│   └── prompts.json                      ← 提示词库
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
│   └── setup-mcp.sh                      ← MCP设置
│
├── .env.example                          ← 环境变量示例
├── .gitignore
├── package.json                          ← 项目依赖
├── tsconfig.json                         ← TypeScript配置
├── README.md                             ← 文档
└── INSTALL.md                            ← 安装指南
```

---

## 环境要求

### **必需**
- Node.js >= 18.0.0
- npm >= 9.0.0 或 yarn >= 3.0.0
- Gemini CLI >= 1.0.0
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
# 生成 dist/ 目录
```

### **步骤2：初始化GPAI**

```bash
# 运行初始化向导
./scripts/init.sh

# 向导会问：
# 1. 你的名字？ → John Doe
# 2. AI助手名称？ → Kai
# 3. 你的使命是什么？ → 构建安全的系统
# 4. 当前目标？ → 提高代码质量，找出漏洞
# 5. 工作风格？ → 直接、注重细节
# 6. 倾向的Agent？ → engineer, analyst
# 7. Google API Key？ → sk-xxx...

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
# 安装GPAI扩展
gemini extensions install ./extensions/gpai-core

# 验证安装
gemini extensions list
# 输出应该包含：gpai-core (v1.0.0)

# 验证Hook是否加载
gemini hooks list
# 输出应该包含：
# - SessionStart
# - BeforeAgent
# - BeforeTool
# - AfterTool
# - AfterAgent
# - PreCompress
```

### **步骤4：设置环境变量**

```bash
# 复制示例配置
cp .env.example ~/.gpai/.env

# 编辑配置文件
nano ~/.gpai/.env

# 必需配置：
# GOOGLE_API_KEY=sk-xxx...
# GPAI_DIR=~/.gpai
# GPAI_DEBUG=false
# MEMORY_MODE=jsonl
```

### **步骤5：测试安装**

```bash
# 运行测试
npm test

# 输出应该显示：
# ✓ SessionStart Hook 加载成功
# ✓ BeforeAgent Hook 加载成功
# ✓ Memory系统初始化成功
# ✓ 所有Hook就绪

# 测试Gemini CLI集成
gemini test-gpai

# 输出：
# GPAI v1.0.0
# 扩展状态：✓ 已加载
# Hooks状态：✓ 6/6 已就绪
# Memory状态：✓ 就绪
# 系统状态：✓ 正常
```

---

## 配置说明

### **1. profile.json - 用户身份（TELOS）**

`~/.gpai/data/profile.json`

```json
{
  "user": {
    "name": "John Doe",
    "aiName": "Kai",
    "email": "john@example.com"
  },
  
  "mission": "构建安全的、可靠的系统，帮助人们实现他们的目标",
  
  "goals": [
    "提高代码安全性",
    "建立自动化工作流",
    "学习新的安全技术",
    "建立知识库"
  ],
  
  "projects": [
    {
      "name": "项目A",
      "description": "安全审计工具",
      "status": "进行中",
      "priority": "高"
    }
  ],
  
  "beliefs": [
    "安全优先于功能",
    "自动化减少人为错误",
    "知识应该共享"
  ],
  
  "models": [
    "系统安全 = 架构 + 实现 + 运维",
    "好的工程 = 清晰思考 + 严谨执行 + 持续改进"
  ],
  
  "strategies": [
    "使用第一性原理分析问题",
    "多角度(Council)思考重要决策",
    "自动化重复性工作"
  ],
  
  "learnings": [
    "OSINT方法很有效",
    "Council模式产生更好的决策",
    "自动化脚本省时50%+"
  ],
  
  "preferences": {
    "communicationStyle": "direct",
    "detailLevel": "medium",
    "responseLength": "concise",
    "preferredAgents": ["engineer", "analyst"],
    "councilMode": true,
    "learningEnabled": true
  },
  
  "successPatterns": [
    {
      "task": "代码审查",
      "method": "engineer + devil council",
      "successRate": 0.92,
      "lastUsed": "2026-02-10"
    },
    {
      "task": "安全研究",
      "method": "analyst + devil council",
      "successRate": 0.88,
      "lastUsed": "2026-02-08"
    }
  ]
}
```

### **2. agents.json - Agent定义**

`~/.gpai/config/agents.json`

```json
{
  "agents": [
    {
      "id": "engineer",
      "name": "工程师",
      "role": "Technical Expert",
      "personality": "严谨、关注细节、实用",
      "systemPrompt": "你是一个资深的软件工程师。你的特点：代码优先、关注性能和安全、实用而不是理论、直接指出问题。",
      "expertise": [
        "coding",
        "debugging",
        "architecture",
        "performance",
        "security-implementation"
      ],
      "speed": "fast",
      "responseStyle": "technical"
    },
    
    {
      "id": "analyst",
      "name": "分析师",
      "role": "Data & Security Analyst",
      "personality": "深思熟虑、全面、谨慎",
      "systemPrompt": "你是一个资深的安全分析师。你的特点：全面思考、找出风险、提供详细分析、给出行动方案。",
      "expertise": [
        "security",
        "analysis",
        "research",
        "risk-assessment",
        "data-science"
      ],
      "speed": "thorough",
      "responseStyle": "analytical"
    },
    
    {
      "id": "devil",
      "name": "反对者",
      "role": "Critical Thinker",
      "personality": "怀疑、找漏洞、逆向思维",
      "systemPrompt": "你是一个爱挑战的批判性思维家。你的特点：找出问题和漏洞、提出反对意见、质疑假设、防止集体思维。",
      "expertise": [
        "critical-thinking",
        "risk-analysis",
        "questioning",
        "debugging",
        "threat-modeling"
      ],
      "speed": "fast",
      "responseStyle": "critical"
    },
    
    {
      "id": "creator",
      "name": "创意者",
      "role": "Creative Strategist",
      "personality": "开放、突破常规、想象力丰富",
      "systemPrompt": "你是一个富有创意的策略家。你的特点：打破常规、提供创意方案、从不同角度思考、鼓励创新。",
      "expertise": [
        "creativity",
        "strategy",
        "innovation",
        "marketing",
        "problem-solving"
      ],
      "speed": "balanced",
      "responseStyle": "creative"
    }
  ],
  
  "intentToAgents": {
    "analysis": ["analyst", "engineer", "devil"],
    "creative": ["creator", "engineer"],
    "technical": ["engineer", "devil"],
    "research": ["analyst", "devil"],
    "strategy": ["creator", "analyst"],
    "security": ["analyst", "devil", "engineer"]
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
    "prompt": "分析用户的请求，返回JSON格式：\n{\"intent\": \"analysis|creative|technical|research|strategy\", \"confidence\": 0-1, \"keywords\": []}\n\n用户请求：{prompt}",
    "temperature": 0.3
  },
  
  "agent_selection": {
    "prompt": "根据任务类型'{intent}'，选择最合适的Agent组合。返回：[\"agent1\", \"agent2\", \"agent3\"]\n\n可用Agent: {available_agents}\n\n任务：{task}",
    "temperature": 0.2
  },
  
  "council_synthesis": {
    "prompt": "你现在是一个综合专家。\n\n以下是各角色的观点：\n{individual_views}\n\n请综合这些观点，给出最优的、经过多角度思考的答案。",
    "temperature": 0.5
  }
}
```

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
import { parse as parseYaml } from 'yaml'

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

  return parseYaml(fs.readFileSync(patternsPath, 'utf-8'))
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

#### **1. 强制使用特定Agent**

```bash
>> --agent devil: 这个方案有什么风险？

# 只用Devil Agent (反对者角度)
# 快速找出问题和漏洞
```

#### **2. 使用Council模式**

```bash
>> --council: 我应该用什么技术栈？

# 所有Agent一起讨论
# Engineer: 性能和稳定性考虑
# Analyst: 成本和学习曲线
# Creator: 创新和未来性
# Devil: 可能的问题和限制
```

#### **3. 查看Memory**

```bash
# 查看最近的成功模式
gemini memory --type warm --limit 10

# 查看特定主题的记忆
gemini memory --search "安全" --limit 5

# 查看个人资料
gemini profile --show
```

#### **4. 更新Profile**

```bash
# 编辑TELOS
gemini profile --edit

# 或命令行直接更新
gemini profile --update-goal "学习Rust"
```

#### **5. 查看Hook状态**

```bash
# 列出所有Hook
gemini hooks list

# 查看Hook日志
gemini hooks log --hook SessionStart --lines 20
```

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

echo "🧪 GPAI Integration Tests"

# 1. 验证Hook加载
echo -e "\n✓ Testing Hook Loading..."
gemini hooks list | grep -q "SessionStart" && echo "  ✓ SessionStart loaded" || exit 1
gemini hooks list | grep -q "BeforeAgent" && echo "  ✓ BeforeAgent loaded" || exit 1
gemini hooks list | grep -q "BeforeTool" && echo "  ✓ BeforeTool loaded" || exit 1
gemini hooks list | grep -q "AfterAgent" && echo "  ✓ AfterAgent loaded" || exit 1

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
gemini test-gpai > /tmp/gpai-test.log 2>&1
grep -q "✓" /tmp/gpai-test.log && echo "  ✓ System test passed" || exit 1

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

# 检查Hook状态
gemini hooks list

# 重新加载扩展
gemini extensions reload gpai-core

# 查看日志
cat ~/.gemini/logs/hooks.log
```

#### **Q2: Memory数据损坏**

```bash
# 备份数据
cp -r ~/.gpai/data/memory ~/.gpai/data/memory.backup

# 重置Memory
rm ~/.gpai/data/memory/*.jsonl
touch ~/.gpai/data/memory/{hot,warm,cold}.jsonl

# 重启会话
gemini clear-session
gemini
```

#### **Q3: Agent没有按预期工作**

```bash
# 检查Agent配置
cat ~/.gpai/config/agents.json

# 检查意图分析
gemini debug --analyze-intent "你的问题"

# 启用Debug模式
export GPAI_DEBUG=true
gemini --debug
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
# 实时日志
gemini logs --follow

# 特定日期的日志
gemini logs --date 2026-02-15

# 特定级别的日志
gemini logs --level ERROR

# Hook执行日志
gemini hooks log --hook BeforeAgent --tail 50
```

### **性能诊断**

```bash
# 分析Hook执行时间
gemini profile --show-hook-times

# 内存使用情况
gemini memory --stats

# Gemini API调用统计
gemini stats --api-calls
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
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:integration": "bash scripts/test-integration.sh",
    "install-extension": "gemini extensions install ./extensions/gpai-core",
    "setup": "bash scripts/setup.sh",
    "init": "bash scripts/init.sh",
    "clean": "rm -rf dist/ node_modules/",
    "format": "prettier --write \"**/*.ts\""
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "yaml": "^2.3.0",
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
  "author": "Your Name",
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
    "outDir": "./dist",
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
  "include": ["extensions/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```
