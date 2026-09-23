import { describe, expect, it, vi, afterEach } from 'vitest'
import { limitUpstreamResponse, onRequest } from '../functions/api-proxy/[[path]]'
import { proxyEnv } from './fixtures/proxy-env'
import egress from '../deploy/cloudflare/egress.js'

afterEach(() => vi.unstubAllGlobals())

describe('proxy security boundary', () => {
  it('stops a streaming successful response after the configured byte limit', async () => {
    const response = limitUpstreamResponse(new Response('12345'), 4)
    await expect(response.text()).rejects.toThrow('上游响应超过大小限制')
  })
  it('rejects requests without an application token even when a provider key exists', async () => {
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { headers: { authorization: 'Bearer provider-key' } }), env: proxyEnv() } as never)
    expect(response.status).toBe(401)
  })
  it('shares rate limits through the Durable Object across handler calls', async () => {
    const env = proxyEnv()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))
    for (let i = 0; i < 20; i++) {
      const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { headers: { 'x-aipic-access-token': 'test-access' } }), env } as never)
      expect(response.status).toBe(200)
      await response.text()
    }
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { headers: { 'x-aipic-access-token': 'test-access' } }), env } as never)
    expect(response.status).toBe(429)
  })
  it('rejects oversized chunked bodies and excessive proxy batches before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const body of [' '.repeat(24 * 1024 * 1024 + 1), JSON.stringify({ n: 100 })]) {
      const response = await onRequest({ request: new Request('https://app.example/api-proxy/images/generations', { method: 'POST', headers: { 'x-aipic-access-token': 'test-access', 'content-type': 'application/json' }, body }), env: proxyEnv() } as never)
      expect(response.status).toBe(413)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects redirects to metadata without forwarding Location', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { headers: { 'x-aipic-access-token': 'test-access' } }), env: proxyEnv() } as never)
    expect(response.status).toBe(502)
    expect(response.headers.has('location')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('routes an allowlisted custom provider through controlled egress without forwarding app credentials', async () => {
    let captured: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => { captured = request; return Response.json({ ok: true }) }))
    const providers = '{"custom":"https://models.example.com/v1"}'
    const env = { ...proxyEnv(), AIPIC_PROVIDERS: providers, AIPIC_EGRESS: {
      fetch: (request: Request) => egress.fetch(request, { AIPIC_PROVIDERS: providers, NODE_EGRESS_URL: 'https://backend.example', NODE_EGRESS_TOKEN: 'backend-access' }),
    } }
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { method: 'POST', headers: {
      'x-aipic-access-token': 'test-access', 'x-aipic-provider': 'custom', authorization: 'Bearer provider-test',
      'content-type': 'application/json',
    }, body: '{"n":1}' }), env } as never)
    expect(response.status).toBe(200)
    expect(captured?.url).toBe('https://backend.example/api-proxy/models')
    expect(captured?.headers.get('authorization')).toBe('Bearer provider-test')
    expect(captured?.headers.get('x-aipic-access-token')).toBe('backend-access')
    expect(captured?.headers.get('x-aipic-upstream')).toBe('https://models.example.com/v1')
    expect(await captured!.text()).toBe('{"n":1}')
  })
  it('fails closed when no application authentication is configured', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models'), env: {} } as never)
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['http://example.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'https://10.0.0.1/v1', 'https://172.16.0.1/v1', 'https://192.168.1.1/v1', 'https://[::1]/v1', 'https://[fc00::1]/v1', 'https://evil.example/v1'])('rejects client-selected upstream %s', async upstream => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequest({ request: new Request('https://app.example/api-proxy/models', { headers: { 'x-aipic-access-token': 'test-access', 'x-aipic-upstream': upstream } }), env: { AIPIC_ACCESS_TOKEN: 'test-access' } } as never)
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
