import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editableInteger, normalizeEditableInteger } from '../../../src/lib/presentation/editable-number.ts'
import { confirmSearchableOption, createSearchableSelectState, firstSearchableOption, restoreSearchableSelection, syncSearchableSelection, updateSearchableDraft } from '../../../src/lib/presentation/searchable-select-state.ts'

const options = [
  { value: 'species:0025', label: '#0025 皮卡丘', keywords: 'Pikachu' },
  { value: 'species:0006', label: '#0006 喷火龙', keywords: 'Charizard' },
]

test('SearchableSelect confirms the first valid Enter match', () => {
  let state = createSearchableSelectState(options, 'species:0025')
  state = updateSearchableDraft(state, '喷火')
  const match = firstSearchableOption(options, state.draft)
  assert.ok(match)
  state = confirmSearchableOption(state, match)
  assert.deepEqual(state, { value: 'species:0006', draft: '#0006 喷火龙' })
})

test('SearchableSelect restores the committed value after invalid blur or Escape', () => {
  const invalid = updateSearchableDraft(createSearchableSelectState(options, 'species:0025'), '不存在')
  assert.deepEqual(restoreSearchableSelection(invalid, options), { value: 'species:0025', draft: '#0025 皮卡丘' })
})

test('SearchableSelect restores empty text when the committed value is null', () => {
  const invalid = updateSearchableDraft(createSearchableSelectState(options, ''), '不存在')
  assert.deepEqual(restoreSearchableSelection(invalid, options), { value: '', draft: '' })
})

test('SearchableSelect synchronizes external value changes without sharing instance state', () => {
  const first = updateSearchableDraft(createSearchableSelectState(options, 'species:0025'), '临时文字')
  const second = createSearchableSelectState(options, '')
  assert.deepEqual(syncSearchableSelection(options, 'species:0006'), { value: 'species:0006', draft: '#0006 喷火龙' })
  assert.equal(first.draft, '临时文字')
  assert.deepEqual(second, { value: '', draft: '' })
})

test('editable integers preserve intermediate drafts and normalize only on confirmation', () => {
  assert.equal(editableInteger('', 0, 31), null)
  assert.equal(editableInteger('3', 0, 31), 3)
  assert.equal(editableInteger('300', 0, 252), null)
  assert.equal(editableInteger('-5', 0, 252), null)
  assert.equal(normalizeEditableInteger('', 0, 31, 31), 31)
  assert.equal(normalizeEditableInteger('300', 0, 252, 0), 252)
  assert.equal(normalizeEditableInteger('-5', 0, 252, 0), 0)
  assert.equal(normalizeEditableInteger('100', 1, 100, 50), 100)
})
