import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyStatStage, type BattleContext, type BattleStatStage } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { RuntimeMove, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    weather: 'none', attackerBurned: false,
    attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 },
    ...overrides,
  }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveCategory: 'physical',
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

test('stat stages use the exact Gen 9 rational formula at both edges', () => {
  assert.deepEqual([-6, -1, 0, 1, 6].map(stage => applyStatStage(100, stage as BattleStatStage)), [25, 66, 100, 150, 400])
  assert.equal(applyStatStage(101, -1), 67)
  assert.throws(() => applyStatStage(100, 7 as BattleStatStage), /BATTLE_CONTEXT_INVALID_STAT_STAGE/)
  assert.throws(() => applyStatStage(0, 0), /BATTLE_CONTEXT_INVALID_STAT_VALUE/)
})

test('physical and special categories select only their matching stage pair', async () => {
  const battleContext = context({ attackerStatStages: { atk: 1, spa: -6 }, defenderStatStages: { def: -1, spd: 6 } })
  const physical = await core({ battleContext, moveCategory: 'physical' })
  const special = await core({ battleContext, moveCategory: 'special' })
  assert.deepEqual([physical.effectiveAttack, physical.effectiveDefense], [150, 66])
  assert.deepEqual([special.effectiveAttack, special.effectiveDefense], [25, 400])
  assert.deepEqual(physical.appliedBattleContextModifiers.slice(0, 2), [
    { kind: 'stat-stage', stat: 'atk', stage: 1, before: 100, after: 150 },
    { kind: 'stat-stage', stat: 'def', stage: -1, before: 100, after: 66 },
  ])
})

test('burn halves only ordinary physical damage after type effectiveness', async () => {
  const burned = context({ attackerBurned: true })
  assert.deepEqual((await core({ battleContext: burned, moveCategory: 'physical' })).rolls, [10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12])
  assert.deepEqual((await core({ battleContext: burned, moveCategory: 'special' })).rolls, [20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24])
})

test('sun and rain apply only the standard Fire and Water fixed-point modifiers', async () => {
  assert.deepEqual((await core({ battleContext: context({ weather: 'sun' }) })).rolls, [30, 30, 31, 31, 32, 32, 32, 33, 33, 33, 34, 34, 34, 35, 35, 36])
  assert.deepEqual((await core({ battleContext: context({ weather: 'rain' }) })).rolls, [10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12])
  const unaffected = await core({ moveTypeId: 'type:normal', battleContext: context({ weather: 'sun' }) })
  assert.deepEqual(unaffected.rolls, (await core({ moveTypeId: 'type:normal' })).rolls)
})

test('stages, weather, STAB, type, burn, and defensive Ability compose deterministically', async () => {
  const runtime = await runtimePromise
  const filter = runtime.abilities.find(ability => ability.abilityId === 'ability:0111')!
  const result = await core({
    attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:grass'], defenderAbility: filter,
    battleContext: context({ weather: 'sun', attackerBurned: true, attackerStatStages: { atk: 1, spa: 0 }, defenderStatStages: { def: -1, spd: 0 } }),
  })
  assert.deepEqual(result.rolls, [74, 75, 75, 76, 77, 79, 79, 79, 81, 82, 83, 83, 84, 85, 86, 88])
  assert.deepEqual(result.appliedBattleContextModifiers.map(item => item.kind), ['stat-stage', 'stat-stage', 'weather', 'burn'])
  assert.equal(result.appliedAbilityEffects.at(-1)?.effect.kind, 'super-effective-damage-multiplier')
  assert.equal(result.rolls.every(Number.isInteger), true)
})

test('unmodeled burn and special-weather exceptions return explicit non-results', async () => {
  const runtime = await runtimePromise
  const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
  const move = (id: string): RuntimeMove => runtime.moves.find(candidate => candidate.moveId === id)!
  const base = { level: 50, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: runtime.types }
  assert.deepEqual(calculateMoveDamage({ ...base, move: move('move:0001'), attackerAbility: runtime.abilities.find(ability => ability.abilityId === 'ability:0062'), battleContext: context({ attackerBurned: true }) }), { status: 'unsupported-context', reason: 'burn-with-guts' })
  assert.deepEqual(calculateMoveDamage({ ...base, move: move('move:0876'), battleContext: context({ weather: 'sun' }) }), { status: 'unsupported-context', reason: 'sun-with-hydro-steam' })
  assert.deepEqual(calculateMoveDamage({ ...base, move: move('move:0263'), battleContext: context({ attackerBurned: true }) }), { status: 'unsupported', reason: 'variable-base-power' })
})
