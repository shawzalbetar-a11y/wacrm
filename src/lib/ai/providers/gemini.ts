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

interface GeminiModelInfo {
  name: string
  supportedGenerationMethods?: string[]
}

interface GeminiListModelsResponse {
  models?: GeminiModelInfo[]
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
 * Query Gemini's ListModels to dynamically discover active models for the user's API key
 */
async function discoverAvailableModel(apiKey: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': apiKey,
      },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as GeminiListModelsResponse | null
    if (!data?.models || !Array.isArray(data.models)) return null

    const eligible = data.models.filter(
      (m) =>
        m.name &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        !m.name.includes('embedding'),
    )

    // Prefer flash models, then pro models, then any eligible
    const flash = eligible.find((m) => m.name.includes('flash'))
    if (flash) return flash.name.replace(/^models\//, '')

    const pro = eligible.find((m) => m.name.includes('pro'))
    if (pro) return pro.name.replace(/^models\//, '')

    if (eligible[0]) return eligible[0].name.replace(/^models\//, '')
  } catch {
    // Non-blocking fallback
  }
  return null
}

async function executeGeminiRequest(
  model: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  return await fetch(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Call Google's official Gemini REST API (v1beta/models/...:generateContent).
 * Supports standard Google AI Studio keys (AIzaSy...).
 * Includes auto-discovery fallback if a specific model returns 404.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, systemPrompt, messages, timeoutMs } = args

  // Sanitize model name
  let model = (args.model || 'gemini-2.5-flash').trim().replace(/^models\//, '')
  if (
    model.startsWith('gpt-') ||
    model.startsWith('claude-') ||
    model === 'gemini-pro' ||
    model === 'gemini-1.0-pro' ||
    model.startsWith('gemini-1.0') ||
    !model
  ) {
    model = 'gemini-2.5-flash'
  }

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
    res = await executeGeminiRequest(model, apiKey, payload, timeoutMs)

    // If model returned 404 (not supported / deprecated in v1beta), auto-discover active model on this key
    if (res.status === 404) {
      const discovered = await discoverAvailableModel(apiKey, timeoutMs)
      if (discovered && discovered !== model) {
        res = await executeGeminiRequest(discovered, apiKey, payload, timeoutMs)
      } else {
        const fallbacks = [
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-1.5-flash-latest',
          'gemini-1.5-pro',
        ]
        for (const fb of fallbacks) {
          if (fb === model) continue
          const retryRes = await executeGeminiRequest(fb, apiKey, payload, timeoutMs)
          if (retryRes.ok) {
            res = retryRes
            break
          }
        }
      }
    }
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
