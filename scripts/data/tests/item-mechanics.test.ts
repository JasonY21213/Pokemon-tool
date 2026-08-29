import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCoreDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import type { BattleContext } from '../../../src/lib/runtime-data/battle-context.ts'
import type { RuntimeItem } from '../../../src/lib/runtime-data/types.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const artifactsPromise = buildFullDryRun()
const runtimePromise = artifactsPromise.then(buildRuntimeData)

async function item(itemId: string): Promise<RuntimeItem> {
  const result = (await runtimePromise).items.find(candidate => candidate.itemId === itemId)
  assert.ok(result, `missing ${itemId}`)
  return result
}

function context(overrides: Partial<BattleContext> = {}): BattleContext {
  return { weather: 'none', terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false, attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 }, ...overrides }
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveCategory: 'physical',
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

test('Item identity audit covers 567 stable numbered entities and six reviewed mechanics records', async () => {
  const artifacts = await artifactsPromise
  assert.deepEqual(artifacts.itemMechanicsReport, {
    sourceRecords: 583,
    registeredItems: 567,
    excludedNonPositiveNumberRecords: 3,
    excludedDuplicateNumberAliases: 13,
    supportedMechanicsItems: 6,
    unsupportedItems: 561,
    supportedEffectCategories: {
      'attack-stat-multiplier': 1, 'special-attack-stat-multiplier': 1, 'final-damage-multiplier': 1,
      'move-type-base-power-multiplier': 2, 'super-effective-damage-multiplier': 1,
    },
    availability: { current: 249, past: 273, future: 45 },
    explicitUnsupportedCategories: artifacts.itemMechanicsReport.explicitUnsupportedCategories,
  })
  assert.equal(new Set(artifacts.items.map(record => record.itemId)).size, 567)
  assert.equal(artifacts.items.every(record => record.itemId === `item:${record.officialNumber.toString().padStart(4, '0')}`), true)
  assert.equal(artifacts.items.every(record => /^src:pokemon-showdown:[a-f0-9]{16}$/.test(record.sourceEvidence.sourceReferenceId) && record.sourceEvidence.pointer === `/${record.showdownId}`), true)
})

test('Choice Band and Choice Specs modify only their matching attacking stat', async () => {
  const band = await item('item:0220')
  const specs = await item('item:0297')
  const physicalBand = await core({ attackerItem: band, moveCategory: 'physical' })
  const specialBand = await core({ attackerItem: band, moveCategory: 'special' })
  const specialSpecs = await core({ attackerItem: specs, moveCategory: 'special' })
  assert.deepEqual([physicalBand.effectiveAttack, physicalBand.minDamage, physicalBand.maxDamage], [150, 29, 35])
  assert.deepEqual([specialBand.effectiveAttack, specialBand.minDamage, specialBand.maxDamage], [100, 20, 24])
  assert.deepEqual([specialSpecs.effectiveAttack, specialSpecs.minDamage, specialSpecs.maxDamage], [150, 29, 35])
})

test('Life Orb applies its exact final modifier after STAB and weather', async () => {
  const lifeOrb = await item('item:0270')
  assert.deepEqual((await core({ attackerItem: lifeOrb })).rolls, [26, 26, 26, 27, 27, 27, 27, 29, 29, 29, 29, 30, 30, 30, 30, 31])
  const stab = await core({ attackerItem: lifeOrb, attackerTypeIds: ['type:fire'] })
  const sun = await core({ attackerItem: lifeOrb, battleContext: context({ weather: 'sun' }) })
  assert.deepEqual([stab.minDamage, stab.maxDamage], [39, 47])
  assert.deepEqual([sun.minDamage, sun.maxDamage], [39, 47])
})

test('Expert Belt applies only to super-effective damage', async () => {
  const belt = await item('item:0268')
  const effective = await core({ attackerItem: belt, defenderTypeIds: ['type:grass'] })
  const neutral = await core({ attackerItem: belt })
  assert.deepEqual([effective.minDamage, effective.maxDamage], [48, 58])
  assert.deepEqual(neutral.rolls, (await core()).rolls)
  assert.equal(neutral.appliedItemEffects.length, 0)
})

test('type-enhancing Items modify base power only for a matching Move type', async () => {
  const charcoal = await item('item:0249')
  const mysticWater = await item('item:0243')
  const fire = await core({ attackerItem: charcoal })
  const mismatch = await core({ attackerItem: mysticWater })
  const water = await core({ attackerItem: mysticWater, moveTypeId: 'type:water' })
  assert.deepEqual([fire.effectiveBasePower, fire.minDamage, fire.maxDamage], [60, 23, 28])
  assert.deepEqual(mismatch.rolls, (await core()).rolls)
  assert.deepEqual([water.effectiveBasePower, water.minDamage, water.maxDamage], [60, 23, 28])
})

test('Choice Band composes with stages and burn while preserving integer order', async () => {
  const band = await item('item:0220')
  const staged = await core({ attackerItem: band, battleContext: context({ attackerStatStages: { atk: 1, spa: 0 } }) })
  const burned = await core({ attackerItem: band, battleContext: context({ attackerBurned: true }) })
  assert.deepEqual([staged.effectiveAttack, staged.minDamage, staged.maxDamage], [225, 43, 51])
  assert.deepEqual([burned.minDamage, burned.maxDamage], [14, 17])
  assert.equal(staged.rolls.every(Number.isInteger), true)
  assert.equal(staged.rolls.every((value, index) => index === 0 || value >= staged.rolls[index - 1]), true)
})

test('supported Item and Ability modifiers compose in pinned stat/final fixed-point chains', async () => {
  const runtime = await runtimePromise
  const thickFat = runtime.abilities.find(ability => ability.abilityId === 'ability:0047')!
  const filter = runtime.abilities.find(ability => ability.abilityId === 'ability:0111')!
  const specs = await item('item:0297')
  const lifeOrb = await item('item:0270')
  const statOrder = await core({ attackerItem: specs, defenderAbility: thickFat, moveCategory: 'special' })
  const finalOrder = await core({ attackerItem: lifeOrb, defenderAbility: filter, defenderTypeIds: ['type:grass'] })
  assert.equal(statOrder.effectiveAttack, 75)
  assert.deepEqual([statOrder.minDamage, statOrder.maxDamage], [15, 18])
  assert.deepEqual([finalOrder.minDamage, finalOrder.maxDamage], [39, 47])
})

test('unsupported selected Item is reported and never silently changes damage', async () => {
  const leftovers = await item('item:0234')
  const result = await core({ attackerItem: leftovers })
  assert.deepEqual(result.rolls, (await core()).rolls)
  assert.deepEqual(result.unmodeledItemIds, ['item:0234'])
  assert.deepEqual(result.appliedItemEffects, [])
})
