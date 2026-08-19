import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import type { SmokeDataset } from '../../../src/lib/data-model/smoke-schema.ts'
import { buildSmokeArtifacts, makeNationalSpeciesId, type BuildArtifacts } from '../pipeline.ts'
import { validateSmokeDataset } from '../validation.ts'

let artifacts: BuildArtifacts

before(async () => {
  artifacts = await buildSmokeArtifacts()
})

function clonedDataset(): SmokeDataset {
  return structuredClone(artifacts.dataset)
}

function validate(dataset: SmokeDataset): void {
  validateSmokeDataset(
    dataset,
    artifacts.source.sourceReferences,
    artifacts.identityMatches,
    artifacts.valueProvenance,
  )
}

describe('fixed Showdown smoke fixtures', () => {
  test('source SHA and canonical counts are verified', () => {
    assert.equal(artifacts.source.commit, '84d7ceb4f009928221fce7a00e711bab263c5f4e')
    assert.deepEqual({
      types: artifacts.dataset.types.length,
      natures: artifacts.dataset.natures.length,
      species: artifacts.dataset.species.length,
      forms: artifacts.dataset.forms.length,
      abilities: artifacts.dataset.abilities.length,
    }, { types: 18, natures: 25, species: 3, forms: 12, abilities: 9 })
  })

  test('Charizard keeps base, both Mega Forms, and G-Max distinct', () => {
    const forms = artifacts.dataset.forms.filter(form => form.speciesId === 'species:0006')
    assert.deepEqual(forms.map(form => form.formId), [
      'form:0006:base', 'form:0006:gmax', 'form:0006:mega-x', 'form:0006:mega-y',
    ])
    assert.deepEqual(forms.find(form => form.formId.endsWith('mega-x'))?.requiredItemNames, ['Charizardite X'])
    assert.deepEqual(forms.find(form => form.formId.endsWith('mega-y'))?.requiredItemNames, ['Charizardite Y'])
    assert.deepEqual(
      forms.find(form => form.formId.endsWith('gmax'))?.baseStats,
      forms.find(form => form.formId.endsWith('base'))?.baseStats,
    )
  })

  test('Rotom keeps five appliances with distinct secondary Types', () => {
    const appliances = artifacts.dataset.forms.filter(form => form.speciesId === 'species:0479' && form.formKind !== 'base')
    assert.equal(appliances.length, 5)
    assert.deepEqual(new Set(appliances.map(form => form.types[1])), new Set([
      'type:fire', 'type:water', 'type:ice', 'type:flying', 'type:grass',
    ]))
    assert.ok(appliances.every(form => form.changesFromFormIds[0] === 'form:0479:base'))
  })

  test('Meowstic gender Forms retain different hidden Ability slots', () => {
    const forms = artifacts.dataset.forms.filter(form => form.speciesId === 'species:0678')
    assert.equal(forms.length, 2)
    assert.deepEqual(forms[0].baseStats, forms[1].baseStats)
    assert.notEqual(
      forms[0].abilities.find(slot => slot.slot === 'H')?.abilityId,
      forms[1].abilities.find(slot => slot.slot === 'H')?.abilityId,
    )
  })

  test('all 25 Nature modifier rules are valid', () => {
    const neutral = artifacts.dataset.natures.filter(nature => nature.neutral)
    assert.equal(artifacts.dataset.natures.length, 25)
    assert.equal(neutral.length, 5)
    assert.ok(neutral.every(nature => nature.plusStat === null && nature.minusStat === null))
    assert.ok(artifacts.dataset.natures.filter(nature => !nature.neutral)
      .every(nature => nature.plusStat !== null && nature.minusStat !== null && nature.plusStat !== nature.minusStat))
  })

  test('complete smoke provenance validates', () => {
    assert.doesNotThrow(() => validate(artifacts.dataset))
  })
})

describe('required failure fixtures', () => {
  test('duplicate stable ID fails', () => {
    const dataset = clonedDataset()
    dataset.abilities.push(structuredClone(dataset.abilities[0]))
    assert.throws(() => validate(dataset), /DUPLICATE_ID/)
  })

  test('orphan Ability reference fails', () => {
    const dataset = clonedDataset()
    const referenced = dataset.forms[0].abilities[0].abilityId
    dataset.abilities = dataset.abilities.filter(ability => ability.abilityId !== referenced)
    assert.throws(() => validate(dataset), /ORPHAN_ABILITY_REFERENCE/)
  })

  test('non-unique Form mapping fails', () => {
    const dataset = clonedDataset()
    const duplicate = structuredClone(dataset.forms.find(form => form.formId === 'form:0006:mega-x')!)
    duplicate.formId = 'form:0006:duplicate'
    dataset.forms.push(duplicate)
    assert.throws(() => validate(dataset), /NON_UNIQUE_FORM_MAPPING/)
  })

  test('negative CAP number cannot receive a national Species ID', () => {
    assert.throws(() => makeNationalSpeciesId(-2), /NON_NATIONAL_SPECIES/)
  })
})
