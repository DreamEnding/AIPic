import { afterEach, describe, expect, it, vi } from 'vitest'
import { runImageRequest } from './imageRequest'

describe('complete image request deadline', () => {
  afterEach(() => vi.useRealTimers())

  it('bounds a stalled body even when a provider ignores abort', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const result = runImageRequest(1, async (value) => {
      signal = value
      return new Promise(() => {})
    })
    const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError', message: expect.stringContaining('超过 1 秒') })
    await vi.advanceTimersByTimeAsync(1000)
    await failure
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps cancellation distinct from timeout after work has started', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const result = runImageRequest(30, async () => new Promise(() => {}), caller.signal)
    const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    caller.abort()
    await failure
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not submit an already cancelled request and clears the deadline on success', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    caller.abort()
    const operation = vi.fn(async () => 'image')
    await expect(runImageRequest(30, operation, caller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation).not.toHaveBeenCalled()
    await expect(runImageRequest(30, operation)).resolves.toBe('image')
    expect(vi.getTimerCount()).toBe(0)
  })
})
