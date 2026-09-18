import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchImageResponse } from './imageProxyTransport'

const encode = (frame: object) => new TextEncoder().encode(`${JSON.stringify(frame)}\n`)
const responseFrame = { type: 'response', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } }
function transport(frames: object[]) {
  return new Response(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''), {
    headers: { 'content-type': 'application/x-aipic-stream; charset=utf-8' },
  })
}

describe('image proxy transport', () => {
  afterEach(() => vi.restoreAllMocks())

  it('unwraps nonstreaming JSON while sending opt-in only to the same-origin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(transport([
      { type: 'heartbeat' }, responseFrame,
      { type: 'chunk', text: '{"data":[' }, { type: 'heartbeat' },
      { type: 'chunk', text: '{"b64_json":"aW1hZ2U="}]}' }, { type: 'end' },
    ]))
    const response = await fetchImageResponse('/api-proxy/images/generations', {
      method: 'POST', headers: { Authorization: 'Bearer test-key' }, body: '{}',
    }, true, 1800)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ data: [{ b64_json: 'aW1hZ2U=' }] })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-key', 'x-aipic-proxy-stream': '1', 'x-aipic-timeout-seconds': '1800',
    })
    const direct = new Response('{}')
    fetchMock.mockResolvedValueOnce(direct)
    expect(await fetchImageResponse('https://api.example.com/v1/images/generations', { method: 'POST' }, false, 1800)).toBe(direct)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('x-aipic-proxy-stream')).toBe(false)
  })

  it('preserves upstream 524 status and its JSON error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(transport([
      { ...responseFrame, status: 524, statusText: 'A timeout occurred' },
      { type: 'chunk', text: '{"error":{"message":"upstream timeout","status":524}}' }, { type: 'end' },
    ]))
    const response = await fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)
    expect(response.status).toBe(524)
    expect(response.ok).toBe(false)
    expect(await response.json()).toEqual({ error: { message: 'upstream timeout', status: 524 } })
  })

  it('handles UTF-8 and frame boundaries split across arbitrary chunks', async () => {
    const bytes = new TextEncoder().encode([
      responseFrame, { type: 'chunk', text: '{"prompt":"图片 🖼️"}' }, { type: 'end' },
    ].map((frame) => `${JSON.stringify(frame)}\n`).join(''))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
        controller.close()
      },
    }), { headers: { 'content-type': 'application/x-aipic-stream' } }))
    const response = await fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)
    expect(await response.json()).toEqual({ prompt: '图片 🖼️' })
  })

  it.each([
    [{ type: 'chunk', text: 'partial' }],
    [{ type: 'chunk', text: 'partial' }, { type: 'error', message: 'upstream disconnected' }],
  ])('rejects truncated or failed image transmission instead of treating it as success', async (...frames) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(transport([responseFrame, ...frames]))
    const response = await fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)
    await expect(response.text()).rejects.toThrow()
  })

  it.each([
    { type: 'response' },
    { ...responseFrame, status: '200' },
    { ...responseFrame, status: 0 },
    { ...responseFrame, headers: { 'content-type': 42 } },
  ])('rejects malformed response metadata instead of inventing success', async (frame) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(transport([frame, { type: 'end' }]))
    await expect(fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)).rejects.toThrow('无法解析')
  })

  it('releases the underlying reader lock after a complete response', async () => {
    const raw = transport([responseFrame, { type: 'chunk', text: '{}' }, { type: 'end' }])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(raw)
    const response = await fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)
    await response.text()
    await Promise.resolve()
    expect(raw.body!.locked).toBe(false)
  })

  it('cancels the underlying connection when aborted before upstream headers', async () => {
    const cancel = vi.fn()
    const abort = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(encode({ type: 'heartbeat' })) }, cancel,
    }), { headers: { 'content-type': 'application/x-aipic-stream' } }))
    const result = fetchImageResponse('/api-proxy/images/generations', { signal: abort.signal }, true, 1800)
    const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    await Promise.resolve()
    abort.abort()
    await failure
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the underlying connection when aborted during the response body', async () => {
    const cancel = vi.fn()
    const abort = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(encode(responseFrame)) }, cancel,
    }), { headers: { 'content-type': 'application/x-aipic-stream' } }))
    const response = await fetchImageResponse('/api-proxy/images/generations', { signal: abort.signal }, true, 1800)
    const failure = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await failure
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the envelope reader when the SSE parser has its final image', async () => {
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(encode(responseFrame)) }, cancel,
    }), { headers: { 'content-type': 'application/x-aipic-stream' } }))
    const response = await fetchImageResponse('/api-proxy/images/generations', {}, true, 1800)
    await response.body!.cancel()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
