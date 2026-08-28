import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateStats, totalEvs, validateStatCalculationInput, type StatCalculationInput } from '../../../src/lib/runtime-data/stat-calculator.ts'
import type { RuntimeNature, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'

const base: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
const zero: RuntimeStatBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const max: RuntimeStatBlock = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
const neutral: RuntimeNature = { natureId: 'nature:hardy', canonicalName: 'Hardy', plusStat: null, minusStat: null, neutral: true }
const adamant: RuntimeNature = { natureId: 'nature:adamant', canonicalName: 'Adamant', plusStat: 'atk', minusStat: 'spa', neutral: false }

function input(overrides: Partial<StatCalculationInput> = {}): StatCalculationInput {
  return { speciesId: 'species:0001', baseStats: base, level: 100, ivs: max, evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 }, nature: neutral, ...overrides }
}

test('level 100 neutral formula applies HP and other stats independently', () => {
  assert.deepEqual(calculateStats(input()), { hp: 404, atk: 299, def: 236, spa: 236, spd: 236, spe: 236 })
})

test('level 50 floors EV contribution before scaling', () => {
  assert.deepEqual(calculateStats(input({ level: 50, evs: { hp: 6, atk: 6, def: 6, spa: 6, spd: 6, spe: 6 } })), { hp: 176, atk: 121, def: 121, spa: 121, spd: 121, spe: 121 })
})

test('nature applies plus and minus after the non-HP floor and never changes HP', () => {
  const result = calculateStats(input({ level: 50, evs: { hp: 6, atk: 6, def: 6, spa: 6, spd: 6, spe: 6 }, nature: adamant }))
  assert.equal(result.hp, 176)
  assert.equal(result.atk, 133)
  assert.equal(result.spa, 108)
  assert.equal(result.def, 121)
})

test('Shedinja HP is always one', () => {
  assert.equal(calculateStats(input({ speciesId: 'species:0292', level: 100 })).hp, 1)
})

test('IV and EV extremes produce independently derived expected values', () => {
  assert.equal(calculateStats(input({ ivs: zero, evs: zero })).atk, 205)
  assert.equal(calculateStats(input()).atk, 299)
})

test('Form-specific base stats produce different final stats', () => {
  const charizard = calculateStats(input({ baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, level: 50, nature: adamant }))
  const megaX = calculateStats(input({ baseStats: { hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 }, level: 50, nature: adamant }))
  assert.equal(charizard.atk, 149)
  assert.equal(megaX.atk, 200)
})

test('input boundaries are accepted and invalid values are rejected without clamping', () => {
  assert.doesNotThrow(() => validateStatCalculationInput(input({ level: 1, ivs: zero, evs: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 } })))
  assert.equal(totalEvs({ hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 }), 510)
  assert.throws(() => validateStatCalculationInput(input({ level: 101 })), /INVALID_LEVEL/)
  assert.throws(() => validateStatCalculationInput(input({ ivs: { ...max, hp: 32 } })), /INVALID_IV_HP/)
  assert.throws(() => validateStatCalculationInput(input({ evs: { hp: 252, atk: 252, def: 7, spa: 0, spd: 0, spe: 0 } })), /EV_TOTAL_EXCEEDED/)
})
