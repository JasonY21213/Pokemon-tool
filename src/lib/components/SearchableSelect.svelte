<script lang="ts">
  import { confirmSearchableOption, createSearchableSelectState, exactSearchableOption, firstSearchableOption, restoreSearchableSelection, syncSearchableSelection, updateSearchableDraft, type SearchableOption } from '../presentation/searchable-select-state'

  export let ariaLabel: string
  export let listId: string
  export let options: SearchableOption[]
  export let value: string
  export let placeholder = '输入或选择'
  export let onSelect: (value: string) => void

  let state = createSearchableSelectState(options, value)
  let previousValue = value
  let previousOptions = options

  function select(option: SearchableOption, input?: HTMLInputElement): void {
    state = confirmSearchableOption(state, option)
    if (input) input.value = state.draft
    onSelect(option.value)
  }

  function handleInput(input: HTMLInputElement): void {
    state = updateSearchableDraft(state, input.value)
    const exact = exactSearchableOption(options, input.value)
    if (exact) select(exact, input)
  }

  function handleKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget as HTMLInputElement
    if (event.key === 'Escape') {
      event.preventDefault()
      state = restoreSearchableSelection(state, options)
      input.value = state.draft
      return
    }
    if (event.key !== 'Enter') return
    const first = firstSearchableOption(options, input.value)
    if (first) {
      event.preventDefault()
      select(first, input)
    }
  }

  function handleBlur(input: HTMLInputElement): void {
    state = restoreSearchableSelection(state, options)
    input.value = state.draft
  }

  $: if (value !== previousValue || options !== previousOptions) {
    previousValue = value
    previousOptions = options
    state = syncSearchableSelection(options, value)
  }
</script>

<input
  type="search"
  class="searchable-select"
  aria-label={ariaLabel}
  list={listId}
  value={state.draft}
  {placeholder}
  oninput={(event) => handleInput(event.currentTarget as HTMLInputElement)}
  onkeydown={handleKeydown}
  onblur={(event) => handleBlur(event.currentTarget as HTMLInputElement)}
/>
<datalist id={listId}>
  {#each options as option (option.value)}<option value={option.label}></option>{/each}
</datalist>
