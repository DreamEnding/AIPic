import { expect, it } from 'vitest'
import { stripExportSecrets } from './export-security'

it('strips nested provider credentials without mutating live settings or history', () => {
  const original = { settings: { apiKey: 'secret', profiles: [{ apiKey: 'secret', headers: { Authorization: 'Bearer secret' } }] }, tasks: [{ id: 'keep', prompt: 'keep', url: 'https://example.com/?token=secret', rawResponsePayload: '{"error":"Upstream echoed secret"}' }] }
  const exported = stripExportSecrets(original)
  expect(JSON.stringify(exported)).not.toContain('secret')
  expect(original.settings.apiKey).toBe('secret')
  expect(exported.tasks[0].id).toBe('keep')
  expect(exported.tasks[0].prompt).toBe('keep')
})
