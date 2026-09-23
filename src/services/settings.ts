import type { AppSettings } from '../types'
import type { AppState } from '../store'
import { normalizeSettings } from '../lib/apiProfiles'

export function applySettingsPatch(st: AppState, patch: Partial<AppSettings>): Partial<AppState> {
  const previous = normalizeSettings(st.settings)
  const incoming = patch
  const hasLegacyOverrides =
    incoming.baseUrl !== undefined ||
    incoming.apiKey !== undefined ||
    incoming.model !== undefined ||
    incoming.timeout !== undefined ||
    incoming.apiMode !== undefined ||
    incoming.codexCli !== undefined ||
    incoming.apiProxy !== undefined ||
    incoming.streamImages !== undefined ||
    incoming.streamPartialImages !== undefined
  const merged = normalizeSettings({ ...previous, ...incoming })
  if (hasLegacyOverrides && incoming.profiles === undefined) {
    merged.profiles = merged.profiles.map((profile) =>
      profile.id === merged.activeProfileId
        ? {
            ...profile,
            baseUrl: incoming.baseUrl ?? profile.baseUrl,
            apiKey: incoming.apiKey ?? profile.apiKey,
            model: incoming.model ?? profile.model,
            timeout: incoming.timeout ?? profile.timeout,
            apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
            codexCli: incoming.codexCli ?? profile.codexCli,
            apiProxy: incoming.apiProxy ?? profile.apiProxy,
            streamImages: incoming.streamImages ?? profile.streamImages,
            streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
          }
        : profile,
    )
  }
  const settings = normalizeSettings(merged)
  const shouldClearReusedProfile = st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
  return {
    settings,
    ...(shouldClearReusedProfile
      ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
      : {}),
  }

}
