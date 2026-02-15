export type SupportedIntent =
  | 'analysis'
  | 'creative'
  | 'technical'
  | 'research'
  | 'strategy'
  | 'security'

function classifyIntent(prompt: string): SupportedIntent {
  const text = prompt.toLowerCase()

  const hasAny = (keywords: string[]): boolean => keywords.some((keyword) => text.includes(keyword))

  if (hasAny(['security', 'vulnerability', 'risk', 'exploit', 'threat', '安全', '漏洞', '风险'])) {
    return 'security'
  }
  if (hasAny(['architecture', 'code', 'bug', 'debug', 'implement', 'typescript', '性能', '代码'])) {
    return 'technical'
  }
  if (hasAny(['research', 'investigate', 'osint', 'analyze market', '调研', '研究'])) {
    return 'research'
  }
  if (hasAny(['strategy', 'plan', 'roadmap', 'decision', '策略', '规划'])) {
    return 'strategy'
  }
  if (hasAny(['creative', 'brainstorm', 'design ideas', '创意', '点子'])) {
    return 'creative'
  }

  return 'analysis'
}

function buildFallbackJson(prompt: string): string {
  const intent = classifyIntent(prompt)
  return JSON.stringify({
    intent,
    confidence: 0.65,
    keywords: prompt
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 5)
  })
}

function extractUserPrompt(prompt: string): string {
  const marker = prompt.includes('用户请求：') ? '用户请求：' : 'User request:'
  if (!prompt.includes(marker)) {
    return prompt
  }

  return prompt.split(marker).slice(1).join(marker).trim() || prompt
}

export async function callGemini(prompt: string, temperature = 0.3): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY
  const userPrompt = extractUserPrompt(prompt)

  if (!apiKey) {
    return buildFallbackJson(userPrompt)
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature
        }
      })
    })

    if (!response.ok) {
      return buildFallbackJson(userPrompt)
    }

    const payload = (await response.json()) as any
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text

    if (typeof text === 'string' && text.trim().length > 0) {
      return text
    }

    return buildFallbackJson(userPrompt)
  } catch {
    return buildFallbackJson(userPrompt)
  }
}

export function inferIntent(prompt: string): SupportedIntent {
  return classifyIntent(prompt)
}
