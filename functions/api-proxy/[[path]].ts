import policy from '../../backend/security/policy.cjs'
import redaction from '../../backend/security/redact.js'
const { authenticate, selectUpstream, MAX_BODY_BYTES, MAX_RESPONSE_BYTES, BUILTIN_PROVIDERS, fail, validateProxyBody } = policy
const { redact } = redaction

const UPSTREAM_HEADER = 'x-aipic-upstream'
const MAX_TEXT_BODY_CHARS = 8000
const STREAM_HEADER = 'x-aipic-proxy-stream'
const TIMEOUT_HEADER = 'x-aipic-timeout-seconds'
const STREAM_CONTENT_TYPE = 'application/x-aipic-stream; charset=utf-8'
const DEFAULT_TIMEOUT_SECONDS = 1800
const MAX_TIMEOUT_SECONDS = 3600
const HEARTBEAT_INTERVAL_MS = 15_000

interface Env {
  API_PROXY_URL?: string
  DEFAULT_API_URL?: string
  AIPIC_ACCESS_TOKEN?: string
  AIPIC_PROVIDERS?: string
  // Custom DNS requires an egress service that pins/validates the connected IP.
  AIPIC_EGRESS?: { fetch(request: Request): Promise<Response> }
  AIPIC_LIMITER?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function withCors(headers: Headers) {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  headers.set('access-control-allow-headers', `*, ${UPSTREAM_HEADER}, ${STREAM_HEADER}, ${TIMEOUT_HEADER}`)
  headers.set('access-control-max-age', '86400')
  return headers
}

function getUpstreamBaseUrl(request: Request, env: Env) {
  return selectUpstream(env, request.headers.get('x-aipic-provider'), request.headers.get(UPSTREAM_HEADER))
}

function buildUpstreamUrl(request: Request, env: Env) {
  const url = new URL(request.url)
  const upstreamPath = url.pathname.replace(/^\/api-proxy\/?/, '')
  const baseUrl = getUpstreamBaseUrl(request, env).replace(/\/+$/, '')
  const upstreamUrl = new URL(`${baseUrl}${new URL(baseUrl).pathname === '/' ? '/v1' : ''}/${upstreamPath}`)
  upstreamUrl.search = url.search
  return upstreamUrl
}

function copyRequestHeaders(request: Request) {
  const headers = new Headers(request.headers)
  headers.delete('origin')
  headers.delete('host')
  headers.delete(UPSTREAM_HEADER)
  headers.delete(STREAM_HEADER)
  headers.delete(TIMEOUT_HEADER)
  headers.delete('x-aipic-access-token')
  headers.delete('x-aipic-provider')
  headers.delete('cookie')
  for (const name of [...headers.keys()]) {
    if (/^(x-aipic-|cf-access-|x-forwarded-)/.test(name)) headers.delete(name)
  }
  for (const header of hopByHopHeaders) headers.delete(header)
  return headers
}

export function limitUpstreamResponse(response: Response, maxBytes = MAX_RESPONSE_BYTES): Response {
  if (!response.body) return response
  const reader = response.body.getReader()
  let bytes = 0
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { reader.releaseLock(); controller.close(); return }
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          reader.releaseLock()
          throw new Error('上游响应超过大小限制')
        }
        controller.enqueue(value)
      } catch (error) { controller.error(error) }
    },
    async cancel(reason) { try { await reader.cancel(reason) } finally { reader.releaseLock() } },
  }), { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** 仅为显式启用的长耗时生图请求建立心跳传输，其他代理请求保持原有协议。 */
function shouldStreamProxy(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api-proxy\/?/, '').replace(/\/+$/, '')
  return request.method === 'POST' && request.headers.get(STREAM_HEADER) === '1' &&
    ['images/generations', 'images/edits', 'responses'].includes(path)
}

/** 从内部请求头读取完整上游请求的时间预算，并限制最长占用时间。 */
function getTimeoutMs(request: Request) {
  const seconds = Number(request.headers.get(TIMEOUT_HEADER))
  return (Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds, MAX_TIMEOUT_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS) * 1000
}

/**
 * 立即返回心跳流，在同一个请求内转发上游状态和正文，避免等待首张图片时连接长期无响应。
 * 正文按 UTF-8 分块传输，计时覆盖响应头及完整正文；取消和超时都会释放上游读取与定时器。
 */
function streamUpstreamResponse(request: Request, upstreamUrl: URL, send: typeof fetch, release: () => void) {
  const encoder = new TextEncoder()
  const abortController = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array>
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const demandWaiters = new Set<() => void>()
  let finished = false
  let terminating = false
  let responseStarted = false

  function cleanup(removeSignal = true) {
    release()
    clearInterval(heartbeatTimer)
    clearTimeout(deadlineTimer)
    if (removeSignal) request.signal.removeEventListener('abort', abortFromRequest)
  }

  function resumeDemand() {
    for (const resolve of demandWaiters) resolve()
    demandWaiters.clear()
  }

  function stopUpstream(reason: unknown) {
    abortController.abort(reason)
    void reader?.cancel(reason).catch(() => {})
    resumeDemand()
  }

  function abortFromRequest() {
    if (finished) return
    finished = true
    cleanup()
    stopUpstream(request.signal.reason)
    streamController.error(request.signal.reason ?? new Error('请求已取消'))
  }

  /** 仅保留一个待写入分块，慢速客户端不会导致 4K 图片正文无限堆积。 */
  async function writeFrame(frame: object, terminal = false): Promise<boolean> {
    while (!finished && (!terminating || terminal) && (streamController.desiredSize ?? 0) <= 0) {
      await new Promise<void>(resolve => { demandWaiters.add(resolve) })
    }
    if (finished || (terminating && !terminal)) return false
    streamController.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
    return true
  }

  async function finishWithError(error: unknown, timedOut = false) {
    if (finished || terminating) return
    terminating = true
    cleanup(false)
    stopUpstream(error)
    const message = timedOut ? 'API 代理等待上游响应超时' : 'API 代理无法连接上游服务'
    if (!responseStarted) {
      await writeFrame({
        type: 'response', status: timedOut ? 504 : 502, statusText: timedOut ? 'Gateway Timeout' : 'Bad Gateway',
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }, true)
      await writeFrame({ type: 'chunk', text: JSON.stringify({ error: {
        message,
        upstream: upstreamUrl.origin,
        detail: redact(error instanceof Error ? error.message : String(error)),
      } }) }, true)
    } else {
      await writeFrame({ type: 'error', message: timedOut
        ? message
        : `上游响应读取失败：${redact(error instanceof Error ? error.message : String(error))}` }, true)
    }
    await writeFrame({ type: 'end' }, true)
    if (!finished) {
      finished = true
      cleanup()
      streamController.close()
    }
  }

  async function pump() {
    try {
      const response = await send(upstreamUrl, {
        method: request.method,
        headers: copyRequestHeaders(request),
        body: request.body,
        redirect: 'manual',
        signal: abortController.signal,
      })
      if (finished || terminating) {
        void response.body?.cancel().catch(() => {})
        return
      }
      reader = response.body?.getReader()
      const contentType = response.headers.get('content-type') ?? ''
      const wrapError = !response.ok && !contentType.toLowerCase().includes('application/json')
      const forwardedHeaders = new Headers()
      // 仅保留诊断和重试元数据，避免 JSON 封装绕过浏览器对 Cookie 等敏感响应头的屏蔽。
      for (const [name, value] of response.headers) {
        if (/^(content-type|retry-after|request-id|x-request-id|x-correlation-id|cf-ray)$/.test(name) ||
            /^(x-)?ratelimit(?:-|$)/.test(name)) {
          forwardedHeaders.set(name, value)
        }
      }
      if (wrapError) forwardedHeaders.set('content-type', 'application/json; charset=utf-8')
      responseStarted = await writeFrame({
        type: 'response', status: response.status, statusText: response.statusText,
        headers: Object.fromEntries(forwardedHeaders),
      })
      if (!responseStarted) return

      const decoder = new TextDecoder()
      let errorText = ''
      while (reader && !finished && !terminating) {
        const { done, value } = await reader.read()
        if (finished || terminating) return
        const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
        if (wrapError) {
          errorText = (errorText + text).slice(0, MAX_TEXT_BODY_CHARS)
          if (errorText.length >= MAX_TEXT_BODY_CHARS) {
            await reader.cancel()
            break
          }
        } else if (text && !await writeFrame({ type: 'chunk', text })) {
          return
        }
        if (done) break
      }
      if (finished || terminating) return
      if (wrapError) {
        await writeFrame({ type: 'chunk', text: JSON.stringify({ error: {
          message: `上游接口返回 HTTP ${response.status}`,
          upstream: upstreamUrl.origin,
          status: response.status,
          body: errorText,
        } }) })
      }
      if (!await writeFrame({ type: 'end' })) return
      finished = true
      cleanup()
      streamController.close()
    } catch (error) {
      await finishWithError(error)
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat' })}\n`))
      if (request.signal.aborted) {
        abortFromRequest()
        return
      }
      request.signal.addEventListener('abort', abortFromRequest, { once: true })
      heartbeatTimer = setInterval(() => {
        if (!finished && !terminating && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat' })}\n`))
        }
      }, HEARTBEAT_INTERVAL_MS)
      deadlineTimer = setTimeout(() => {
        void finishWithError(new Error('上游请求超过完整响应时间预算'), true)
      }, getTimeoutMs(request))
      void pump()
    },
    pull() {
      resumeDemand()
    },
    cancel(reason) {
      if (finished) return
      finished = true
      cleanup()
      stopUpstream(reason)
    },
  })
  return new Response(body, { status: 200, headers: withCors(new Headers({
    'content-type': STREAM_CONTENT_TYPE,
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
  })) })
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) })
  }

  let release: (() => void) | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let upstreamUrl: URL
  try {
    authenticate(request.headers, env)
    upstreamUrl = buildUpstreamUrl(request, env)
    if (!Object.values(BUILTIN_PROVIDERS).some(base => new URL(base as string).origin === upstreamUrl.origin) && !env.AIPIC_EGRESS) {
      fail(503, '自定义上游需要配置具备 DNS 连接校验的 AIPIC_EGRESS 服务')
    }
    if (!env.AIPIC_LIMITER) fail(503, '服务尚未配置 AIPIC_LIMITER 全局限流')
    const limiter = env.AIPIC_LIMITER!.get(env.AIPIC_LIMITER!.idFromName('aipic-global'))
    const admission = await limiter.fetch(new Request('https://limiter/acquire', { method: 'POST', body: JSON.stringify({ action: 'acquire' }) }))
    if (!admission.ok) fail(admission.status === 429 ? 429 : 503, '请求频率或并发超过限制')
    const { lease } = await admission.json() as { lease: string }
    let released = false
    release = () => {
      if (released) return
      released = true
      clearTimeout(deadline)
      const pending = limiter.fetch(new Request('https://limiter/release', { method: 'POST', body: JSON.stringify({ action: 'release', lease }) })).then(() => {}).catch(() => {})
      if (waitUntil) waitUntil(pending)
    }
    request.signal.addEventListener('abort', release, { once: true })
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) fail(413, '请求体过大')
    if (request.body) {
      const reader = request.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_BODY_BYTES) { await reader.cancel(); fail(413, '请求体过大') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const body = new Blob(chunks)
      await validateProxyBody(body, request.headers.get('content-type') || '')
      request = new Request(request, { body })
    }
  } catch (error) {
    release?.()
    const status = (error as { statusCode?: number }).statusCode || 500
    return Response.json({ error: error instanceof Error ? error.message : '请求被拒绝' }, { status, headers: withCors(new Headers(status === 429 ? { 'retry-after': '60' } : {})) })
  }
  const send: typeof fetch = async (input, init) => {
    const response = env.AIPIC_EGRESS
      ? await env.AIPIC_EGRESS.fetch(new Request(input, { ...init, ...(init?.body ? { duplex: 'half' } : {}) } as RequestInit))
      : await fetch(input, init)
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('禁止上游重定向') }
    // Never expose an upstream error body: it can echo keys, prompts or images.
    if (!response.ok) {
      await response.body?.cancel()
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })
      for (const name of ['retry-after', 'x-request-id', 'x-ratelimit-remaining']) {
        const value = response.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(JSON.stringify({ error: { message: `上游接口返回 HTTP ${response.status}` } }), { status: response.status, statusText: response.statusText, headers })
    }
    return limitUpstreamResponse(response)
  }
  const finish = (response: Response) => {
    if (!response.body) { release?.(); return response }
    const reader = response.body.getReader()
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) { release?.(); controller.close() } else controller.enqueue(value)
        } catch (error) { release?.(); controller.error(error) }
      },
      async cancel(reason) { release?.(); await reader.cancel(reason) },
    }, { highWaterMark: 0 }), { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  if (shouldStreamProxy(request)) return streamUpstreamResponse(request, upstreamUrl, send, release!)

  let upstreamResponse: Response
  const controller = new AbortController()
  deadline = setTimeout(() => { controller.abort(); release?.() }, getTimeoutMs(request))
  try {
    upstreamResponse = await send(upstreamUrl, {
      method: request.method,
      headers: copyRequestHeaders(request),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, controller.signal]),
    })
  } catch (error) {
    release?.()
    const headers = withCors(new Headers({ 'content-type': 'application/json; charset=utf-8' }))
    return new Response(JSON.stringify({
      error: {
        message: 'API 代理无法连接上游服务',
        upstream: upstreamUrl.origin,
        detail: redact(error instanceof Error ? error.message : String(error)),
      },
    }), { status: 502, headers })
  }

  const responseHeaders = new Headers(upstreamResponse.headers)
  for (const header of hopByHopHeaders) responseHeaders.delete(header)
  for (const header of ['set-cookie', 'location', 'content-length', 'content-encoding']) responseHeaders.delete(header)

  return finish(new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: withCors(responseHeaders),
  }))
}
