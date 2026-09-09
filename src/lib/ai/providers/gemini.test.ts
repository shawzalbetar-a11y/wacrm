import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateGemini } from './gemini'
import { AiError } from '../types'

describe('generateGemini adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls Gemini endpoint and returns text and usage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
              },
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 8,
            total_tokens: 23,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const result = await generateGemini({
      apiKey: 'AIzaSyTestKey123',
      model: 'gemini-1.5-flash',
      systemPrompt: 'You are an AI assistant.',
      messages: [{ role: 'user', content: 'مرحبا' }],
      timeoutMs: 5000,
    })

    expect(result.text).toBe('مرحباً! كيف يمكنني مساعدتك اليوم؟')
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 8,
      totalTokens: 23,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws AiError on empty response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '   ' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(
      generateGemini({
        apiKey: 'AIzaSyTestKey123',
        model: 'gemini-1.5-flash',
        systemPrompt: '',
        messages: [{ role: 'user', content: 'hello' }],
        timeoutMs: 5000,
      })
    ).rejects.toThrow(AiError)
  })
})
