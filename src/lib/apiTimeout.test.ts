import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import type { ApiProfile } from '../types'
import { createDefaultGrokProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'

function settings(profile: ApiProfile) {
  return { ...DEFAULT_SETTINGS, ...profile, profiles: [profile], activeProfileId: profile.id }
}
function request(profile: ApiProfile, size = '1024x1024', n = 1) {
  return { settings: settings(profile), prompt: 'test', params: { ...DEFAULT_PARAMS, size, n }, inputImageDataUrls: [] }
}
function streamResponse(events: object[], cancel = vi.fn()) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      // Deliberately leave the upstream socket open after the final event.
    }, cancel,
  }), { headers: { 'content-type': 'text/event-stream' } })
}

describe('GPT and Grok complete request timeout regression', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it.each(['images', 'responses'] as const)('keeps the %s deadline active after streaming headers arrive', async (apiMode) => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let fetchSignal!: AbortSignal
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      fetchSignal = init!.signal!
      return streamResponse([], cancel)
    })
    const result = callImageApi(request(createDefaultOpenAIProfile({ apiKey: 'test', apiMode, timeout: 10 })))
    const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(10_000)
    await failure
    expect(fetchSignal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['images', 'responses'] as const)('finishes %s immediately on its final image without waiting for EOF', async (apiMode) => {
    const cancel = vi.fn()
    const event = apiMode === 'images'
      ? { type: 'image_generation.completed', b64_json: 'aW1hZ2U=' }
      : { type: 'response.completed', response: { output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }] } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([event], cancel))
    const result = await callImageApi(request(createDefaultOpenAIProfile({ apiKey: 'test', apiMode })))
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps every completed image when a nonstreaming multi-image request receives SSE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse([
      { type: 'image_generation.completed', b64_json: 'Zmlyc3Q=' },
      { type: 'image_generation.completed', b64_json: 'c2Vjb25k' },
    ]))
    const result = await callImageApi(request(createDefaultGrokProfile({ apiKey: 'test' }), '1024x1024', 2))
    expect(result.images).toEqual(['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'])
  })

  it.each(['gpt', 'grok'])('allows %s 4K to finish after a saved legacy 600 second budget', async (model) => {
    vi.useFakeTimers()
    const profile = (model === 'grok' ? createDefaultGrokProfile : createDefaultOpenAIProfile)({ apiKey: 'test', timeout: 600 })
    let fetchSignal!: AbortSignal
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      fetchSignal = init!.signal!
      await new Promise((resolve) => setTimeout(resolve, 650_000))
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    })
    const result = callImageApi(request(profile, '2880x2880'))
    await vi.advanceTimersByTimeAsync(601_000)
    expect(fetchSignal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(49_000)
    expect((await result).images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds stalled image URL downloads after a successful JSON response', async () => {
    vi.useFakeTimers()
    let downloadSignal!: AbortSignal
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://images.example/test.png' }] })))
      .mockImplementationOnce(async (_input, init) => {
        downloadSignal = init!.signal!
        return new Promise(() => {})
      })
    const result = callImageApi(request(createDefaultGrokProfile({ apiKey: 'test', timeout: 10 })))
    const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError', rawImageUrls: ['https://images.example/test.png'] })
    await vi.advanceTimersByTimeAsync(10_000)
    await failure
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(downloadSignal.aborted).toBe(true)
  })

  it('retains a successful concurrent image when another request stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(streamResponse([{ type: 'image_generation.completed', b64_json: 'aW1hZ2U=' }]))
      .mockImplementationOnce(async () => new Promise(() => {}))
    const result = callImageApi(request(createDefaultOpenAIProfile({ apiKey: 'test', timeout: 10, streamImages: true }), '1024x1024', 2))
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await result).images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
