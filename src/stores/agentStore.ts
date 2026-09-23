import type { StoreApi } from 'zustand'
import { createAgentConversation, getLatestAgentConversation, isEmptyAgentConversation } from '../services/agent-conversations'
import { clearInputDraftState, restoreAgentInputDraftState, saveActiveAgentInputDrafts } from '../services/input-drafts'
import type { AppState } from '../store'

type Slice = Pick<AppState, 'agentConversations' | 'agentConversationsLoaded' | 'activeAgentConversationId' | 'agentInputDrafts' | 'agentSidebarCollapsed' | 'agentAssetTab' | 'agentAssetPanelCollapsed' | 'agentMobileHeaderVisible' | 'agentEditingRoundId' | 'agentEditingConversationId' | 'agentGeneratingTitleIds' | 'createAgentConversation' | 'setActiveAgentConversationId' | 'setActiveAgentRoundId' | 'renameAgentConversation' | 'deleteAgentConversation' | 'setAgentSidebarCollapsed' | 'setAgentAssetTab' | 'setAgentAssetPanelCollapsed' | 'setAgentMobileHeaderVisible' | 'setAgentEditingRoundId' | 'setAgentEditingConversationId'>

export function createAgentSlice(set: StoreApi<AppState>['setState'], get: StoreApi<AppState>['getState']): Slice {
  return {
    // Agent
    agentConversations: [],
    agentConversationsLoaded: false,
    activeAgentConversationId: null,
    agentInputDrafts: {},
    agentSidebarCollapsed: true,
    agentAssetTab: 'outputs',
    agentAssetPanelCollapsed: false,
    agentMobileHeaderVisible: false,
    agentEditingRoundId: null,
    agentEditingConversationId: null,
    agentGeneratingTitleIds: {},
    createAgentConversation: () => {
      const now = Date.now()
      const latestConversation = getLatestAgentConversation(get().agentConversations)
      if (latestConversation && isEmptyAgentConversation(latestConversation)) {
        set((state) => {
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            agentConversations: state.agentConversations.map((conversation) =>
              conversation.id === latestConversation.id
                ? { ...conversation, createdAt: now, updatedAt: now }
                : conversation,
            ),
            activeAgentConversationId: latestConversation.id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, latestConversation.id),
          }
        })
        return latestConversation.id
      }

      const conversation = createAgentConversation(now)
      set((state) => {
        const agentInputDrafts = saveActiveAgentInputDrafts(state)
        return {
          agentConversations: [
            ...state.agentConversations,
            conversation,
          ],
          activeAgentConversationId: conversation.id,
          agentInputDrafts,
          agentSidebarCollapsed: true,
          agentEditingRoundId: null,
          ...restoreAgentInputDraftState(agentInputDrafts, conversation.id),
        }
      })
      return conversation.id
    },
    setActiveAgentConversationId: (id) => set((state) => {
      if (state.activeAgentConversationId === id) {
        return {
          activeAgentConversationId: id,
          agentSidebarCollapsed: true,
          agentAssetPanelCollapsed: true,
          agentEditingRoundId: null,
        }
      }
      const agentInputDrafts = saveActiveAgentInputDrafts(state)
      return {
        activeAgentConversationId: id,
        agentInputDrafts,
        agentSidebarCollapsed: true,
        agentAssetPanelCollapsed: true,
        agentEditingRoundId: null,
        ...restoreAgentInputDraftState(agentInputDrafts, id),
      }
    }),
    setActiveAgentRoundId: (conversationId, roundId) => set((state) => ({
      agentConversations: state.agentConversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, activeRoundId: roundId, updatedAt: Date.now() } : conversation,
      ),
    })),
    renameAgentConversation: (id, title) => set((state) => ({ agentConversations: state.agentConversations.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)) })),
    deleteAgentConversation: (id) => set((state) => {
      const agentInputDrafts = { ...state.agentInputDrafts }
      delete agentInputDrafts[id]
      const activeDeleted = state.activeAgentConversationId === id
      return {
        agentConversations: state.agentConversations.filter((c) => c.id !== id),
        activeAgentConversationId: activeDeleted ? null : state.activeAgentConversationId,
        agentInputDrafts,
        ...(activeDeleted ? clearInputDraftState() : {}),
      }
    }),
    setAgentSidebarCollapsed: (agentSidebarCollapsed) => set({ agentSidebarCollapsed }),
    setAgentAssetTab: (agentAssetTab) => set({ agentAssetTab }),
    setAgentAssetPanelCollapsed: (agentAssetPanelCollapsed) => set({ agentAssetPanelCollapsed }),
    setAgentMobileHeaderVisible: (agentMobileHeaderVisible) => set({ agentMobileHeaderVisible }),
    setAgentEditingRoundId: (agentEditingRoundId) => set({ agentEditingRoundId }),
    setAgentEditingConversationId: (agentEditingConversationId) => set({ agentEditingConversationId }),


  }
}
