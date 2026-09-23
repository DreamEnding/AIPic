import { AipicLimiter } from '../../deploy/cloudflare/limiter.js'

export function proxyEnv() {
  const values = new Map<string, unknown>()
  const storage = {
    async get(key: string) { return structuredClone(values.get(key)) },
    async put(key: string, value: unknown) { values.set(key, structuredClone(value)) },
    async transaction(callback: (storage: unknown) => unknown) { return callback(storage) },
  }
  const limiter = new AipicLimiter({ storage })
  return {
    AIPIC_ACCESS_TOKEN: 'test-access',
    AIPIC_LIMITER: { idFromName: () => 'global', get: () => limiter },
  }
}
