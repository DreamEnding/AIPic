const STREAM_CONTENT_TYPE = 'application/x-aipic-stream'

type ProxyFrame =
  | { type: 'heartbeat' }
  | { type: 'response'; status: number; statusText: string; headers: Record<string, string> }
  | { type: 'chunk'; text: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

/** Decode the proxy's keepalive envelope without buffering a whole 4K image. */
async function unwrapProxyResponse(response: Response, signal?: AbortSignal | null): Promise<Response> {
  if (!response.body) throw new Error('API 代理未返回可读取的响应')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let sourceEnded = false
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    signal?.removeEventListener('abort', abort)
    // Cancelling releases the Pages upstream when parsing completes early.
    void reader.cancel().catch(() => {}).finally(() => reader.releaseLock())
  }
  const abort = () => {
    bodyController?.error(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    cleanup()
  }
  signal?.addEventListener('abort', abort, { once: true })

  const nextFrame = async (): Promise<ProxyFrame> => {
    while (true) {
      signal?.throwIfAborted()
      const newline = buffer.indexOf('\n')
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          const frame = JSON.parse(line) as ProxyFrame
          if (!frame || typeof frame !== 'object' || !['heartbeat', 'response', 'chunk', 'end', 'error'].includes(frame.type)) throw new Error()
          if (frame.type === 'response' && (
            !Number.isInteger(frame.status) || frame.status < 200 || frame.status > 599 ||
            typeof frame.statusText !== 'string' || !frame.headers || typeof frame.headers !== 'object' ||
            Array.isArray(frame.headers) || Object.values(frame.headers).some((value) => typeof value !== 'string')
          )) throw new Error()
          if (frame.type === 'chunk' && typeof frame.text !== 'string') throw new Error()
          if (frame.type === 'error' && typeof frame.message !== 'string') throw new Error()
          return frame
        } catch {
          throw new Error('API 代理返回了无法解析的响应')
        }
      }
      if (sourceEnded) throw new Error('API 代理连接在图片传输完成前中断，请确认结果后再重试。')
      const { done, value } = await reader.read()
      sourceEnded = done
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    }
  }

  try {
    let frame = await nextFrame()
    while (frame.type === 'heartbeat') frame = await nextFrame()
    if (frame.type === 'error') throw new Error(frame.message)
    if (frame.type !== 'response') throw new Error('API 代理未返回上游响应状态')
    const headers = new Headers(frame.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.delete('transfer-encoding')
    if ([204, 205, 304].includes(frame.status)) {
      cleanup()
      return new Response(null, { status: frame.status, statusText: frame.statusText, headers })
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller },
      async pull(controller) {
        try {
          while (true) {
            const next = await nextFrame()
            if (next.type === 'heartbeat') continue
            if (next.type === 'chunk' && typeof next.text === 'string') {
              controller.enqueue(encoder.encode(next.text))
              return
            }
            if (next.type === 'end') {
              controller.close()
              cleanup()
              return
            }
            if (next.type === 'error') throw new Error(next.message)
            throw new Error('API 代理响应顺序异常')
          }
        } catch (error) {
          controller.error(error)
          cleanup()
        }
      },
      cancel: cleanup,
    })
    return new Response(body, { status: frame.status, statusText: frame.statusText, headers })
  } catch (error) {
    cleanup()
    throw error
  }
}

export async function fetchImageResponse(
  input: string,
  init: RequestInit,
  useApiProxy: boolean,
  timeoutSeconds: number,
): Promise<Response> {
  const headers = init.headers instanceof Headers || Array.isArray(init.headers)
    ? Object.fromEntries(new Headers(init.headers).entries())
    : { ...init.headers }
  if (useApiProxy) {
    headers['x-aipic-proxy-stream'] = '1'
    headers['x-aipic-timeout-seconds'] = String(timeoutSeconds)
  }
  const response = await fetch(input, { ...init, headers })
  if (!response.headers.get('content-type')?.toLowerCase().includes(STREAM_CONTENT_TYPE)) return response
  return unwrapProxyResponse(response, init.signal)
}
