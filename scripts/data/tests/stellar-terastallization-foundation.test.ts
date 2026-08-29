import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage, calculateMoveDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import { effectiveTypeIds, resolveStab, validateTerastallizationState, type StellarBoostUsageState, type TerastallizationState } from '../../../src/lib/runtime-data/terastallization.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeStatBlock } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)
const stats: RuntimeStatBlock = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }
const stellar: TerastallizationState = { kind: 'stellar' }

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return { weather: 'none', terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false, attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 }, ...overrides }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 100, moveCategory: 'special',
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

async function stellarCore(usage: StellarBoostUsageState, overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  return core({ attackerTerastallization: stellar, stellarBoostUsage: usage, ...overrides })
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

test('1. mono-type Stellar retains its original defensive type', async () => {
  const result = await core({ moveTypeId: 'type:water', defenderTypeIds: ['type:fire'], defenderTerastallization: stellar })
  assert.deepEqual(result.effectiveDefenderTypeIds, ['type:fire'])
  assert.equal(result.typeMultiplier, 2)
})

test('2. dual-type Stellar retains both original defensive types', async () => {
  const result = await core({ moveTypeId: 'type:rock', defenderTypeIds: ['type:fire', 'type:flying'], defenderTerastallization: stellar })
  assert.deepEqual(result.effectiveDefenderTypeIds, ['type:fire', 'type:flying'])
  assert.equal(result.typeMultiplier, 4)
})

test('3. Stellar preserves the Water/Ground Electric immunity', async () => {
  const result = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'], defenderTerastallization: stellar })
  assert.equal(result.typeMultiplier, 0)
  assert.deepEqual(result.rolls, Array(16).fill(0))
})

test('4. original Flying remains ungrounded under Stellar', async () => {
  const result = await stellarCore('available', { attackerTypeIds: ['type:electric', 'type:flying'], moveTypeId: 'type:electric', battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.attackerGrounded, false)
  assert.equal(result.appliedTerrainEffects.length, 0)
})

test('5. selected Levitate remains an independent ungrounded state under Stellar', async () => {
  const result = await stellarCore('available', { attackerAbility: await ability('ability:0026'), moveTypeId: 'type:electric', battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.attackerGrounded, false)
})

test('6. original-type Stellar Move is 2x while its per-type boost is available', () => {
  const result = resolveStab(['type:fire'], stellar, 'type:fire', false, 'available')
  assert.deepEqual([result.multiplier, result.basis], [2, 'stellar-original-available'])
})

test('7. non-original Stellar Move uses exact 4915/4096 while available', () => {
  const result = resolveStab(['type:normal'], stellar, 'type:fire', false, 'available')
  assert.equal(result.status, 'resolved')
  if (result.status === 'resolved') assert.deepEqual([result.multiplier, result.numerator, result.denominator], [1.2, 4915, 4096])
})

test('8. consumed Stellar boost restores ordinary original STAB and no off-type boost', () => {
  assert.equal(resolveStab(['type:fire'], stellar, 'type:fire', false, 'consumed').multiplier, 1.5)
  assert.equal(resolveStab(['type:normal'], stellar, 'type:fire', false, 'consumed').multiplier, 1)
})

test('9. no-Tera baseline remains unchanged', () => {
  assert.equal(resolveStab(['type:fire'], { kind: 'none' }, 'type:fire', false).multiplier, 1.5)
})

test('10. ordinary same-type Tera baseline remains unchanged', () => {
  assert.equal(resolveStab(['type:fire'], { kind: 'ordinary', typeId: 'type:fire' }, 'type:fire', false).multiplier, 2)
})

test('11. Adaptability is skipped for a Stellar original-type Move', () => {
  const result = resolveStab(['type:normal'], stellar, 'type:normal', true, 'available')
  assert.deepEqual([result.multiplier, result.adaptabilityApplied], [2, false])
})

test('12. Adaptability is skipped for a Stellar non-original Move', () => {
  const result = resolveStab(['type:normal'], stellar, 'type:water', true, 'available')
  assert.deepEqual([result.multiplier, result.adaptabilityApplied], [1.2, false])
})

test('13. Adaptability remains skipped after the Stellar boost is consumed', () => {
  assert.equal(resolveStab(['type:normal'], stellar, 'type:normal', true, 'consumed').multiplier, 1.5)
})

test('14. original Rock retains the Sandstorm Special Defense boost under Stellar', async () => {
  assert.equal((await core({ defenderTypeIds: ['type:rock'], defenderTerastallization: stellar, battleContext: context({ weather: 'sandstorm' }) })).effectiveDefense, 150)
})

test('15. original Ice retains the Snow Defense boost under Stellar', async () => {
  assert.equal((await core({ moveCategory: 'physical', defenderTypeIds: ['type:ice'], defenderTerastallization: stellar, battleContext: context({ weather: 'snow' }) })).effectiveDefense, 150)
})

test('16. Stellar Flying does not gain Electric Terrain power', async () => {
  const result = await stellarCore('available', { attackerTypeIds: ['type:electric', 'type:flying'], moveTypeId: 'type:electric', battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.effectiveBasePower, 100)
})

test('17. Misty Terrain still depends on retained Stellar grounded state', async () => {
  const flying = await core({ moveTypeId: 'type:dragon', defenderTypeIds: ['type:dragon', 'type:flying'], defenderTerastallization: stellar, battleContext: context({ terrain: 'misty' }) })
  const grounded = await core({ moveTypeId: 'type:dragon', defenderTypeIds: ['type:dragon'], defenderTerastallization: stellar, battleContext: context({ terrain: 'misty' }) })
  assert.deepEqual([flying.effectiveBasePower, grounded.effectiveBasePower], [100, 50])
})

async function stellarMoveResult(moveId: string) {
  const runtime = await runtimePromise
  return calculateMoveDamage({ level: 50, move: runtime.moves.find(move => move.moveId === moveId)!, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'], types: runtime.types, attackerTerastallization: stellar, stellarBoostUsage: 'available' })
}

test('18. Stellar Tera Blast returns its exact explicit unsupported policy', async () => {
  assert.deepEqual(await stellarMoveResult('move:0851'), { status: 'unsupported-context', reason: 'stellar-tera-blast' })
})

test('19. Tera Starstorm returns its Terapagos-specific unsupported policy', async () => {
  assert.deepEqual(await stellarMoveResult('move:0906'), { status: 'unsupported-context', reason: 'stellar-tera-starstorm' })
})

test('20. Revelation Dance remains context-sensitive and unsupported', async () => {
  assert.deepEqual(await stellarMoveResult('move:0686'), { status: 'unsupported-context', reason: 'stellar-revelation-dance' })
})

test('21. Stellar composes with Life Orb', async () => {
  const result = await stellarCore('available', { attackerItem: await item('Life Orb') })
  assert.equal(result.appliedItemEffects.some(effect => effect.effect.kind === 'final-damage-multiplier'), true)
})

test('22. Stellar composes with Expert Belt on retained defensive typing', async () => {
  const result = await stellarCore('available', { defenderTypeIds: ['type:grass'], attackerItem: await item('Expert Belt') })
  assert.equal(result.appliedItemEffects.some(effect => effect.effect.kind === 'super-effective-damage-multiplier'), true)
})

test('23. Stellar composes with Filter-class Abilities', async () => {
  const result = await stellarCore('available', { defenderTypeIds: ['type:grass'], defenderAbility: await ability('ability:0111') })
  assert.equal(result.abilityAdjustedTypeMultiplier, 1.5)
})

test('24. Stellar composes with critical hits', async () => {
  assert.equal((await stellarCore('available', { battleContext: context({ criticalHit: true }) })).appliedBattleContextModifiers.some(effect => effect.kind === 'critical-hit'), true)
})

test('25. Stellar composes with screens', async () => {
  assert.equal((await stellarCore('available', { battleContext: context({ lightScreen: true }) })).appliedBattleContextModifiers.some(effect => effect.kind === 'screen'), true)
})

test('26. Stellar composes with burn', async () => {
  assert.equal((await stellarCore('available', { moveCategory: 'physical', battleContext: context({ attackerBurned: true }) })).appliedBattleContextModifiers.some(effect => effect.kind === 'burn'), true)
})

test('27. Stellar composes with Sun and Rain by Move type', async () => {
  const sun = await stellarCore('available', { battleContext: context({ weather: 'sun' }) })
  const rain = await stellarCore('available', { moveTypeId: 'type:water', battleContext: context({ weather: 'rain' }) })
  assert.equal(sun.appliedBattleContextModifiers.some(effect => effect.kind === 'weather'), true)
  assert.equal(rain.appliedBattleContextModifiers.some(effect => effect.kind === 'weather'), true)
})

test('28. grounded Stellar composes with Terrain', async () => {
  const result = await stellarCore('available', { attackerTypeIds: ['type:electric'], moveTypeId: 'type:electric', battleContext: context({ terrain: 'electric' }) })
  assert.equal(result.effectiveBasePower, 130)
})

test('29. Stellar needs no ordinary Type ID', () => {
  assert.doesNotThrow(() => validateTerastallizationState({ kind: 'stellar' }))
})

test('30. invalid mixed ordinary and Stellar states are rejected', () => {
  assert.throws(() => validateTerastallizationState({ kind: 'stellar', typeId: 'type:fire' } as never), /TERASTALLIZATION_INVALID_STATE/)
  assert.throws(() => validateTerastallizationState({ kind: 'ordinary' } as never), /TERASTALLIZATION_INVALID_STATE/)
})

test('unknown Stellar usage state is unresolved and Move calculation requires a user choice', async () => {
  assert.equal(resolveStab(['type:normal'], stellar, 'type:fire', false).stellarBoostStateRequired, true)
  const runtime = await runtimePromise
  const move = runtime.moves.find(candidate => candidate.moveId === 'move:0053')!
  assert.deepEqual(calculateMoveDamage({ level: 50, move, attackerStats: stats, defenderStats: stats, attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:normal'], types: runtime.types, attackerTerastallization: stellar }), { status: 'unresolved-context', reason: 'stellar-boost-usage-required' })
})

test('Stellar composes with Thick Fat, Choice Specs, and type-enhancing Items', async () => {
  const thickFat = await stellarCore('available', { defenderAbility: await ability('ability:0047') })
  const specs = await stellarCore('available', { attackerItem: await item('Choice Specs') })
  const charcoal = await stellarCore('available', { attackerItem: await item('Charcoal') })
  assert.equal(thickFat.effectiveAttack, 50)
  assert.equal(specs.effectiveAttack, 150)
  assert.equal(charcoal.effectiveBasePower, 120)
})

test('all 950 runtime Moves retain audited support metadata and sensitive Moves cannot be silently supported', async () => {
  const runtime = await runtimePromise
  assert.equal(runtime.moves.length, 950)
  for (const moveId of ['move:0851', 'move:0906', 'move:0686']) {
    assert.notEqual(runtime.moves.find(move => move.moveId === moveId)?.damageSupport.status, 'supported')
  }
})

test('Stellar rolls and modifier trace are integer, ordered, immutable, and deterministic', async () => {
  const originalTypes = ['type:normal']
  const first = await stellarCore('available', { attackerTypeIds: originalTypes })
  const second = await stellarCore('available', { attackerTypeIds: originalTypes })
  assert.equal(first.rolls.length, 16)
  assert.equal(first.rolls.every(Number.isInteger), true)
  assert.equal(first.rolls.every((value, index) => index === 0 || value >= first.rolls[index - 1]), true)
  assert.deepEqual(first.modifierTrace, second.modifierTrace)
  assert.equal(first.modifierTrace.some(entry => entry.category === 'stellar-usage' && entry.source === 'available'), true)
  assert.deepEqual(originalTypes, ['type:normal'])
  assert.deepEqual(effectiveTypeIds(originalTypes, stellar), ['type:normal'])
})
