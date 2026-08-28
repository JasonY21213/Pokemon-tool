import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { RuntimeMove, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50,
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

test('Gen 9 neutral Level 50 roll range floors independently at every stage', async () => {
  const result = await core()
  assert.deepEqual(result.rolls, [20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24])
  assert.equal(result.minDamage, 20)
  assert.equal(result.maxDamage, 24)
  assert.equal(result.stabMultiplier, 1)
  assert.equal(result.typeMultiplier, 1)
})

test('ordinary STAB and all canonical type multipliers use exact integer order', async () => {
  assert.deepEqual((await core({ attackerTypeIds: ['type:fire'] })).rolls, [30, 30, 30, 31, 31, 31, 31, 33, 33, 33, 33, 34, 34, 34, 34, 36])
  assert.deepEqual([(await core({ defenderTypeIds: ['type:grass'] })).minDamage, (await core({ defenderTypeIds: ['type:grass'] })).maxDamage], [40, 48])
  assert.deepEqual([(await core({ moveTypeId: 'type:rock', defenderTypeIds: ['type:fire', 'type:flying'] })).minDamage, (await core({ moveTypeId: 'type:rock', defenderTypeIds: ['type:fire', 'type:flying'] })).maxDamage], [80, 96])
  assert.deepEqual([(await core({ defenderTypeIds: ['type:fire'] })).minDamage, (await core({ defenderTypeIds: ['type:fire'] })).maxDamage], [10, 12])
  assert.deepEqual([(await core({ moveTypeId: 'type:grass', defenderTypeIds: ['type:grass', 'type:poison'] })).minDamage, (await core({ moveTypeId: 'type:grass', defenderTypeIds: ['type:grass', 'type:poison'] })).maxDamage], [5, 6])
  const immune = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'] })
  assert.deepEqual(immune.rolls, Array(16).fill(0))
  assert.equal(immune.minDamage, 0)
  assert.equal(immune.maxDamage, 0)
})

test('Level 100 fixture preserves the independent 144 to 170 range', async () => {
  const result = await core({ level: 100, attack: 200, defense: 100, basePower: 100 })
  assert.equal(result.minDamage, 144)
  assert.equal(result.maxDamage, 170)
})

test('physical and special moves select the correct final stat pair', async () => {
  const runtime = await runtimePromise
  const statsA: RuntimeStatBlock = { hp: 200, atk: 200, def: 100, spa: 100, spd: 100, spe: 100 }
  const statsD: RuntimeStatBlock = { hp: 200, atk: 100, def: 100, spa: 100, spd: 200, spe: 100 }
  const calculate = (move: RuntimeMove) => calculateMoveDamage({ level: 50, move, attackerStats: statsA, defenderStats: statsD, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: runtime.types })
  const physical = calculate(runtime.moves.find(move => move.moveId === 'move:0001')!)
  const special = calculate(runtime.moves.find(move => move.moveId === 'move:0053')!)
  assert.equal(physical.status, 'supported')
  assert.equal(special.status, 'supported')
  if (physical.status === 'supported') assert.deepEqual({ attackingStat: physical.attackingStat, defendingStat: physical.defendingStat, attack: physical.attack, defense: physical.defense }, { attackingStat: 'atk', defendingStat: 'def', attack: 200, defense: 100 })
  if (special.status === 'supported') assert.deepEqual({ attackingStat: special.attackingStat, defendingStat: special.defendingStat, attack: special.attack, defense: special.defense }, { attackingStat: 'spa', defendingStat: 'spd', attack: 100, defense: 200 })
})

test('Form-specific attacker and defender typing changes STAB and effectiveness', async () => {
  const runtime = await runtimePromise
  const charizard = runtime.forms.find(form => form.formId === 'form:0006:base')!
  const megaX = runtime.forms.find(form => form.formId === 'form:0006:mega-x')!
  const dragonFromCharizard = await core({ moveTypeId: 'type:dragon', attackerTypeIds: charizard.types })
  const dragonFromMegaX = await core({ moveTypeId: 'type:dragon', attackerTypeIds: megaX.types })
  assert.equal(dragonFromCharizard.stabMultiplier, 1)
  assert.equal(dragonFromMegaX.stabMultiplier, 1.5)
  assert.equal((await core({ moveTypeId: 'type:rock', defenderTypeIds: charizard.types })).typeMultiplier, 4)
  assert.equal((await core({ moveTypeId: 'type:rock', defenderTypeIds: megaX.types })).typeMultiplier, 2)
})

test('status and exceptional damage Moves return explicit non-results', async () => {
  const runtime = await runtimePromise
  const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
  const calculate = (moveId: string) => calculateMoveDamage({ level: 50, move: runtime.moves.find(move => move.moveId === moveId)!, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: runtime.types })
  assert.deepEqual(calculate('move:0014'), { status: 'non-damaging' })
  assert.deepEqual(calculate('move:0776'), { status: 'unsupported', reason: 'nonstandard-stat-selection' })
  assert.deepEqual(calculate('move:0069'), { status: 'unsupported', reason: 'fixed-or-counter-damage' })
})

test('all returned supported roll values are ordered integers', async () => {
  const runtime = await runtimePromise
  for (const move of runtime.moves.filter(move => move.damageSupport.status === 'supported')) {
    const result = calculateMoveDamage({ level: 50, move, attackerStats: { hp: 150, atk: 120, def: 100, spa: 130, spd: 110, spe: 100 }, defenderStats: { hp: 160, atk: 100, def: 105, spa: 100, spd: 115, spe: 100 }, attackerTypeIds: ['type:fire', 'type:flying'], defenderTypeIds: ['type:normal'], types: runtime.types })
    assert.equal(result.status, 'supported')
    if (result.status === 'supported') {
      assert.equal(result.rolls.every(Number.isInteger), true)
      assert.equal(result.rolls.every((value, index) => index === 0 || value >= result.rolls[index - 1]), true)
      assert.equal(result.minDamage, result.rolls[0])
      assert.equal(result.maxDamage, result.rolls.at(-1))
    }
  }
})

test('Move support audit covers exactly all 950 runtime Moves', async () => {
  const artifacts = await buildFullDryRun()
  assert.deepEqual(artifacts.damageSupportReport, {
    supported: 373,
    nonDamaging: 271,
    unsupported: 306,
    incomplete: 0,
    unsupportedByReason: {
      'conditional-hit-mechanics': 5, 'conditional-immunity': 1, 'damage-cap': 2,
      'dynamic-move-mechanics': 7, 'dynamic-move-type': 11, 'fixed-or-counter-damage': 14,
      'forced-critical-hit': 4, 'max-or-z-move': 85, 'multi-hit': 28,
      'non-numeric-base-power': 5, 'nonstandard-stat-selection': 5,
      'nonstandard-type-effectiveness': 3, ohko: 4, 'spread-target': 61, 'variable-base-power': 71,
    },
  })
})
