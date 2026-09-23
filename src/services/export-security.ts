/** Backups never carry credentials, including nested provider headers and URL tokens. */
export function stripExportSecrets<T>(value: T): T {
  const sensitive = /api.?key|authorization|token|password|secret|cookie|dismissedCodexCliPrompts/i
  const secrets = new Set<string>()
  const collect = (item: unknown): void => {
    if (Array.isArray(item)) { item.forEach(collect); return }
    if (!item || typeof item !== 'object') return
    for (const [key, entry] of Object.entries(item)) {
      if (sensitive.test(key) && typeof entry === 'string' && entry.length >= 4) {
        secrets.add(entry.replace(/^Bearer\s+/i, ''))
      } else collect(entry)
    }
  }
  collect(value)

  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(scrub)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, sensitive.test(key) ? '' : scrub(entry)]))
    }
    if (typeof item !== 'string') return item
    let result = item
    if (/^\s*[{[]/.test(result)) {
      try { result = JSON.stringify(scrub(JSON.parse(result))) } catch { /* plain text */ }
    }
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
    return result.replace(/([?&](?:key|api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|signature|password)=)[^&#\s]*/gi, '$1')
      .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1')
      .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[\w-]+/g, '[REDACTED]')
  }
  return scrub(value) as T
}
