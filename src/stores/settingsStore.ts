import type { StoreApi } from 'zustand'
import type { AppState } from '../store'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'
import { applySettingsPatch } from '../services/settings'

export function createSettingsSlice(set: StoreApi<AppState>['setState']): Pick<AppState, 'settings' | 'setSettings'> {
  return {
    settings: { ...DEFAULT_SETTINGS },
    setSettings: (patch) => set((state) => applySettingsPatch(state, patch)),
  }
}