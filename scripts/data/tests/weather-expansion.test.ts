import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)
const BASELINE_ROLLS = [20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24]
const BOOSTED_WEATHER_ROLLS = [30, 30, 31, 31, 32, 32, 32, 33, 33, 33, 34, 34, 34, 35, 35, 36]
const REDUCED_WEATHER_ROLLS = [10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12]
const WEATHER_DEFENSE_ROLLS = [13, 13, 13, 14, 14, 14, 14, 14, 14, 15, 15, 15, 15, 15, 15, 16]

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    weather: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false,
    attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 },
    ...overrides,
  }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveCategory: 'special',
    moveTypeId: 'type:dark', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

async function item(itemId: string): Promise<RuntimeItem> {
  const value = (await runtimePromise).items.find(candidate => candidate.itemId === itemId)
  assert.ok(value)
  return value
}

async function ability(abilityId: string): Promise<RuntimeAbility> {
  const value = (await runtimePromise).abilities.find(candidate => candidate.abilityId === abilityId)
  assert.ok(value)
  return value
}

test('Sun and Rain retain their exact Fire and Water damage modifiers', async () => {
  assert.deepEqual((await core({ moveTypeId: 'type:fire', battleContext: context({ weather: 'sun' }) })).rolls, BOOSTED_WEATHER_ROLLS)
  assert.deepEqual((await core({ moveTypeId: 'type:water', battleContext: context({ weather: 'sun' }) })).rolls, REDUCED_WEATHER_ROLLS)
  assert.deepEqual((await core({ moveTypeId: 'type:water', battleContext: context({ weather: 'rain' }) })).rolls, BOOSTED_WEATHER_ROLLS)
  assert.deepEqual((await core({ moveTypeId: 'type:fire', battleContext: context({ weather: 'rain' }) })).rolls, REDUCED_WEATHER_ROLLS)
})

test('Sandstorm boosts only Rock defenders Special Defense', async () => {
  const specialRock = await core({ defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm' }) })
  const physicalRock = await core({ moveCategory: 'physical', defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm' }) })
  const specialNormal = await core({ battleContext: context({ weather: 'sandstorm' }) })
  assert.deepEqual(specialRock.rolls, WEATHER_DEFENSE_ROLLS)
  assert.equal(specialRock.effectiveDefense, 150)
  assert.deepEqual(physicalRock.rolls, BASELINE_ROLLS)
  assert.deepEqual(specialNormal.rolls, BASELINE_ROLLS)
})

test('Snow boosts only Ice defenders Defense and is not legacy Hail', async () => {
  const physicalIce = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow' }) })
  const specialIce = await core({ defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow' }) })
  const physicalNormal = await core({ moveCategory: 'physical', battleContext: context({ weather: 'snow' }) })
  assert.deepEqual(physicalIce.rolls, WEATHER_DEFENSE_ROLLS)
  assert.equal(physicalIce.effectiveDefense, 150)
  assert.deepEqual(specialIce.rolls, BASELINE_ROLLS)
  assert.deepEqual(physicalNormal.rolls, BASELINE_ROLLS)
})

test('weather defense uses actual pure, dual, and alternate Form typing', async () => {
  const runtime = await runtimePromise
  const form = (id: string) => runtime.forms.find(candidate => candidate.formId === id)!
  for (const id of ['form:0185:base', 'form:0464:base']) {
    assert.equal((await core({ defenderTypeIds: form(id).types, battleContext: context({ weather: 'sandstorm' }) })).effectiveDefense, 150)
  }
  for (const id of ['form:0471:base', 'form:0460:base', 'form:0479:frost']) {
    assert.equal((await core({ moveCategory: 'physical', defenderTypeIds: form(id).types, battleContext: context({ weather: 'snow' }) })).effectiveDefense, 150)
  }
  assert.equal((await core({ moveCategory: 'physical', defenderTypeIds: form('form:0479:base').types, battleContext: context({ weather: 'snow' }) })).effectiveDefense, 100)
})

test('weather defense follows stages while critical ignores only the positive stage', async () => {
  const sandStaged = await core({ defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm', defenderStatStages: { def: 0, spd: 2 } }) })
  const sandCritical = await core({ defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm', criticalHit: true, defenderStatStages: { def: 0, spd: 2 } }) })
  const snowStaged = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow', defenderStatStages: { def: 2, spd: 0 } }) })
  const snowCritical = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow', criticalHit: true, defenderStatStages: { def: 2, spd: 0 } }) })
  assert.deepEqual([sandStaged.effectiveDefense, snowStaged.effectiveDefense], [300, 300])
  assert.deepEqual(sandStaged.rolls, [7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9])
  assert.deepEqual(snowStaged.rolls, sandStaged.rolls)
  assert.deepEqual([sandCritical.effectiveDefense, snowCritical.effectiveDefense], [150, 150])
  assert.deepEqual(sandCritical.rolls, BASELINE_ROLLS)
  assert.deepEqual(snowCritical.rolls, BASELINE_ROLLS)
  assert.equal(sandCritical.appliedBattleContextModifiers.some(modifier => modifier.kind === 'weather-defense-stat' && modifier.before === 100 && modifier.after === 150), true)
})

test('Snow and Sandstorm compose with burn and Choice stat Items', async () => {
  const snowBurn = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow', attackerBurned: true }) })
  const sandSpecs = await core({ attackerItem: await item('item:0297'), defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm' }) })
  assert.deepEqual(snowBurn.rolls, [6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8])
  assert.deepEqual(sandSpecs.rolls, BASELINE_ROLLS)
  assert.equal(sandSpecs.effectiveAttack, 150)
  assert.equal(sandSpecs.effectiveDefense, 150)
})

test('Sun and Rain compose with Thick Fat and Adaptability', async () => {
  const sunThickFat = await core({ moveTypeId: 'type:fire', defenderAbility: await ability('ability:0047'), battleContext: context({ weather: 'sun' }) })
  const rainAdaptability = await core({ moveTypeId: 'type:water', attackerTypeIds: ['type:water'], attackerAbility: await ability('ability:0091'), battleContext: context({ weather: 'rain' }) })
  assert.deepEqual(sunThickFat.rolls, [16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19])
  assert.deepEqual(rainAdaptability.rolls, [60, 60, 62, 62, 64, 64, 64, 66, 66, 66, 68, 68, 68, 70, 70, 72])
})

test('weather composes with Life Orb, screens, and Filter-class final modifiers', async () => {
  const sandLifeOrb = await core({ attackerItem: await item('item:0270'), defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm' }) })
  const snowReflect = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow', reflect: true }) })
  const sunFilter = await core({ moveTypeId: 'type:fire', defenderTypeIds: ['type:grass'], defenderAbility: await ability('ability:0111'), battleContext: context({ weather: 'sun' }) })
  assert.deepEqual(sandLifeOrb.rolls, [17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 21])
  assert.deepEqual(snowReflect.rolls, [6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8])
  assert.deepEqual(sunFilter.rolls, [45, 45, 46, 46, 48, 48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54])
})

test('weather invariants keep rolls integer and ordered while immunity remains zero', async () => {
  const result = await core({ attackerItem: await item('item:0270'), defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm', criticalHit: true, lightScreen: true }) })
  assert.equal(result.rolls.every(Number.isInteger), true)
  assert.equal(result.rolls.every((value, index) => index === 0 || value >= result.rolls[index - 1]), true)
  const immune = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'], battleContext: context({ weather: 'snow' }) })
  assert.deepEqual(immune.rolls, Array(16).fill(0))
})

test('weather-sensitive Moves retain explicit unsupported policies', async () => {
  const runtime = await runtimePromise
  const support = (id: string) => runtime.moves.find(move => move.moveId === id)?.damageSupport
  assert.deepEqual(support('move:0311'), { status: 'unsupported', reason: 'dynamic-move-type' })
  assert.deepEqual(support('move:0076'), { status: 'unsupported', reason: 'variable-base-power' })
  assert.deepEqual(support('move:0669'), { status: 'unsupported', reason: 'variable-base-power' })

  const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
  const hydroSteam = runtime.moves.find(move => move.moveId === 'move:0876')!
  const steamEruption = runtime.moves.find(move => move.moveId === 'move:0592')!
  const input = { level: 50, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:water'], defenderTypeIds: ['type:normal'], types: runtime.types }
  assert.deepEqual(calculateMoveDamage({ ...input, move: hydroSteam, battleContext: context({ weather: 'sun' }) }), { status: 'unsupported-context', reason: 'sun-with-hydro-steam' })
  assert.equal(calculateMoveDamage({ ...input, move: steamEruption, battleContext: context({ weather: 'rain' }) }).status, 'supported')
})
