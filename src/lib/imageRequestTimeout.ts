import type { ApiProfile, TaskParams } from '../types'

export const DEFAULT_IMAGE_TIMEOUT_SECONDS = 1800
export const MAX_IMAGE_TIMEOUT_SECONDS = 3600
const MIN_IMAGE_TIMEOUT_SECONDS = 10

/** Keep persisted/imported settings within the supported request budget. */
export function normalizeImageTimeoutSeconds(value: unknown, fallback = DEFAULT_IMAGE_TIMEOUT_SECONDS): number {
  const fallbackSeconds = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_IMAGE_TIMEOUT_SECONDS
  const seconds = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallbackSeconds
  return Math.min(MAX_IMAGE_TIMEOUT_SECONDS, Math.max(MIN_IMAGE_TIMEOUT_SECONDS, seconds))
}

/** Large GPT/Grok images need the new budget even when an older profile saved 600 seconds. */
export function getImageRequestTimeoutSeconds(
  profile: Pick<ApiProfile, 'timeout'> & Partial<Pick<ApiProfile, 'provider'>>,
  params: Pick<TaskParams, 'size'>,
): number {
  const configuredSeconds = normalizeImageTimeoutSeconds(profile.timeout)
  const size = params.size.trim()
  const dimensions = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
  // The UI's square/portrait 4K presets use an 8MP budget (e.g. 2880x2880),
  // so longest edge alone misses them. The 2K tier is capped at 2048² pixels.
  const width = dimensions ? Number(dimensions[1]) : 0
  const height = dimensions ? Number(dimensions[2]) : 0
  const is4K = /^4k$/i.test(size) || Math.max(width, height) >= 3840 || width * height > 2048 * 2048
  return (profile.provider == null || profile.provider === 'openai') && is4K
    ? Math.max(configuredSeconds, DEFAULT_IMAGE_TIMEOUT_SECONDS)
    : configuredSeconds
}
