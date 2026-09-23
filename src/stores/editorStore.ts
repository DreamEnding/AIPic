import type { StoreApi } from 'zustand'
import { remapImageMentionsForOrder } from '../lib/promptImageMentions'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { imageCache } from '../services/image-cache'
import { orderImagesWithMaskFirst, syncActiveInputDraft } from '../services/input-drafts'
import type { AppState } from '../store'
import { deleteImageIfUnreferenced } from '../store'
import { DEFAULT_PARAMS } from '../types'

type Slice = Pick<AppState, 'prompt' | 'setPrompt' | 'inputImages' | 'addInputImage' | 'replaceInputImage' | 'removeInputImage' | 'clearInputImages' | 'setInputImages' | 'moveInputImage' | 'maskDraft' | 'setMaskDraft' | 'clearMaskDraft' | 'maskEditorImageId' | 'setMaskEditorImageId' | 'galleryInputDraft' | 'params' | 'setParams' | 'reusedTaskApiProfileId' | 'reusedTaskApiProfileName' | 'reusedTaskApiProfileMissing' | 'setReusedTaskApiProfile'>

export function createEditorSlice(set: StoreApi<AppState>['setState']): Slice {
  return {
    // Input
    prompt: '',
    setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
    inputImages: [],
    addInputImage: (img) =>
      set((s) => {
        if (s.inputImages.find((i) => i.id === img.id)) return s
        return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
      }),
    replaceInputImage: (idx, img) => {
      let removedImageId: string | null = null
      set((s) => {
        if (idx < 0 || idx >= s.inputImages.length) return s
        const previous = s.inputImages[idx]
        if (!previous || previous.id === img.id) return s
        if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
        removedImageId = previous.id
        const inputImages = s.inputImages.map((item, itemIdx) => itemIdx === idx ? img : item)
        const shouldClearMask = previous.id === s.maskDraft?.targetImageId
        return syncActiveInputDraft(s, {
          inputImages,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        })
      })
      if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
    },
    removeInputImage: (idx) =>
      set((s) => {
        const removed = s.inputImages[idx]
        const inputImages = s.inputImages.filter((_, i) => i !== idx)
        const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
        return syncActiveInputDraft(s, {
          inputImages,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        })
      }),
    clearInputImages: () =>
      set((s) => {
        for (const img of s.inputImages) imageCache.delete(img.id)
        return syncActiveInputDraft(s, {
          inputImages: [],
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
          maskDraft: null,
          maskEditorImageId: null,
        })
      }),
    setInputImages: (imgs, options) =>
      set((s) => {
        const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
        const shouldClearMask =
          Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
        return syncActiveInputDraft(s, {
          inputImages,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, options?.equivalentImageIds),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        })
      }),
    moveInputImage: (fromIdx, toIdx) =>
      set((s) => {
        const images = [...s.inputImages]
        if (fromIdx < 0 || fromIdx >= images.length) return s
        const maskTargetImageId = s.maskDraft?.targetImageId
        if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
        const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
        const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
        const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
        if (insertIdx === fromIdx) return s
        const [moved] = images.splice(fromIdx, 1)
        images.splice(insertIdx, 0, moved)
        return syncActiveInputDraft(s, {
          inputImages: images,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
        })
      }),
    maskDraft: null,
    setMaskDraft: (maskDraft) =>
      set((s) => {
        const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
        return syncActiveInputDraft(s, {
          maskDraft,
          inputImages,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
        })
      }),
    clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
    maskEditorImageId: null,
    setMaskEditorImageId: (maskEditorImageId) => {
      if (maskEditorImageId) dismissAllTooltips()
      set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
    },
    galleryInputDraft: null,

    // Params
    params: { ...DEFAULT_PARAMS },
    setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
    reusedTaskApiProfileId: null,
    reusedTaskApiProfileName: null,
    reusedTaskApiProfileMissing: false,
    setReusedTaskApiProfile: (profileId, missing = false, profileName = null) => set({
      reusedTaskApiProfileId: profileId,
      reusedTaskApiProfileName: profileName,
      reusedTaskApiProfileMissing: missing,
    }),


  }
}
