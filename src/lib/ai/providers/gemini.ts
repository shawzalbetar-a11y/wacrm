import { AiError, type ProviderResult, type ChatMessage } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

interface GeminiContentPart {
  text: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiContentPart[]
}

interface GeminiCandidate {
  content?: {
    parts?: { text?: string }[]
    role?: string
  }
  finishReason?: string
}

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

/**
 * Clean & map messages for Gemini format:
 * - Assistant role is 'model'
 * - Consecutive messages with the same role are combined
 */
function normalizeForGemini(messages: ChatMessage[]): GeminiContent[] {
  const result: GeminiContent[] = []

  for (const msg of messages) {
    if (!msg.content || !msg.content.trim()) continue

    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user'
    const last = result[result.length - 1]

    if (last && last.role === role) {
      last.parts[0].text += `\n\n${msg.content.trim()}`
    } else {
      result.push({
        role,
        parts: [{ text: msg.content.trim() }],
      })
    }
  }

  // Gemini requires at least one user content
  if (result.length === 0) {
    result.push({
      role: 'user',
      parts: [{ text: 'Hello' }],
    })
  }

  return result
}

/**
 * Call Google's official Gemini REST API (v1beta/models/...:generateContent).
 * Supports standard Google AI Studio keys (AIzaSy...).
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, systemPrompt, messages, timeoutMs } = args

  // Sanitize model name: ensure valid Gemini model
  let model = (args.model || 'gemini-1.5-flash').trim().replace(/^models\//, '')
  if (
    model.startsWith('gpt-') ||
    model.startsWith('claude-') ||
    model === 'gemini-pro' ||
    model === 'gemini-1.0-pro' ||
    model.startsWith('gemini-1.0') ||
    !model
  ) {
    model = 'gemini-1.5-flash'
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const payload: Record<string, unknown> = {
    contents: normalizeForGemini(messages),
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    },
  }

  if (systemPrompt && systemPrompt.trim()) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }],
    }
  }

  let res: Response
  try {
    res = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as GeminiResponse | null
    if (errorBody?.error?.message) {
      throw new AiError(`Gemini: ${errorBody.error.message}`, {
        code: `http_${res.status}`,
        status: res.status,
      })
    }
    throw await providerHttpError('Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })

  return { text: text.trim(), usage }
}
