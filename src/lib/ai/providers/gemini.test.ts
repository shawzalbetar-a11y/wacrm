import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateGemini } from './gemini'
import { AiError } from '../types'

describe('generateGemini adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls native Gemini generateContent endpoint and returns text and usage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
                  },
                ],
                role: 'model',
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 8,
            totalTokenCount: 23,
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
          candidates: [
            {
              content: {
                parts: [{ text: '   ' }],
                role: 'model',
              },
            },
          ],
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

  it('recovers from 404 by discovering active model', async () => {
    // First call returns 404 (model not found)
    // Second call to listModels returns available models
    // Third call with discovered model succeeds
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 404, message: 'models/gemini-1.5-flash is not found' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-flash',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Auto-discovered response' }],
                  role: 'model',
                },
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    const result = await generateGemini({
      apiKey: 'AIzaSyTestKey123',
      model: 'gemini-1.5-flash',
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 5000,
    })

    expect(result.text).toBe('Auto-discovered response')
  })

  it('recovers from model deprecated error by using suggested model', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message:
                'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Response from 3.6-flash' }],
                  role: 'model',
                },
              },
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    const result = await generateGemini({
      apiKey: 'AIzaSyTestKey123',
      model: 'gemini-2.5-flash',
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 5000,
    })

    expect(result.text).toBe('Response from 3.6-flash')
  })
})
