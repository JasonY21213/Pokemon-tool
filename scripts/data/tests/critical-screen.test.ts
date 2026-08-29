import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCriticalHitStage, type BattleContext, type BattleStatStage } from '../../../src/lib/runtime-data/battle-context.ts'
import { calculateCoreDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { RuntimeAbility, RuntimeItem } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

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
    level: 50, attack: 100, defense: 100, basePower: 50, moveCategory: 'physical',
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
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

const CRITICAL_ROLLS = [30, 30, 31, 31, 32, 32, 32, 33, 33, 33, 34, 34, 34, 35, 35, 36]

test('critical stage utility ignores only negative offense and positive defense', () => {
  const stages: BattleStatStage[] = [-2, 2]
  assert.deepEqual(stages.map(stage => resolveCriticalHitStage(stage, 'attacker', true)), [0, 2])
  assert.deepEqual(stages.map(stage => resolveCriticalHitStage(stage, 'defender', true)), [-2, 0])
  assert.equal(resolveCriticalHitStage(-2, 'attacker', false), -2)
})

test('ordinary physical and special critical hits use the exact pre-random 3/2 integer multiplier', async () => {
  const physical = await core({ battleContext: context({ criticalHit: true }) })
  const special = await core({ moveCategory: 'special', battleContext: context({ criticalHit: true }) })
  assert.deepEqual(physical.rolls, CRITICAL_ROLLS)
  assert.deepEqual(special.rolls, CRITICAL_ROLLS)
  assert.deepEqual(physical.appliedBattleContextModifiers, [{ kind: 'critical-hit', multiplier: 1.5 }])
})

test('critical hits ignore disadvantageous stages and preserve advantageous stages', async () => {
  const negativeAttack = await core({ battleContext: context({ criticalHit: true, attackerStatStages: { atk: -2, spa: 0 } }) })
  const positiveDefense = await core({ battleContext: context({ criticalHit: true, defenderStatStages: { def: 2, spd: 0 } }) })
  assert.deepEqual(negativeAttack.rolls, CRITICAL_ROLLS)
  assert.deepEqual(positiveDefense.rolls, CRITICAL_ROLLS)
  assert.deepEqual([negativeAttack.effectiveAttack, positiveDefense.effectiveDefense], [100, 100])
  assert.equal(negativeAttack.appliedBattleContextModifiers[0].kind, 'stat-stage')
  if (negativeAttack.appliedBattleContextModifiers[0].kind === 'stat-stage') assert.equal(negativeAttack.appliedBattleContextModifiers[0].effectiveStage, 0)

  const positiveAttack = await core({ battleContext: context({ criticalHit: true, attackerStatStages: { atk: 2, spa: 0 } }) })
  const negativeDefense = await core({ battleContext: context({ criticalHit: true, defenderStatStages: { def: -2, spd: 0 } }) })
  const boostedRolls = [58, 59, 60, 60, 61, 62, 62, 63, 64, 64, 65, 66, 66, 67, 68, 69]
  assert.deepEqual(positiveAttack.rolls, boostedRolls)
  assert.deepEqual(negativeDefense.rolls, boostedRolls)
  assert.deepEqual([positiveAttack.effectiveAttack, negativeDefense.effectiveDefense], [200, 50])
})

test('burn still halves physical critical damage and never affects special critical damage', async () => {
  const burnedPhysical = await core({ battleContext: context({ criticalHit: true, attackerBurned: true }) })
  const burnedSpecial = await core({ moveCategory: 'special', battleContext: context({ criticalHit: true, attackerBurned: true }) })
  assert.deepEqual(burnedPhysical.rolls, [15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 18])
  assert.deepEqual(burnedSpecial.rolls, CRITICAL_ROLLS)
})

test('Reflect and Light Screen halve only their matching category in singles', async () => {
  const reflectPhysical = await core({ battleContext: context({ reflect: true }) })
  const reflectSpecial = await core({ moveCategory: 'special', battleContext: context({ reflect: true }) })
  const screenSpecial = await core({ moveCategory: 'special', battleContext: context({ lightScreen: true }) })
  const screenPhysical = await core({ battleContext: context({ lightScreen: true }) })
  const halved = [10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12]
  assert.deepEqual(reflectPhysical.rolls, halved)
  assert.deepEqual(screenSpecial.rolls, halved)
  assert.deepEqual(reflectSpecial.rolls, (await core({ moveCategory: 'special' })).rolls)
  assert.deepEqual(screenPhysical.rolls, (await core()).rolls)
})

test('critical hits bypass matching screens and report the bypass explicitly', async () => {
  const physical = await core({ battleContext: context({ criticalHit: true, reflect: true }) })
  const special = await core({ moveCategory: 'special', battleContext: context({ criticalHit: true, lightScreen: true }) })
  assert.deepEqual(physical.rolls, CRITICAL_ROLLS)
  assert.deepEqual(special.rolls, CRITICAL_ROLLS)
  assert.deepEqual(physical.appliedBattleContextModifiers.at(-1), { kind: 'screen-bypassed', screen: 'reflect', reason: 'critical-hit' })
  assert.deepEqual(special.appliedBattleContextModifiers.at(-1), { kind: 'screen-bypassed', screen: 'light-screen', reason: 'critical-hit' })
})

test('critical composes with STAB, effectiveness, weather, and Life Orb at pinned stages', async () => {
  const stab = await core({ attackerTypeIds: ['type:fire'], battleContext: context({ criticalHit: true }) })
  const effective = await core({ defenderTypeIds: ['type:grass'], battleContext: context({ criticalHit: true }) })
  const weather = await core({ battleContext: context({ criticalHit: true, weather: 'sun' }) })
  const lifeOrb = await core({ attackerItem: await item('item:0270'), battleContext: context({ criticalHit: true }) })
  assert.deepEqual(stab.rolls, [45, 45, 46, 46, 48, 48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54])
  assert.deepEqual(effective.rolls, CRITICAL_ROLLS.map(value => value * 2))
  assert.deepEqual(weather.rolls, [45, 46, 46, 47, 48, 48, 49, 49, 50, 50, 51, 51, 52, 52, 53, 54])
  assert.deepEqual(lifeOrb.rolls, [39, 39, 40, 40, 42, 42, 42, 43, 43, 43, 44, 44, 44, 45, 45, 47])
})

test('screens compose with final Ability and held-item modifiers as one fixed-point chain', async () => {
  const filter = await core({ defenderTypeIds: ['type:grass'], defenderAbility: await ability('ability:0111'), battleContext: context({ reflect: true }) })
  const lifeOrb = await core({ attackerItem: await item('item:0270'), battleContext: context({ reflect: true }) })
  assert.deepEqual(filter.rolls, [15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18])
  assert.deepEqual(lifeOrb.rolls, [13, 13, 13, 14, 14, 14, 14, 14, 14, 14, 14, 15, 15, 15, 15, 16])
})

test('critical and screen invariants retain integer ordering, immunity zero, and minimum one', async () => {
  const composed = await core({ attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:grass'], battleContext: context({ criticalHit: true, reflect: true }) })
  assert.equal(composed.rolls.length, 16)
  assert.equal(composed.rolls.every(Number.isInteger), true)
  assert.equal(composed.rolls.every((value, index) => index === 0 || value >= composed.rolls[index - 1]), true)
  const immune = await core({ moveTypeId: 'type:electric', defenderTypeIds: ['type:water', 'type:ground'], battleContext: context({ criticalHit: true }) })
  assert.deepEqual(immune.rolls, Array(16).fill(0))
  const minimum = await core({ attack: 1, defense: 9999, basePower: 1, battleContext: context({ reflect: true }) })
  assert.deepEqual(minimum.rolls, Array(16).fill(1))
})

test('forced-critical and screen-removing Moves remain explicitly unsupported', async () => {
  const runtime = await runtimePromise
  const support = (name: string) => runtime.moves.find(move => move.canonicalName === name)?.damageSupport
  assert.deepEqual(support('Storm Throw'), { status: 'unsupported', reason: 'forced-critical-hit' })
  assert.deepEqual(support('Flower Trick'), { status: 'unsupported', reason: 'forced-critical-hit' })
  assert.deepEqual(support('Brick Break'), { status: 'unsupported', reason: 'conditional-hit-mechanics' })
  assert.deepEqual(support('Psychic Fangs'), { status: 'unsupported', reason: 'conditional-hit-mechanics' })
})
