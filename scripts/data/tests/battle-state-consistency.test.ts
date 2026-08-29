import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage, DAMAGE_MODIFIER_TRACE_ORDER } from '../../../src/lib/runtime-data/damage-calculator.ts'
import { resolveAttackerItem, resolveCombatantConfiguration } from '../../../src/lib/runtime-data/damage-calculator-state.ts'
import { resolveStab, type TerastallizationState } from '../../../src/lib/runtime-data/terastallization.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeMove, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)
const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
const none: TerastallizationState = { kind: 'none' }
const stellar: TerastallizationState = { kind: 'stellar' }
const ordinary = (typeId: 'type:electric' | 'type:flying' | 'type:grass' | 'type:ice' | 'type:rock' | 'type:water'): TerastallizationState => ({ kind: 'ordinary', typeId })

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return { weather: 'none', terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false, attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 }, ...overrides }
}

async function ability(abilityId: string): Promise<RuntimeAbility> {
  const value = (await runtimePromise).abilities.find(candidate => candidate.abilityId === abilityId)
  assert.ok(value)
  return value
}

async function item(canonicalName: string): Promise<RuntimeItem> {
  const value = (await runtimePromise).items.find(candidate => candidate.canonicalName === canonicalName)
  assert.ok(value)
  return value
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({ level: 50, attack: 100, defense: 100, basePower: 100, moveTypeId: 'type:fire', moveCategory: 'special', attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:normal'], types: runtime.types, ...overrides })
}

test('state ownership validates Form-bound Ability, stable Item ID, and tagged Tera state centrally', async () => {
  const data = await runtimePromise
  const block = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  const resolved = resolveCombatantConfiguration(data, { speciesId: 'species:0006', formId: 'form:0006:base', level: 50, natureId: 'nature:hardy', ivs: block, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, abilityId: 'ability:0066', teraTypeId: 'stellar' })
  assert.deepEqual(resolved.terastallization, stellar)
  assert.equal(resolveAttackerItem(data, 'item:0270')?.itemId, 'item:0270')
  assert.throws(() => resolveCombatantConfiguration(data, { speciesId: 'species:0006', formId: 'form:0006:base', level: 50, natureId: 'nature:hardy', ivs: block, evs: block, abilityId: 'ability:0026', teraTypeId: '' }), /ABILITY_NOT_AVAILABLE_FOR_FORM|EV_TOTAL_EXCEEDED/)
  assert.throws(() => resolveAttackerItem(data, 'item:not-stable'), /DAMAGE_STATE_INVALID_ITEM/)
})

test('ordinary and Stellar Tera feed one grounded path into Terrain', async () => {
  const flyingToElectric = await core({ moveTypeId: 'type:electric', attackerTypeIds: ['type:electric', 'type:flying'], attackerTerastallization: ordinary('type:electric'), battleContext: context({ terrain: 'electric' }) })
  const normalToFlying = await core({ moveTypeId: 'type:electric', attackerTypeIds: ['type:electric'], attackerTerastallization: ordinary('type:flying'), battleContext: context({ terrain: 'electric' }) })
  const stellarFlying = await core({ moveTypeId: 'type:electric', attackerTypeIds: ['type:electric', 'type:flying'], attackerTerastallization: stellar, stellarBoostUsage: 'available', battleContext: context({ terrain: 'electric' }) })
  const levitate = await core({ moveTypeId: 'type:electric', attackerTypeIds: ['type:electric'], attackerTerastallization: ordinary('type:electric'), attackerAbility: await ability('ability:0026'), battleContext: context({ terrain: 'electric' }) })
  assert.deepEqual([flyingToElectric.attackerGrounded, normalToFlying.attackerGrounded, stellarFlying.attackerGrounded, levitate.attackerGrounded], [true, false, false, false])
  assert.deepEqual([flyingToElectric.effectiveBasePower, normalToFlying.effectiveBasePower, stellarFlying.effectiveBasePower, levitate.effectiveBasePower], [130, 100, 100, 100])
})

test('ordinary and Stellar Tera own Sandstorm and Snow defensive typing consistently', async () => {
  const sandGain = await core({ defenderTerastallization: ordinary('type:rock'), battleContext: context({ weather: 'sandstorm' }) })
  const sandLoss = await core({ defenderTypeIds: ['type:rock'], defenderTerastallization: ordinary('type:water'), battleContext: context({ weather: 'sandstorm' }) })
  const sandStellar = await core({ defenderTypeIds: ['type:rock'], defenderTerastallization: stellar, battleContext: context({ weather: 'sandstorm' }) })
  const snowGain = await core({ moveCategory: 'physical', defenderTerastallization: ordinary('type:ice'), battleContext: context({ weather: 'snow' }) })
  const snowLoss = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], defenderTerastallization: ordinary('type:water'), battleContext: context({ weather: 'snow' }) })
  const snowStellar = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], defenderTerastallization: stellar, battleContext: context({ weather: 'snow' }) })
  assert.deepEqual([sandGain.effectiveDefense, sandLoss.effectiveDefense, sandStellar.effectiveDefense], [150, 100, 150])
  assert.deepEqual([snowGain.effectiveDefense, snowLoss.effectiveDefense, snowStellar.effectiveDefense], [150, 100, 150])
})

test('critical ignores an eligible defense stage but never bypasses defensive Weather', async () => {
  const sand = await core({ defenderTypeIds: ['type:rock'], battleContext: context({ weather: 'sandstorm', criticalHit: true, defenderStatStages: { def: 0, spd: 2 } }) })
  const snow = await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], battleContext: context({ weather: 'snow', criticalHit: true, defenderStatStages: { def: 2, spd: 0 } }) })
  assert.deepEqual([sand.effectiveDefense, snow.effectiveDefense], [150, 150])
})

test('one authoritative STAB resolver covers no Tera, ordinary Tera, Stellar, and Adaptability', () => {
  const values = [
    resolveStab(['type:normal'], none, 'type:normal', false).multiplier,
    resolveStab(['type:normal'], none, 'type:normal', true).multiplier,
    resolveStab(['type:normal'], ordinary('type:water'), 'type:normal', true).multiplier,
    resolveStab(['type:normal'], ordinary('type:water'), 'type:water', true).multiplier,
    resolveStab(['type:water'], ordinary('type:water'), 'type:water', true).multiplier,
    resolveStab(['type:normal'], stellar, 'type:normal', true, 'available').multiplier,
    resolveStab(['type:normal'], stellar, 'type:normal', true, 'consumed').multiplier,
    resolveStab(['type:normal'], stellar, 'type:fire', true, 'available').multiplier,
    resolveStab(['type:normal'], stellar, 'type:fire', true, 'consumed').multiplier,
  ]
  assert.deepEqual(values, [1.5, 2, 1.5, 2, 2.25, 2, 1.5, 1.2, 1])
})

test('type-chart and Levitate immunities stay zero through every downstream modifier', async () => {
  const lifeOrb = await item('Life Orb')
  const downstream = { attackerItem: lifeOrb, battleContext: context({ weather: 'rain', criticalHit: true, lightScreen: true }) }
  const typeChart = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'], ...downstream })
  const levitate = await core({ moveTypeId: 'type:ground', defenderTypeIds: ['type:electric'], defenderAbility: await ability('ability:0026'), ...downstream })
  assert.deepEqual(typeChart.rolls, Array(16).fill(0))
  assert.deepEqual(levitate.rolls, Array(16).fill(0))
  assert.deepEqual(typeChart.modifierTrace, [{ category: 'type-effectiveness', source: 'defender-typing', label: 'type:electric', multiplier: 0 }])
  assert.deepEqual(levitate.modifierTrace, [
    { category: 'type-effectiveness', source: 'defender-typing', label: 'type:ground', multiplier: 2 },
    { category: 'ability-immunity', source: 'ability:0026', label: 'incoming-type-immunity', multiplier: 0 },
  ])
})

test('screen, Filter-class Ability, and final Item form one ordered fixed-point chain', async () => {
  const result = await core({ defenderTypeIds: ['type:grass'], defenderAbility: await ability('ability:0111'), attackerItem: await item('Life Orb'), battleContext: context({ lightScreen: true }) })
  assert.deepEqual(result.modifierTrace.slice(-4).map(entry => entry.category), ['type-effectiveness', 'screen', 'ability-final', 'item-final'])
  assert.equal(result.modifierTrace.filter(entry => entry.category === 'screen').length, 1)
  assert.equal(result.modifierTrace.filter(entry => entry.category === 'ability-final').length, 1)
  assert.equal(result.modifierTrace.filter(entry => entry.category === 'item-final').length, 1)
})

test('critical bypasses screen without bypassing Filter or Life Orb', async () => {
  const result = await core({ defenderTypeIds: ['type:grass'], defenderAbility: await ability('ability:0232'), attackerItem: await item('Life Orb'), battleContext: context({ criticalHit: true, lightScreen: true }) })
  const categories = result.modifierTrace.map(entry => entry.category)
  assert.equal(categories.includes('screen'), false)
  assert.equal(categories.includes('ability-final'), true)
  assert.equal(categories.includes('item-final'), true)
})

test('Tera changes super-effective final modifiers while Stellar retains original defense', async () => {
  const filter = await ability('ability:0111')
  const belt = await item('Expert Belt')
  const ordinaryResult = await core({ defenderTypeIds: ['type:water'], defenderTerastallization: ordinary('type:grass'), defenderAbility: filter, attackerItem: belt })
  const stellarResult = await core({ defenderTypeIds: ['type:water'], defenderTerastallization: stellar, defenderAbility: filter, attackerItem: belt })
  assert.deepEqual([ordinaryResult.typeMultiplier, ordinaryResult.abilityAdjustedTypeMultiplier, ordinaryResult.appliedItemEffects.length], [2, 1.5, 1])
  assert.deepEqual([stellarResult.typeMultiplier, stellarResult.abilityAdjustedTypeMultiplier, stellarResult.appliedItemEffects.length], [0.5, 0.5, 0])
})

test('all explicit unsupported contexts return stable reason codes without rolls', async () => {
  const data = await runtimePromise
  const move = (name: string): RuntimeMove => data.moves.find(candidate => candidate.canonicalName === name)!
  const base = { level: 50, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: data.types }
  const results = [
    calculateMoveDamage({ ...base, move: move('Body Press') }),
    calculateMoveDamage({ ...base, move: move('Facade'), battleContext: context({ attackerBurned: true }) }),
    calculateMoveDamage({ ...base, move: move('Pound'), attackerAbility: await ability('ability:0062'), battleContext: context({ attackerBurned: true }) }),
    calculateMoveDamage({ ...base, move: move('Hydro Steam'), battleContext: context({ weather: 'sun' }) }),
    ...['Weather Ball', 'Expanding Force', 'Rising Voltage', 'Earthquake', 'Bulldoze', 'Tera Blast', 'Tera Starstorm'].map(name => calculateMoveDamage({ ...base, move: move(name) })),
    calculateMoveDamage({ ...base, move: move('Pound'), attackerTerastallization: stellar }),
  ]
  assert.deepEqual(results.map(result => result.status), ['unsupported', 'unsupported', 'unsupported-context', 'unsupported-context', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unsupported', 'unresolved-context'])
  assert.equal(results.every(result => !('rolls' in result)), true)
})

test('roll, baseline, immunity, and Form-type immutability invariants hold across representative contexts', async () => {
  const originalTypes = ['type:fire', 'type:flying']
  const snapshot = [...originalTypes]
  const results = [
    await core({ attackerTypeIds: originalTypes }),
    await core({ attackerTypeIds: originalTypes, attackerTerastallization: ordinary('type:water') }),
    await core({ attackerTypeIds: originalTypes, attackerTerastallization: stellar, stellarBoostUsage: 'available', battleContext: context({ weather: 'sun', criticalHit: true, lightScreen: true }) }),
  ]
  for (const result of results) {
    assert.equal(result.rolls.length, 16)
    assert.equal(result.rolls.every(Number.isInteger), true)
    assert.equal(result.rolls.every((value, index) => index === 0 || value >= result.rolls[index - 1]), true)
    assert.equal(result.minDamage, result.rolls[0])
    assert.equal(result.maxDamage, result.rolls[15])
  }
  assert.deepEqual(originalTypes, snapshot)
})

test('modifier trace is deterministic, ordered, and cannot influence recalculation', async () => {
  const input = { attackerTerastallization: stellar as TerastallizationState, stellarBoostUsage: 'available' as const, defenderTypeIds: ['type:grass'], attackerItem: await item('Life Orb'), battleContext: context({ weather: 'sun', lightScreen: true }) }
  const first = await core(input)
  const rolls = [...first.rolls]
  first.modifierTrace.splice(0)
  const second = await core(input)
  assert.deepEqual(second.rolls, rolls)
  assert.equal(second.modifierTrace.every((entry, index, trace) => index === 0 || DAMAGE_MODIFIER_TRACE_ORDER.indexOf(entry.category) >= DAMAGE_MODIFIER_TRACE_ORDER.indexOf(trace[index - 1].category)), true)
})
