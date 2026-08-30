export type SearchableOption = { value: string; label: string; keywords?: string }
export type SearchableSelectState = { value: string; draft: string }

export function selectedOptionLabel(options: SearchableOption[], value: string): string {
  return options.find(option => option.value === value)?.label ?? ''
}

export function createSearchableSelectState(options: SearchableOption[], value: string): SearchableSelectState {
  return { value, draft: selectedOptionLabel(options, value) }
}

export function updateSearchableDraft(state: SearchableSelectState, draft: string): SearchableSelectState {
  return { ...state, draft }
}

function matches(option: SearchableOption, search: string): boolean {
  return `${option.label} ${option.keywords ?? ''}`.toLocaleLowerCase('zh-CN').includes(search)
}

export function exactSearchableOption(options: SearchableOption[], draft: string): SearchableOption | null {
  return options.find(option => option.label === draft) ?? null
}

export function firstSearchableOption(options: SearchableOption[], draft: string): SearchableOption | null {
  const search = draft.trim().toLocaleLowerCase('zh-CN')
  return search ? options.find(option => matches(option, search)) ?? null : null
}

export function confirmSearchableOption(state: SearchableSelectState, option: SearchableOption): SearchableSelectState {
  return { ...state, value: option.value, draft: option.label }
}

export function restoreSearchableSelection(state: SearchableSelectState, options: SearchableOption[]): SearchableSelectState {
  return { ...state, draft: selectedOptionLabel(options, state.value) }
}

export function syncSearchableSelection(options: SearchableOption[], value: string): SearchableSelectState {
  return createSearchableSelectState(options, value)
}
