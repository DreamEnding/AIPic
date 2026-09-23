import type { StoreApi } from 'zustand'
import type { AppState } from '../store'


type Slice = Pick<AppState, 'tasks' | 'setTasks' | 'streamPreviews' | 'streamPreviewSlots' | 'setTaskStreamPreview'>

export function createTaskSlice(set: StoreApi<AppState>['setState']): Slice {
  return {
    // Tasks
    tasks: [],
    setTasks: (tasks) => set({ tasks }),
    streamPreviews: {},
    streamPreviewSlots: {},
    setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((s) => {
      if (image) {
        const slotKey = String(requestIndex)
        const currentSlots = s.streamPreviewSlots[taskId] ?? {}
        if (s.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return s
        return {
          streamPreviews: { ...s.streamPreviews, [taskId]: image },
          streamPreviewSlots: {
            ...s.streamPreviewSlots,
            [taskId]: { ...currentSlots, [slotKey]: image },
          },
        }
      }

      if (!(taskId in s.streamPreviews) && !(taskId in s.streamPreviewSlots)) return s
      const next = { ...s.streamPreviews }
      const nextSlots = { ...s.streamPreviewSlots }
      delete next[taskId]
      delete nextSlots[taskId]
      return { streamPreviews: next, streamPreviewSlots: nextSlots }
    }),


  }
}
