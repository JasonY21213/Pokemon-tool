import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjustDefensiveMatchup, normalizeAbilityForForm, selectAbilityForForm } from '../../../src/lib/runtime-data/ability-mechanics.ts'
import { calculateCoreDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import { calculateDefensiveMatchup } from '../../../src/lib/runtime-data/type-matchup.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const artifactsPromise = buildFullDryRun()
const runtimePromise = artifactsPromise.then(buildRuntimeData)

async function ability(abilityId: string) {
  const result = (await runtimePromise).abilities.find(candidate => candidate.abilityId === abilityId)
  assert.ok(result, `missing ${abilityId}`)
  return result
}

async function core(overrides: Partial<Parameters<typeof calculateCoreDamage>[0]> = {}) {
  const runtime = await runtimePromise
  return calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50,
    moveTypeId: 'type:fire', attackerTypeIds: ['type:normal'], defenderTypeIds: ['type:normal'],
    types: runtime.types, ...overrides,
  })
}

test('Ability mechanics audit covers all 316 runtime Abilities with the six reviewed supported records', async () => {
  const artifacts = await artifactsPromise
  assert.deepEqual(artifacts.abilityMechanicsReport, {
    totalAbilities: 316,
    supportedMechanicsAbilities: 6,
    unsupportedAbilities: 310,
    supportedEffectCategories: {
      'incoming-type-immunity': 1,
      'incoming-type-attack-multiplier': 1,
      'super-effective-damage-multiplier': 3,
      'stab-multiplier': 1,
    },
    auditCategorySignals: {
      typeImmunity: 11,
      typeResistanceOrDamageModifier: 14,
      stabModifier: 1,
      offensiveTypeModifier: 17,
      statModifier: 78,
      weatherOrTerrain: 48,
      statusDependent: 68,
      switchTurnEvent: 101,
      moveOrContactSpecific: 92,
    },
    explicitExclusions: [
      { category: 'trigger-state-or-redirection', abilityNames: ['Flash Fire', 'Lightning Rod', 'Storm Drain'], reason: 'Requires triggered state, stat stages, or move redirection.' },
      { category: 'healing-weather-or-status', abilityNames: ['Dry Skin', 'Volt Absorb', 'Water Absorb', 'Heatproof'], reason: 'Relevant behavior includes healing, weather, or status damage outside this phase.' },
      { category: 'move-specific-or-contact', abilityNames: ['Soundproof', 'Bulletproof', 'Strong Jaw'], reason: 'Requires Move flags or contact-specific mechanics not present in the runtime Move model.' },
      { category: 'battle-state-systems', abilityNames: ['Drizzle', 'Electric Surge', 'Guts'], reason: 'Requires weather, terrain, status, or stat-stage state.' },
    ],
  })
  assert.equal(artifacts.abilityMechanics.length, 316)
  assert.deepEqual(artifacts.abilityMechanics.filter(record => record.mechanics.status === 'supported').map(record => record.abilityId), [
    'ability:0026', 'ability:0047', 'ability:0091', 'ability:0111', 'ability:0116', 'ability:0232',
  ])
})

test('Levitate adds a Ground immunity while raw typing remains unchanged', async () => {
  const runtime = await runtimePromise
  const rotom = runtime.forms.find(form => form.formId === 'form:0479:base')!
  const levitate = selectAbilityForForm(rotom, runtime.abilities, 'ability:0026')
  const raw = calculateDefensiveMatchup(runtime.types, rotom.types[0], rotom.types[1])
  const rawGround = raw.find(entry => entry.attackingTypeId === 'type:ground')!
  const adjustedGround = adjustDefensiveMatchup(raw, levitate).find(entry => entry.attackingTypeId === 'type:ground')!
  assert.equal(rawGround.multiplier, 2)
  assert.deepEqual(adjustedGround, {
    attackingTypeId: 'type:ground', rawMultiplier: 2, adjustedMultiplier: 0,
    appliedEffects: [{ abilityId: 'ability:0026', effect: { kind: 'incoming-type-immunity', typeId: 'type:ground' } }],
  })
  assert.equal(calculateDefensiveMatchup(runtime.types, rotom.types[0], rotom.types[1]).find(entry => entry.attackingTypeId === 'type:ground')?.multiplier, 2)
})

test('Thick Fat uses the pinned attack-stat modifier order for incoming Fire and Ice damage', async () => {
  const normal = await core()
  const reduced = await core({ defenderAbility: await ability('ability:0047') })
  assert.deepEqual([normal.minDamage, normal.maxDamage], [20, 24])
  assert.deepEqual([reduced.minDamage, reduced.maxDamage], [11, 13])
  assert.equal(reduced.abilityAdjustedTypeMultiplier, 0.5)
  assert.equal(reduced.appliedAbilityEffects[0].effect.kind, 'incoming-type-attack-multiplier')
})

test('Adaptability replaces ordinary STAB with 2x only for a matching move type', async () => {
  const adaptability = await ability('ability:0091')
  const matching = await core({ attackerTypeIds: ['type:fire'], attackerAbility: adaptability })
  const nonmatching = await core({ attackerTypeIds: ['type:water'], attackerAbility: adaptability })
  assert.equal(matching.stabMultiplier, 2)
  assert.deepEqual([matching.minDamage, matching.maxDamage], [40, 48])
  assert.equal(matching.appliedAbilityEffects[0].effect.kind, 'stab-multiplier')
  assert.equal(nonmatching.stabMultiplier, 1)
  assert.deepEqual(nonmatching.appliedAbilityEffects, [])
})

test('Filter class applies a 0.75 final modifier only to super-effective damage', async () => {
  const filter = await ability('ability:0111')
  const superEffective = await core({ defenderTypeIds: ['type:grass'], defenderAbility: filter })
  const neutral = await core({ defenderAbility: filter })
  assert.deepEqual([superEffective.minDamage, superEffective.maxDamage], [30, 36])
  assert.equal(superEffective.abilityAdjustedTypeMultiplier, 1.5)
  assert.deepEqual(neutral.appliedAbilityEffects, [])
  assert.deepEqual([neutral.minDamage, neutral.maxDamage], [20, 24])
})

test('unsupported selected Ability is reported but never changes core damage', async () => {
  const blaze = await ability('ability:0066')
  assert.equal(blaze.mechanics.status, 'unsupported')
  const baseline = await core()
  const selected = await core({ attackerAbility: blaze })
  assert.deepEqual(selected.rolls, baseline.rolls)
  assert.deepEqual(selected.unmodeledAbilityIds, ['ability:0066'])
  assert.deepEqual(selected.appliedAbilityEffects, [])
})

test('Ability selection must belong to the Form and incompatible Form changes clear it', async () => {
  const runtime = await runtimePromise
  const charizard = runtime.forms.find(form => form.formId === 'form:0006:base')!
  assert.throws(() => selectAbilityForForm(charizard, runtime.abilities, 'ability:0026'), /ABILITY_NOT_AVAILABLE_FOR_FORM/)
  const raichu = runtime.forms.find(form => form.formId === 'form:0026:base')!
  const alolanRaichu = runtime.forms.find(form => form.formId === 'form:0026:alola')!
  assert.equal(normalizeAbilityForForm(raichu, 'ability:0009'), 'ability:0009')
  assert.equal(normalizeAbilityForForm(alolanRaichu, 'ability:0009'), null)
})
