import * as fs from 'fs'
import * as path from 'path'
import { handleSessionStart } from '../hooks/SessionStart'
import { handleBeforeAgent } from '../hooks/BeforeAgent'
import { handleBeforeTool } from '../hooks/BeforeTool'

describe('GPAI Hooks', () => {
  const testGpaiDir = path.resolve(__dirname, '../../../test-data/.gpai')

  beforeAll(() => {
    process.env.GPAI_DIR = testGpaiDir

    const warmPath = path.join(testGpaiDir, 'data/memory/warm.jsonl')
    const hotPath = path.join(testGpaiDir, 'data/memory/hot.jsonl')

    fs.mkdirSync(path.dirname(warmPath), { recursive: true })
    fs.writeFileSync(
      warmPath,
      `${JSON.stringify({
        type: 'success',
        content: 'Security review found SQL injection risk',
        rating: 9
      })}\n`
    )
    fs.writeFileSync(hotPath, '')
  })

  afterAll(() => {
    delete process.env.GPAI_DIR
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

      expect(result.systemPrompt).toBeTruthy()
      expect(result.systemPrompt).toContain('intelligent AI assistant')
      process.env.GPAI_DIR = testGpaiDir
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
