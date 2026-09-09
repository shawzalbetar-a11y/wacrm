import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Embeddings (OpenAI + Google Gemini compatible).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval.
// 1536-dim text-embedding-3-small / text-embedding-004 matches the
// `vector(1536)` column in migration 030.
// ============================================================

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const GEMINI_EMBEDDINGS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

// Keep batches modest so a big re-index stays under request-size limits
const BATCH_SIZE = 96

interface OpenAiEmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
}

interface GeminiEmbeddingResponse {
  embeddings?: { values?: number[] }[]
  error?: { message?: string; code?: number }
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

async function discoverEmbeddingModel(apiKey: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[]
    } | null
    if (!data?.models || !Array.isArray(data.models)) return null

    const eligible = data.models.filter(
      (m) =>
        m.name &&
        Array.isArray(m.supportedGenerationMethods) &&
        (m.supportedGenerationMethods.includes('embedContent') ||
          m.supportedGenerationMethods.includes('batchEmbedContents')),
    )

    const first = eligible[0]
    if (first?.name) return first.name.replace(/^models\//, '')
  } catch {
    // Non-blocking fallback
  }
  return null
}

async function executeGeminiBatchEmbed(
  model: string,
  apiKey: string,
  batch: string[],
  timeoutMs: number,
): Promise<Response> {
  const modelName = model.replace(/^models\//, '')
  const requests = batch.map((text) => ({
    model: `models/${modelName}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  }))

  return await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:batchEmbedContents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
}

async function embedWithGemini(
  apiKey: string,
  batch: string[],
  timeoutMs: number,
): Promise<number[][]> {
  const primaryModel = 'gemini-embedding-001'
  let res: Response = await executeGeminiBatchEmbed(primaryModel, apiKey, batch, timeoutMs)

  if (!res.ok) {
    const discovered = await discoverEmbeddingModel(apiKey, timeoutMs)
    if (discovered && discovered !== primaryModel) {
      const retryRes = await executeGeminiBatchEmbed(discovered, apiKey, batch, timeoutMs)
      if (retryRes.ok) {
        res = retryRes
      }
    }

    if (!res.ok) {
      const fallbacks = [
        'gemini-embedding-001',
        'text-embedding-004',
        'embedding-001',
        'text-embedding-005',
      ]
      for (const fb of fallbacks) {
        if (fb === primaryModel || fb === discovered) continue
        const retryRes = await executeGeminiBatchEmbed(fb, apiKey, batch, timeoutMs)
        if (retryRes.ok) {
          res = retryRes
          break
        }
      }
    }
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as GeminiEmbeddingResponse | null
    if (errBody?.error?.message) {
      throw new AiError(`Gemini embeddings: ${errBody.error.message}`, {
        code: `http_${res.status}`,
        status: res.status,
      })
    }
    throw await providerHttpError('Gemini embeddings', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiEmbeddingResponse | null
  const rows = data?.embeddings
  if (!rows || rows.length !== batch.length) {
    throw new AiError('Gemini embeddings response was malformed.', {
      code: 'embeddings_malformed',
    })
  }

  const out: number[][] = []
  for (const r of rows) {
    if (!Array.isArray(r.values)) {
      throw new AiError('Gemini embeddings response missing vector values.', {
        code: 'embeddings_malformed',
      })
    }
    out.push(r.values)
  }
  return out
}

async function embedWithOpenAi(
  apiKey: string,
  batch: string[],
  timeoutMs: number,
): Promise<number[][]> {
  let res: Response
  try {
    res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI embeddings', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiEmbeddingResponse | null
  const rows = data?.data
  if (!rows || rows.length !== batch.length) {
    throw new AiError('Embeddings response was malformed.', {
      code: 'embeddings_malformed',
    })
  }

  if (rows.some((r) => typeof r.index !== 'number')) {
    throw new AiError('Embeddings response was missing result indices.', {
      code: 'embeddings_malformed',
    })
  }
  const ordered = [...rows].sort((a, b) => a.index! - b.index!)
  const out: number[][] = []
  for (const r of ordered) {
    if (!Array.isArray(r.embedding)) {
      throw new AiError('Embeddings response missing a vector.', {
        code: 'embeddings_malformed',
      })
    }
    out.push(r.embedding)
  }
  return out
}

/**
 * Embed a list of strings, preserving input order.
 * Automatically selects Google Gemini (text-embedding-004) or OpenAI (text-embedding-3-small)
 * based on the API key format (any non-sk-* key is treated as Google Gemini).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  const isGemini = !apiKey.startsWith('sk-')

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)
    let batchResult: number[][]

    if (isGemini) {
      try {
        batchResult = await embedWithGemini(apiKey, batch, timeoutMs)
      } catch (err) {
        if (apiKey.startsWith('sk-')) {
          batchResult = await embedWithOpenAi(apiKey, batch, timeoutMs)
        } else {
          throw err
        }
      }
    } else {
      try {
        batchResult = await embedWithOpenAi(apiKey, batch, timeoutMs)
      } catch (err) {
        try {
          batchResult = await embedWithGemini(apiKey, batch, timeoutMs)
        } catch {
          throw err
        }
      }
    }

    out.push(...batchResult)
  }

  return out
}
