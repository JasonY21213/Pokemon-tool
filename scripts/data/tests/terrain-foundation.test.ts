import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isGroundedForTerrain, validateBattleContext, type BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeMove, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    weather: 'none', terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false,
    attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 },
    ...overrides,
  }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveCategory: 'special',
    moveTypeId: 'type:electric', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
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

test('terrain model accepts exactly the five Phase 17 states', () => {
  for (const terrain of ['none', 'electric', 'grassy', 'psychic', 'misty'] as const) assert.doesNotThrow(() => validateBattleContext(context({ terrain })))
  assert.throws(() => validateBattleContext({ ...context(), terrain: 'invalid' as BattleContext['terrain'] }), /BATTLE_CONTEXT_INVALID_TERRAIN/)
})

test('limited grounded policy uses actual Form typing and only explicitly selected Levitate', () => {
  assert.equal(isGroundedForTerrain(['type:normal']), true)
  assert.equal(isGroundedForTerrain(['type:fire', 'type:dragon']), true)
  assert.equal(isGroundedForTerrain(['type:flying']), false)
  assert.equal(isGroundedForTerrain(['type:fire', 'type:flying']), false)
  assert.equal(isGroundedForTerrain(['type:electric'], 'ability:0026'), false)
  assert.equal(isGroundedForTerrain(['type:electric'], null), true)
  assert.equal(isGroundedForTerrain(['type:electric'], 'ability:0001'), true)
  assert.equal(isGroundedForTerrain(['type:flying'], 'ability:0001'), false)
})

test('actual Rotom, Flying Electric, and Flying Dragon Form typing drives grounded state', async () => {
  const runtime = await runtimePromise
  const form = (formId: string) => {
    const value = runtime.forms.find(candidate => candidate.formId === formId)
    assert.ok(value)
    return value
  }
  const rotom = form('form:0479:base')
  const zapdos = form('form:0145:base')
  const dragonite = form('form:0149:base')
  assert.equal(isGroundedForTerrain(rotom.types), true)
  assert.equal(isGroundedForTerrain(rotom.types, 'ability:0026'), false)
  assert.equal(isGroundedForTerrain(zapdos.types), false)
  assert.equal(isGroundedForTerrain(dragonite.types), false)

  const electric = await core({ attackerTypeIds: zapdos.types, battleContext: context({ terrain: 'electric' }) })
  const dragon = await core({ moveTypeId: 'type:dragon', defenderTypeIds: dragonite.types, battleContext: context({ terrain: 'misty' }) })
  assert.equal(electric.appliedTerrainEffects.length, 0)
  assert.equal(dragon.appliedTerrainEffects.length, 0)
})

test('Electric, Grassy, and Psychic Terrain use the exact grounded attacker BasePower modifier', async () => {
  for (const [terrain, moveTypeId] of [['electric', 'type:electric'], ['grassy', 'type:grass'], ['psychic', 'type:psychic']] as const) {
    const result = await core({ moveTypeId, battleContext: context({ terrain }) })
    assert.equal(result.effectiveBasePower, 65)
    assert.deepEqual(result.appliedTerrainEffects, [{ kind: 'attacker-type-base-power', terrain, typeId: moveTypeId, numerator: 5325, denominator: 4096 }])
    assert.equal(result.attackerGrounded, true)
  }
})

test('direct Terrain boosts do not affect a wrong move type or an airborne attacker', async () => {
  const wrongType = await core({ moveTypeId: 'type:fire', battleContext: context({ terrain: 'electric' }) })
  const flying = await core({ attackerTypeIds: ['type:electric', 'type:flying'], battleContext: context({ terrain: 'electric' }) })
  const levitating = await core({ attackerAbility: await ability('ability:0026'), battleContext: context({ terrain: 'electric' }) })
  assert.deepEqual([wrongType.effectiveBasePower, flying.effectiveBasePower, levitating.effectiveBasePower], [50, 50, 50])
  assert.deepEqual([wrongType.appliedTerrainEffects.length, flying.appliedTerrainEffects.length, levitating.appliedTerrainEffects.length], [0, 0, 0])
  assert.deepEqual([flying.attackerGrounded, levitating.attackerGrounded], [false, false])
})

test('Misty Terrain halves Dragon BasePower only against a grounded defender', async () => {
  const grounded = await core({ moveTypeId: 'type:dragon', battleContext: context({ terrain: 'misty' }) })
  const flying = await core({ moveTypeId: 'type:dragon', defenderTypeIds: ['type:normal', 'type:flying'], battleContext: context({ terrain: 'misty' }) })
  const levitating = await core({ moveTypeId: 'type:dragon', defenderAbility: await ability('ability:0026'), battleContext: context({ terrain: 'misty' }) })
  const nonDragon = await core({ moveTypeId: 'type:fire', battleContext: context({ terrain: 'misty' }) })
  assert.equal(grounded.effectiveBasePower, 25)
  assert.deepEqual(grounded.appliedTerrainEffects, [{ kind: 'defender-dragon-base-power-reduction', terrain: 'misty', typeId: 'type:dragon', numerator: 1, denominator: 2 }])
  assert.deepEqual([flying.effectiveBasePower, levitating.effectiveBasePower, nonDragon.effectiveBasePower], [50, 50, 50])
  assert.deepEqual([flying.defenderGrounded, levitating.defenderGrounded], [false, false])
})

test('Levitate Ground immunity remains separate from its Terrain grounded signal', async () => {
  const result = await core({ moveTypeId: 'type:ground', defenderAbility: await ability('ability:0026'), battleContext: context({ terrain: 'misty' }) })
  assert.equal(result.defenderGrounded, false)
  assert.equal(result.abilityAdjustedTypeMultiplier, 0)
  assert.deepEqual(result.rolls, Array(16).fill(0))
  assert.equal(result.appliedTerrainEffects.length, 0)
})

test('weather and Terrain coexist at their pinned stages', async () => {
  const grassySun = await core({ moveTypeId: 'type:grass', attackerTypeIds: ['type:grass'], battleContext: context({ weather: 'sun', terrain: 'grassy' }) })
  const grassyOnly = await core({ moveTypeId: 'type:grass', attackerTypeIds: ['type:grass'], battleContext: context({ terrain: 'grassy' }) })
  assert.deepEqual(grassySun.rolls, grassyOnly.rolls)
  assert.equal(grassySun.appliedTerrainEffects.length, 1)

  const terrainOnly = await core({ moveTypeId: 'type:fire', attackerTypeIds: ['type:fire'], battleContext: context({ terrain: 'grassy' }) })
  const weatherOnly = await core({ moveTypeId: 'type:fire', attackerTypeIds: ['type:fire'], battleContext: context({ weather: 'sun' }) })
  const both = await core({ moveTypeId: 'type:fire', attackerTypeIds: ['type:fire'], battleContext: context({ weather: 'sun', terrain: 'grassy' }) })
  assert.deepEqual(both.rolls, weatherOnly.rolls)
  assert.notDeepEqual(both.rolls, terrainOnly.rolls)

  const electricRain = await core({ attackerTypeIds: ['type:electric'], battleContext: context({ weather: 'rain', terrain: 'electric' }) })
  const electricOnly = await core({ attackerTypeIds: ['type:electric'], battleContext: context({ terrain: 'electric' }) })
  assert.deepEqual(electricRain.rolls, electricOnly.rolls)
  assert.equal(electricRain.effectiveBasePower, 65)
})

test('Terrain composes with STAB, effectiveness, critical hit, screens, Abilities, and Items', async () => {
  const lifeOrb = await item('Life Orb')
  const choiceSpecs = await item('Choice Specs')
  const adaptability = await ability('ability:0091')
  const filter = await ability('ability:0111')
  const electric = await core({ attackerTypeIds: ['type:electric'], defenderTypeIds: ['type:water'], attackerItem: lifeOrb, battleContext: context({ terrain: 'electric', criticalHit: true, lightScreen: true }) })
  assert.equal(electric.effectiveBasePower, 65)
  assert.equal(electric.stabMultiplier, 1.5)
  assert.equal(electric.typeMultiplier, 2)
  assert.equal(electric.appliedBattleContextModifiers.some(effect => effect.kind === 'screen-bypassed'), true)
  assert.equal(electric.appliedItemEffects.some(effect => effect.effect.kind === 'final-damage-multiplier'), true)

  const psychic = await core({ moveTypeId: 'type:psychic', attackerTypeIds: ['type:psychic'], attackerAbility: adaptability, attackerItem: choiceSpecs, defenderTypeIds: ['type:fighting'], defenderAbility: filter, battleContext: context({ terrain: 'psychic' }) })
  assert.equal(psychic.effectiveAttack, 150)
  assert.equal(psychic.effectiveBasePower, 65)
  assert.equal(psychic.stabMultiplier, 2)
  assert.equal(psychic.abilityAdjustedTypeMultiplier, 1.5)
})

test('Terrain result rolls remain ordered integers and immunity remains zero', async () => {
  const result = await core({ attackerTypeIds: ['type:electric'], defenderTypeIds: ['type:water'], battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.rolls.every(Number.isInteger), true)
  assert.equal(result.rolls.every((value, index) => index === 0 || value >= result.rolls[index - 1]), true)
  assert.deepEqual([result.minDamage, result.maxDamage], [result.rolls[0], result.rolls.at(-1)])
  const immune = await core({ defenderTypeIds: ['type:water', 'type:ground'], battleContext: context({ terrain: 'electric' }) })
  assert.deepEqual(immune.rolls, Array(16).fill(0))
})

test('terrain-sensitive Moves preserve explicit support boundaries', async () => {
  const runtime = await runtimePromise
  const support = (moveId: string) => runtime.moves.find(move => move.moveId === moveId)?.damageSupport
  assert.deepEqual(support('move:0797'), { status: 'unsupported', reason: 'variable-base-power' })
  assert.deepEqual(support('move:0804'), { status: 'unsupported', reason: 'variable-base-power' })
  assert.deepEqual(support('move:0805'), { status: 'unsupported', reason: 'dynamic-move-type' })
  assert.deepEqual(support('move:0089'), { status: 'unsupported', reason: 'spread-target' })
  assert.deepEqual(support('move:0523'), { status: 'unsupported', reason: 'spread-target' })
  assert.deepEqual(support('move:0803'), { status: 'supported' })

  const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
  const grassyGlide = runtime.moves.find(move => move.moveId === 'move:0803') as RuntimeMove
  const result = calculateMoveDamage({ level: 50, move: grassyGlide, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:grass'], defenderTypeIds: ['type:normal'], types: runtime.types, battleContext: context({ terrain: 'grassy' }) })
  assert.equal(result.status, 'supported')
  if (result.status === 'supported') {
    assert.equal(result.effectiveBasePower, 72)
    assert.equal(result.appliedTerrainEffects.length, 1)
  }
})
