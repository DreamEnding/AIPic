import type { StoreApi } from 'zustand'
import type { AppState } from '../store'


type Slice = Pick<AppState, 'searchQuery' | 'setSearchQuery' | 'filterStatus' | 'setFilterStatus' | 'filterFavorite' | 'setFilterFavorite' | 'selectedTaskIds' | 'setSelectedTaskIds' | 'toggleTaskSelection' | 'clearSelection'>

export function createHistorySlice(set: StoreApi<AppState>['setState']): Slice {
  return {
    // Search & Filter
    searchQuery: '',
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    filterStatus: 'all',
    setFilterStatus: (filterStatus) => set({ filterStatus }),
    filterFavorite: false,
    setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

    // Selection
    selectedTaskIds: [],
    setSelectedTaskIds: (updater) => set((s) => ({
      selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
    })),
    toggleTaskSelection: (id, force) => set((s) => {
      const isSelected = s.selectedTaskIds.includes(id)
      const shouldSelect = force !== undefined ? force : !isSelected
      if (shouldSelect === isSelected) return s
      return {
        selectedTaskIds: shouldSelect
          ? [...s.selectedTaskIds, id]
          : s.selectedTaskIds.filter((x) => x !== id)
      }
    }),
    clearSelection: () => set({ selectedTaskIds: [] }),


  }
}
