/** Keep the deadline alive until headers, body and result downloads are consumed. */
export async function runImageRequest<T>(
  timeoutSeconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const timeoutError = new Error(`请求超时：超过 ${timeoutSeconds} 秒仍未完成。上游可能仍在生成，请确认结果后再重试。`)
  timeoutError.name = 'TimeoutError'
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  let rejectAborted!: (reason: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject })
  const onAbort = () => rejectAborted(controller.signal.reason)
  controller.signal.addEventListener('abort', onAbort, { once: true })
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutSeconds * 1000)

  try {
    if (callerSignal?.aborted) abortFromCaller()
    // The race also bounds body readers/providers that fail to honor AbortSignal.
    return await Promise.race([
      aborted,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal)
      }),
    ])
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
