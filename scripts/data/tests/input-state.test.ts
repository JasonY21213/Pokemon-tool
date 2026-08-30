import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editableInteger, normalizeEditableInteger } from '../../../src/lib/presentation/editable-number.ts'

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
