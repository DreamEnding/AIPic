import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api-proxy/[[path]]'
import { callImageApi } from '../src/lib/api'
import { createDefaultGrokProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS } from '../src/lib/apiProfiles'
import { DEFAULT_PARAMS } from '../src/types'

const image = 'aW1hZ2U='
const jsonImage = JSON.stringify({ data: [{ b64_json: image }] })
const sseImage = `data: ${JSON.stringify({ type: 'image_generation.completed', b64_json: image })}\n\n`

function connectProxy(upstream: (init: RequestInit) => Promise<Response>) {
  const upstreamCalls: RequestInit[] = []
  const nativeFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith('data:')) return nativeFetch(input, init)
    if (typeof input === 'string' && input.startsWith('/api-proxy/')) {
      const request = new Request(`https://aipic.example${input}`, init)
      return onRequest({ request, env: {} } as never)
    }
    expect(String(input)).toMatch(/^https:\/\/models.example\/v1\//)
    upstreamCalls.push(init!)
    return upstream(init!)
  })
  return upstreamCalls
}

describe('GPT/Grok through actual Pages handler and client decoder', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

  it.each(['gpt', 'grok'])('completes %s 4K after 650 seconds with an old saved 600 second setting', async (provider) => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    let signal!: AbortSignal
    const calls = connectProxy(async (init) => {
      signal = init.signal!
      await new Promise((resolve) => setTimeout(resolve, 650_000))
      return new Response(provider === 'gpt' ? sseImage : jsonImage, {
        headers: { 'content-type': provider === 'gpt' ? 'text/event-stream' : 'application/json' },
      })
    })
    const profile = (provider === 'gpt' ? createDefaultOpenAIProfile : createDefaultGrokProfile)({
      apiKey: 'test-key', apiProxy: true, baseUrl: 'https://models.example/v1', timeout: 600,
    })
    const result = callImageApi({
      settings: { ...DEFAULT_SETTINGS, ...profile, profiles: [profile], activeProfileId: profile.id },
      params: { ...DEFAULT_PARAMS, size: '2880x2880' }, prompt: 'test', inputImageDataUrls: [],
    })
    await vi.advanceTimersByTimeAsync(601_000)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(49_000)
    expect((await result).images).toEqual([`data:image/png;base64,${image}`])
    expect(calls).toHaveLength(1)
    const sentHeaders = new Headers(calls[0].headers)
    expect(sentHeaders.get('authorization')).toBe('Bearer test-key')
    expect(sentHeaders.has('x-aipic-proxy-stream')).toBe(false)
    expect(sentHeaders.has('x-aipic-timeout-seconds')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves multipart reference images for Grok editing through the keepalive transport', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const calls = connectProxy(async (init) => {
      const data = await new Response(init.body, { headers: init.headers }).formData()
      expect(data.get('model')).toBe('grok-imagine-image')
      expect(data.get('size')).toBe('3840x2160')
      expect(data.get('stream')).toBeNull()
      expect(data.get('response_format')).toBe('b64_json')
      expect((data.get('image[]') as Blob).size).toBe(5)
      return new Response(jsonImage, { headers: { 'content-type': 'application/json' } })
    })
    const profile = createDefaultGrokProfile({ apiKey: 'test-key', apiProxy: true, baseUrl: 'https://models.example/v1' })
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, ...profile, profiles: [profile], activeProfileId: profile.id },
      params: { ...DEFAULT_PARAMS, size: '3840x2160' }, prompt: 'test', inputImageDataUrls: [`data:image/png;base64,${image}`],
    })
    expect(result.images).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('reports an upstream 524 and never resubmits the paid image generation', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const calls = connectProxy(async () => new Response('<title>524: A timeout occurred</title>', {
      status: 524, headers: { 'content-type': 'text/html' },
    }))
    const profile = createDefaultGrokProfile({ apiKey: 'test-key', apiProxy: true, baseUrl: 'https://models.example/v1' })
    await expect(callImageApi({
      settings: { ...DEFAULT_SETTINGS, ...profile, profiles: [profile], activeProfileId: profile.id },
      params: { ...DEFAULT_PARAMS, size: '3840x2160' }, prompt: 'test', inputImageDataUrls: [],
    })).rejects.toMatchObject({ status: 524, rawResponsePayload: expect.stringContaining('A timeout occurred') })
    expect(calls).toHaveLength(1)
  })
})
