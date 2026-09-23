import type * as React from 'react'
import type { RetouchCategoryId, RetouchStrengthId, RetouchTargetId, RetouchTemplate } from '../../services/retouch-model'
import { StudioSymbol, categoryTemplateAliases, retouchCategories, retouchTemplates, strengthOptions, targetOptions } from '../../services/retouch-model'
import type { SettingsTab } from '../../store'
import type { ApiProfile } from '../../types'
import { PhotoIcon, SettingsIcon } from '../icons'

interface Props {
  setShowSettings: (v: boolean, tab?: SettingsTab) => void
  requestBaseUrl: string
  activeProfile: ApiProfile
  apiIssue: string | null
  getApiDisplayLabel: (value: string) => string
  selectedConfigCount: number
  selectedCategoryId: RetouchCategoryId
  getCategorySelectionCount: (categoryId: RetouchCategoryId) => number
  setSelectedCategoryId: React.Dispatch<React.SetStateAction<RetouchCategoryId>>
  setSelectedGroupName: React.Dispatch<React.SetStateAction<string | null>>
  selectedCategory: { id: RetouchCategoryId; title: string; shortTitle: string; summary: string; icon: typeof PhotoIcon; }
  groupedCategoryTemplates: { group: string; templates: RetouchTemplate[]; }[]
  getGroupSelectionCount: (templates: RetouchTemplate[]) => number
  activeGroupName: string
  activeGroupTemplates: RetouchTemplate[]
  selectedTemplateIds: string[]
  toggleTemplate: (template: RetouchTemplate) => void
  selectedStrength: { id: RetouchStrengthId; label: string; prompt: string; }
  selectedTarget: { id: RetouchTargetId; label: string; prompt: string; }
  selectedStrengthId: RetouchStrengthId
  applyStrength: (strengthId: RetouchStrengthId) => void
  selectedTargetId: RetouchTargetId
  applyTarget: (targetId: RetouchTargetId) => void
}

export default function RetouchSidebar({ setShowSettings, requestBaseUrl, activeProfile, apiIssue, getApiDisplayLabel, selectedConfigCount, selectedCategoryId, getCategorySelectionCount, setSelectedCategoryId, setSelectedGroupName, selectedCategory, groupedCategoryTemplates, getGroupSelectionCount, activeGroupName, activeGroupTemplates, selectedTemplateIds, toggleTemplate, selectedStrength, selectedTarget, selectedStrengthId, applyStrength, selectedTargetId, applyTarget }: Props) {
  return (
    <aside className="retouch-workflow-panel">
      <button type="button" className="retouch-api-card" onClick={() => setShowSettings(true, 'api')} title={requestBaseUrl} aria-label={`当前模型 ${activeProfile.model || '未设置'}，打开 API 设置`}>
        <div>
          <span>当前模型</span>
          <strong className="retouch-api-url">{activeProfile.model || '选择模型'}</strong>
          <small>{apiIssue ? '完成连接后开始创作' : getApiDisplayLabel(requestBaseUrl)}</small>
        </div>
        <SettingsIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="retouch-left-body">
        <nav className="retouch-primary-menu" aria-label="修图工具">
          <div className="retouch-primary-title">
            <span>工具</span>
            <strong>{selectedConfigCount ? `已选 ${selectedConfigCount} 项` : '探索'}</strong>
          </div>
          <div className="retouch-category-grid">
            {retouchCategories.map((category) => {
              const Icon = category.icon
              const active = selectedCategoryId === category.id
              const selectedCount = getCategorySelectionCount(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`retouch-category-button ${active ? 'is-active' : ''}`}
                  aria-label={`${category.title}${category.id === 'aiNative' ? '，新增纸刊海报预设' : ''}${selectedCount ? `，已选 ${selectedCount} 项` : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedCategoryId(category.id)
                    const ids = categoryTemplateAliases[category.id] ?? [category.id]
                    const firstTemplate = retouchTemplates.find((template) => ids.includes(template.category))
                    setSelectedGroupName(firstTemplate?.group ?? null)
                  }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="retouch-category-copy">
                    <span className="retouch-category-title">
                      <span className="retouch-category-name">{category.shortTitle}</span>
                      {category.id === 'aiNative' && <span className="retouch-new-badge" aria-hidden="true">NEW</span>}
                    </span>
                    <small className="retouch-category-summary">{category.summary}</small>
                  </span>
                  {selectedCount > 0 && <span className="retouch-category-count">{selectedCount}</span>}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="retouch-secondary-menu">
          <div className="retouch-secondary-head">
            <div>
              <span>创作工具</span>
              <strong>{selectedCategory.title}</strong>
            </div>
            <small>{selectedCategory.summary}</small>
          </div>

          <div className="retouch-template-list">
            <div className="retouch-group-tabs" role="group" aria-label="小功能分组">
              {groupedCategoryTemplates.map((group) => {
                const groupSelectedCount = getGroupSelectionCount(group.templates)
                return (
                  <button
                    key={group.group}
                    type="button"
                    className={activeGroupName === group.group ? 'is-active' : ''}
                    aria-pressed={activeGroupName === group.group}
                    onClick={() => setSelectedGroupName(group.group)}
                  >
                    <span>{group.group}</span>
                    {groupSelectedCount > 0 && <strong>{groupSelectedCount}</strong>}
                  </button>
                )
              })}
            </div>
            <div className="retouch-template-group">
              <div className="retouch-template-group-title">{activeGroupName}</div>
              <div className="retouch-template-chip-grid">
                {activeGroupTemplates.map((template) => {
                  const isSelected = selectedTemplateIds.includes(template.id)
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`retouch-template-card ${isSelected ? 'is-active' : ''}`}
                      onClick={() => toggleTemplate(template)}
                      title={template.scenario}
                      aria-pressed={isSelected}
                    >
                      <span className="retouch-template-card-title">
                        {template.composition === 'poster' && (
                          <span className="retouch-template-card-icon">
                            <StudioSymbol name={template.id === 'editorial-photo-echo' ? 'panels' : template.id === 'editorial-quiet-zine' ? 'minimal' : 'collage'} className="h-5 w-5" />
                          </span>
                        )}
                        <strong>{template.title}</strong>
                        {isSelected && <span className="retouch-selected-mark">已选</span>}
                      </span>
                      <small>{template.scenario}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="retouch-section-heading">
            <span>调整</span>
            <strong>{selectedStrength.label} · {selectedTarget.label}</strong>
          </div>
          <div className="retouch-option-panel">
              <div className="retouch-option-row">
                <span>强度</span>
                <div>
                  {strengthOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={selectedStrengthId === option.id ? 'is-active' : ''}
                      aria-pressed={selectedStrengthId === option.id}
                      onClick={() => applyStrength(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="retouch-option-row">
                <span>对象</span>
                <div>
                  {targetOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={selectedTargetId === option.id ? 'is-active' : ''}
                      aria-pressed={selectedTargetId === option.id}
                      onClick={() => applyTarget(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
