import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMoveToMoveset, filterLearnsetMoves, revalidateMoveset, sortLearnsetMoves } from '../../../src/lib/runtime-data/learnset-explorer.ts'
import type { RuntimeMove } from '../../../src/lib/runtime-data/types.ts'

const move = (moveId: string, canonicalName: string, zhName: string, typeId: string, category: RuntimeMove['category'], power: RuntimeMove['power'], pp = 20, status: RuntimeMove['damageSupport']['status'] = 'supported'): RuntimeMove => ({ moveId, canonicalName, zhName, zhDescription: '说明', typeId, category, power, accuracy: { kind: 'percent', value: 100 }, pp: { kind: 'numeric', value: pp }, priority: 0, damageSupport: status === 'supported' ? { status } : status === 'non-damaging' ? { status } : { status: 'unsupported', reason: 'variable-base-power' } })
const moves = [move('move:0001', 'Pound', '拍击', 'type:normal', 'physical', { kind: 'numeric', value: 40 }, 35), move('move:0014', 'Swords Dance', '剑舞', 'type:normal', 'status', { kind: 'not-applicable' }, 20, 'non-damaging'), move('move:0053', 'Flamethrower', '喷射火焰', 'type:fire', 'special', { kind: 'numeric', value: 90 }, 15), move('move:0068', 'Counter', '双倍奉还', 'type:fighting', 'physical', { kind: 'unknown' }, 20, 'unsupported')]
const base = { query: '', typeId: '', category: 'all' as const, minimumPower: 0, support: 'all' as const }

test('Learnset explorer filters Chinese, English, type, category, numeric power, and support locally', () => {
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, query: '拍击' }).map(move => move.moveId), ['move:0001'])
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, query: 'flame' }).map(move => move.moveId), ['move:0053'])
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, typeId: 'type:normal' }).map(move => move.moveId), ['move:0001', 'move:0014'])
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, category: 'status' }).map(move => move.moveId), ['move:0014'])
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, minimumPower: 50 }).map(move => move.moveId), ['move:0053'])
  assert.deepEqual(filterLearnsetMoves(moves, { ...base, support: 'supported' }).map(move => move.moveId), ['move:0001', 'move:0053'])
})

test('Learnset explorer sorting is deterministic and unknown power is not numeric zero', () => {
  assert.deepEqual(sortLearnsetMoves(moves, 'power-desc').map(move => move.moveId), ['move:0053', 'move:0001', 'move:0068', 'move:0014'])
  assert.deepEqual(sortLearnsetMoves([...moves].reverse(), 'type').map(move => move.moveId), ['move:0068', 'move:0053', 'move:0014', 'move:0001'])
  assert.deepEqual(sortLearnsetMoves(moves, 'pp').map(move => move.moveId), ['move:0053', 'move:0014', 'move:0068', 'move:0001'])
})

test('temporary moveset prevents duplicates, caps at four, and removes invalid Form moves', () => {
  const allowed = new Set(moves.map(move => move.moveId))
  let selected: string[] = []
  for (const move of moves) selected = addMoveToMoveset(selected, move.moveId, allowed)
  selected = addMoveToMoveset(selected, 'move:0001', allowed)
  assert.deepEqual(selected, ['move:0001', 'move:0014', 'move:0053', 'move:0068'])
  assert.deepEqual(addMoveToMoveset(selected, 'move:9999', allowed), selected)
  assert.deepEqual(revalidateMoveset(selected, new Set(['move:0001', 'move:0053'])), ['move:0001', 'move:0053'])
})
