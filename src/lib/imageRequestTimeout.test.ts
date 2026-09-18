import { describe, expect, it } from 'vitest'
import { createDefaultGrokProfile, createDefaultOpenAIProfile, getActiveApiProfile, normalizeSettings } from './apiProfiles'
import { DEFAULT_IMAGE_TIMEOUT_SECONDS, MAX_IMAGE_TIMEOUT_SECONDS, getImageRequestTimeoutSeconds, normalizeImageTimeoutSeconds } from './imageRequestTimeout'

describe('image request timeout budgets', () => {
  it('defaults GPT and Grok to thirty minutes', () => {
    expect(createDefaultOpenAIProfile().timeout).toBe(DEFAULT_IMAGE_TIMEOUT_SECONDS)
    expect(createDefaultGrokProfile().timeout).toBe(DEFAULT_IMAGE_TIMEOUT_SECONDS)
  })

  it.each([undefined, null, NaN, Infinity, -1, 0, '600'])('normalizes invalid imported setting %s', (value) => {
    expect(normalizeImageTimeoutSeconds(value)).toBe(1800)
    expect(normalizeImageTimeoutSeconds(value, 120)).toBe(120)
  })

  it('bounds numeric settings without shortening longer user budgets', () => {
    expect(normalizeImageTimeoutSeconds(1)).toBe(10)
    expect(normalizeImageTimeoutSeconds(2400)).toBe(2400)
    expect(normalizeImageTimeoutSeconds(9000)).toBe(MAX_IMAGE_TIMEOUT_SECONDS)
    expect(normalizeImageTimeoutSeconds(undefined, Infinity)).toBe(1800)
  })

  it('normalizes legacy and profile imports consistently', () => {
    expect(normalizeSettings({ timeout: Infinity }).timeout).toBe(1800)
    const settings = normalizeSettings({ profiles: [{ ...createDefaultOpenAIProfile(), timeout: 9000 }] })
    expect(settings.profiles[0].timeout).toBe(3600)
    expect(getActiveApiProfile({ ...settings, timeout: -1 }).timeout).toBe(3600)
  })

  it.each(['4K', '4k', '4096x4096', '3840x2160', '2160x3840', '2880x2880', '3456x2304', '2304x3456', '3200x2400', '2400x3200', '3840x1600'])('protects old six-minute or ten-minute profiles for %s', (size) => {
    expect(getImageRequestTimeoutSeconds({ timeout: 600, provider: 'openai' }, { size })).toBe(1800)
    expect(getImageRequestTimeoutSeconds({ timeout: 2400 }, { size })).toBe(2400)
  })

  it.each(['auto', '1024x1024', '2048x2048', '2160x1440', '2560x1440'])('preserves explicit short budgets for %s', (size) => {
    expect(getImageRequestTimeoutSeconds({ timeout: 120, provider: 'openai' }, { size })).toBe(120)
  })

  it('leaves custom/fal provider budgets separate from GPT/Grok generation', () => {
    expect(getImageRequestTimeoutSeconds({ timeout: 120, provider: 'fal' }, { size: '3840x2160' })).toBe(120)
    expect(getImageRequestTimeoutSeconds({ timeout: 120, provider: 'custom-provider' }, { size: '3840x2160' })).toBe(120)
  })
})
