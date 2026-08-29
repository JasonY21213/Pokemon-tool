import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import { STANDARD_TERA_TYPE_IDS, effectiveTypeIds, resolveStab, validateTerastallizationState, type StandardTeraTypeId, type TerastallizationState } from '../../../src/lib/runtime-data/terastallization.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)
const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }

const tera = (typeId: StandardTeraTypeId): TerastallizationState => ({ kind: 'ordinary', typeId })
const stabSummary = (result: ReturnType<typeof resolveStab>) => ({ multiplier: result.multiplier, basis: result.basis, adaptabilityApplied: result.adaptabilityApplied })

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    weather: 'none', terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false,
    attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 }, ...overrides,
  }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 100, moveCategory: 'special',
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
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

test('standard Tera model exposes exactly 18 unique non-Stellar types', () => {
  assert.equal(STANDARD_TERA_TYPE_IDS.length, 18)
  assert.equal(new Set(STANDARD_TERA_TYPE_IDS).size, 18)
  assert.equal(STANDARD_TERA_TYPE_IDS.some(typeId => typeId.includes('stellar')), false)
})

test('1. dual-type defender Tera uses only its new defensive type', async () => {
  const result = await core({ moveTypeId: 'type:water', defenderTypeIds: ['type:fire', 'type:flying'], defenderTerastallization: tera('type:dragon') })
  assert.equal(result.typeMultiplier, 0.5)
  assert.deepEqual(result.effectiveDefenderTypeIds, ['type:dragon'])
})

test('2. an old Ground type immunity disappears after Tera Grass', async () => {
  const result = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'], defenderTerastallization: tera('type:grass') })
  assert.equal(result.typeMultiplier, 0.5)
  assert.notEqual(result.abilityAdjustedTypeMultiplier, 0)
})

test('3. new Tera weaknesses and resistances come only from the Tera type', async () => {
  assert.equal((await core({ defenderTerastallization: tera('type:grass') })).typeMultiplier, 2)
  assert.equal((await core({ moveTypeId: 'type:water', defenderTerastallization: tera('type:grass') })).typeMultiplier, 0.5)
})

test('4. selected Levitate remains a separate Ground immunity after Tera', async () => {
  const result = await core({ moveTypeId: 'type:ground', defenderTerastallization: tera('type:electric'), defenderAbility: await ability('ability:0026') })
  assert.equal(result.typeMultiplier, 2)
  assert.equal(result.abilityAdjustedTypeMultiplier, 0)
  assert.deepEqual(result.rolls, Array(16).fill(0))
})

test('5. an original-type Move retains ordinary STAB after off-type Tera', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:fire', 'type:flying'], tera('type:dragon'), 'type:fire', false)), { multiplier: 1.5, basis: 'original-type', adaptabilityApplied: false })
})

test('6. a new Tera-type Move receives ordinary STAB', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:fire', 'type:flying'], tera('type:dragon'), 'type:dragon', false)), { multiplier: 1.5, basis: 'tera-type', adaptabilityApplied: false })
})

test('7. same-type Tera resolves to one 2x STAB', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:fire', 'type:flying'], tera('type:fire'), 'type:fire', false)), { multiplier: 2, basis: 'same-type-tera', adaptabilityApplied: false })
})

test('8. a Move matching neither original nor Tera type receives no STAB', () => {
  assert.equal(resolveStab(['type:fire', 'type:flying'], tera('type:dragon'), 'type:grass', false).multiplier, 1)
})

test('9. both original types of a dual-type Form retain STAB history', () => {
  assert.equal(resolveStab(['type:fire', 'type:flying'], tera('type:dragon'), 'type:flying', false).multiplier, 1.5)
})

test('10. non-Tera Adaptability retains its reviewed 2x baseline', () => {
  assert.equal(resolveStab(['type:normal'], { kind: 'none' }, 'type:normal', true).multiplier, 2)
})

test('11. Adaptability does not enhance an old original type after off-type Tera', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:normal'], tera('type:water'), 'type:normal', true)), { multiplier: 1.5, basis: 'original-type', adaptabilityApplied: false })
})

test('12. Adaptability enhances a new Tera type to 2x', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:normal'], tera('type:water'), 'type:water', true)), { multiplier: 2, basis: 'tera-type', adaptabilityApplied: true })
})

test('13. same-type Tera plus Adaptability resolves to exact 2.25x', () => {
  assert.deepEqual(stabSummary(resolveStab(['type:normal'], tera('type:normal'), 'type:normal', true)), { multiplier: 2.25, basis: 'same-type-tera', adaptabilityApplied: true })
})

test('Adaptability integration selects 1.5x, 2x, and 2.25x in the canonical Tera branches', async () => {
  const adaptability = await ability('ability:0091')
  const oldOriginal = await core({ moveTypeId: 'type:normal', attackerTypeIds: ['type:normal'], attackerTerastallization: tera('type:water'), attackerAbility: adaptability })
  const newTera = await core({ moveTypeId: 'type:water', attackerTypeIds: ['type:normal'], attackerTerastallization: tera('type:water'), attackerAbility: adaptability })
  const sameType = await core({ moveTypeId: 'type:normal', attackerTypeIds: ['type:normal'], attackerTerastallization: tera('type:normal'), attackerAbility: adaptability })
  assert.deepEqual([oldOriginal.stabMultiplier, newTera.stabMultiplier, sameType.stabMultiplier], [1.5, 2, 2.25])
  assert.deepEqual([oldOriginal.appliedAbilityEffects.length, newTera.appliedAbilityEffects.length, sameType.appliedAbilityEffects.length], [0, 1, 1])
})

test('14. a Flying Pokémon Tera non-Flying becomes grounded', async () => {
  const result = await core({ attackerTypeIds: ['type:fire', 'type:flying'], attackerTerastallization: tera('type:electric') })
  assert.equal(result.attackerGrounded, true)
  assert.deepEqual(result.effectiveAttackerTypeIds, ['type:electric'])
})

test('15. selected Levitate remains ungrounded after Tera', async () => {
  const result = await core({ attackerTypeIds: ['type:electric', 'type:ghost'], attackerTerastallization: tera('type:electric'), attackerAbility: await ability('ability:0026') })
  assert.equal(result.attackerGrounded, false)
})

test('16. grounding change enables the existing Electric Terrain boost', async () => {
  const result = await core({ moveTypeId: 'type:electric', attackerTypeIds: ['type:electric', 'type:flying'], attackerTerastallization: tera('type:electric'), battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.attackerGrounded, true)
  assert.equal(result.effectiveBasePower, 130)
  assert.equal(result.appliedTerrainEffects.length, 1)
})

test('17. Tera grounding enables Misty Terrain Dragon reduction', async () => {
  const result = await core({ moveTypeId: 'type:dragon', defenderTypeIds: ['type:dragon', 'type:flying'], defenderTerastallization: tera('type:dragon'), battleContext: context({ terrain: 'misty' }) })
  assert.equal(result.defenderGrounded, true)
  assert.equal(result.effectiveBasePower, 50)
  assert.equal(result.appliedTerrainEffects.length, 1)
})

test('18. non-Rock Tera Rock gains the Sandstorm Special Defense boost', async () => {
  assert.equal((await core({ defenderTerastallization: tera('type:rock'), battleContext: context({ weather: 'sandstorm' }) })).effectiveDefense, 150)
})

test('19. original Rock Tera non-Rock loses the Sandstorm boost', async () => {
  assert.equal((await core({ defenderTypeIds: ['type:rock'], defenderTerastallization: tera('type:grass'), battleContext: context({ weather: 'sandstorm' }) })).effectiveDefense, 100)
})

test('20. non-Ice Tera Ice gains the Snow Defense boost', async () => {
  assert.equal((await core({ moveCategory: 'physical', defenderTerastallization: tera('type:ice'), battleContext: context({ weather: 'snow' }) })).effectiveDefense, 150)
})

test('21. original Ice Tera non-Ice loses the Snow boost', async () => {
  assert.equal((await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], defenderTerastallization: tera('type:water'), battleContext: context({ weather: 'snow' }) })).effectiveDefense, 100)
})

test('22. Tera composes with Sun without changing weather ordering', async () => {
  const result = await core({ attackerTypeIds: ['type:fire'], attackerTerastallization: tera('type:fire'), battleContext: context({ weather: 'sun' }) })
  assert.equal(result.stabMultiplier, 2)
  assert.equal(result.appliedBattleContextModifiers.some(effect => effect.kind === 'weather'), true)
})

test('23. Tera composes with Terrain at the BasePower stage', async () => {
  const result = await core({ moveTypeId: 'type:grass', attackerTerastallization: tera('type:grass'), battleContext: context({ terrain: 'grassy' }) })
  assert.equal(result.stabMultiplier, 1.5)
  assert.equal(result.effectiveBasePower, 130)
})

test('24. Tera composes with Life Orb final damage', async () => {
  const result = await core({ attackerTerastallization: tera('type:fire'), attackerItem: await item('Life Orb') })
  assert.equal(result.stabMultiplier, 1.5)
  assert.equal(result.appliedItemEffects.some(effect => effect.effect.kind === 'final-damage-multiplier'), true)
})

test('25. Filter-class reduction uses post-Tera effectiveness', async () => {
  const result = await core({ defenderTypeIds: ['type:water'], defenderTerastallization: tera('type:grass'), defenderAbility: await ability('ability:0111') })
  assert.equal(result.typeMultiplier, 2)
  assert.equal(result.abilityAdjustedTypeMultiplier, 1.5)
})

test('Thick Fat, Filter, Solid Rock, and Prism Armor compose with post-Tera typing', async () => {
  const thickFat = await core({ defenderTerastallization: tera('type:grass'), defenderAbility: await ability('ability:0047') })
  assert.equal(thickFat.typeMultiplier, 2)
  assert.equal(thickFat.effectiveAttack, 50)
  for (const abilityId of ['ability:0111', 'ability:0116', 'ability:0232']) {
    const result = await core({ defenderTerastallization: tera('type:grass'), defenderAbility: await ability(abilityId) })
    assert.equal(result.typeMultiplier, 2)
    assert.equal(result.abilityAdjustedTypeMultiplier, 1.5)
  }
})

test('26. Tera composes with critical hits', async () => {
  const result = await core({ attackerTypeIds: ['type:fire'], attackerTerastallization: tera('type:fire'), battleContext: context({ criticalHit: true }) })
  assert.equal(result.stabMultiplier, 2)
  assert.equal(result.appliedBattleContextModifiers.some(effect => effect.kind === 'critical-hit'), true)
})

test('27. Tera composes with matching screens', async () => {
  const result = await core({ attackerTerastallization: tera('type:fire'), battleContext: context({ lightScreen: true }) })
  assert.equal(result.appliedBattleContextModifiers.some(effect => effect.kind === 'screen'), true)
})

test('28. Tera composes with physical burn', async () => {
  const result = await core({ moveCategory: 'physical', attackerTerastallization: tera('type:fire'), battleContext: context({ attackerBurned: true }) })
  assert.equal(result.appliedBattleContextModifiers.some(effect => effect.kind === 'burn'), true)
})

test('29. Tera-sensitive Moves remain explicitly unsupported', async () => {
  const runtime = await runtimePromise
  const support = (moveId: string) => runtime.moves.find(move => move.moveId === moveId)?.damageSupport
  assert.deepEqual(support('move:0851'), { status: 'unsupported', reason: 'variable-base-power' })
  assert.deepEqual(support('move:0906'), { status: 'unsupported', reason: 'dynamic-move-type' })
  assert.deepEqual(support('move:0686'), { status: 'unsupported', reason: 'dynamic-move-type' })
})

test('30. Stellar and malformed inactive states are rejected', () => {
  assert.throws(() => validateTerastallizationState({ kind: 'ordinary', typeId: 'type:stellar' as StandardTeraTypeId }), /TERASTALLIZATION_INVALID_STATE/)
  assert.throws(() => validateTerastallizationState({ kind: 'stellar', typeId: 'type:fire' } as unknown as TerastallizationState), /TERASTALLIZATION_INVALID_STATE/)
})

test('ordinary Tera raises eligible matching fixed BasePower below 60 to 60', async () => {
  const runtime = await runtimePromise
  const move = runtime.moves.find(candidate => candidate.moveId === 'move:0001')!
  const result = calculateMoveDamage({ level: 50, move, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: runtime.types, attackerTerastallization: tera('type:normal') })
  assert.equal(result.status, 'supported')
  if (result.status === 'supported') {
    assert.equal(result.effectiveBasePower, 60)
    assert.equal(result.teraBasePowerFloorApplied, true)
  }
})

test('Tera BasePower floor runs after Terrain BasePower modifiers', async () => {
  const boostedAboveFloor = await core({ basePower: 50, movePriority: 0, moveTypeId: 'type:electric', attackerTerastallization: tera('type:electric'), battleContext: context({ terrain: 'electric' }) })
  assert.equal(boostedAboveFloor.effectiveBasePower, 65)
  assert.equal(boostedAboveFloor.teraBasePowerFloorApplied, false)

  const mistyThenFloor = await core({ basePower: 50, movePriority: 0, moveTypeId: 'type:dragon', attackerTerastallization: tera('type:dragon'), battleContext: context({ terrain: 'misty' }) })
  assert.equal(mistyThenFloor.effectiveBasePower, 60)
  assert.equal(mistyThenFloor.teraBasePowerFloorApplied, true)
})

test('Tera results preserve roll invariants and never mutate original Form types', async () => {
  const originalTypes = ['type:fire', 'type:flying']
  const snapshot = [...originalTypes]
  const result = await core({ attackerTypeIds: originalTypes, defenderTypeIds: ['type:water', 'type:ground'], attackerTerastallization: tera('type:fire'), defenderTerastallization: tera('type:ground'), moveTypeId: 'type:electric' })
  assert.equal(result.rolls.length, 16)
  assert.equal(result.rolls.every(Number.isInteger), true)
  assert.equal(result.rolls.every((value, index) => index === 0 || value >= result.rolls[index - 1]), true)
  assert.deepEqual(result.rolls, Array(16).fill(0))
  assert.deepEqual(originalTypes, snapshot)
  assert.deepEqual(effectiveTypeIds(originalTypes, tera('type:fire')), ['type:fire'])
})
