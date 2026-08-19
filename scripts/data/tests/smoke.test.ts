import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import type { SmokeDataset } from '../../../src/lib/data-model/smoke-schema.ts'
import {
  mapAbilityLocalizations,
  mapSpeciesLocalizations,
  requireUniqueAutomaticFormCandidate,
} from '../localization.ts'
import { buildSmokeArtifacts, makeNationalSpeciesId, type BuildArtifacts } from '../pipeline.ts'
import { loadPokemonDatasetZhSource, type PokemonDatasetZhAdapterOutput } from '../pokemon-dataset-zh.ts'
import { validateSmokeDataset } from '../validation.ts'

let artifacts: BuildArtifacts
let localizationSource: PokemonDatasetZhAdapterOutput

before(async () => {
  artifacts = await buildSmokeArtifacts()
  localizationSource = await loadPokemonDatasetZhSource(artifacts.source)
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
    artifacts.localization,
  )
}

describe('fixed Showdown smoke fixtures', () => {
  test('source SHA and canonical counts are verified', () => {
    assert.equal(artifacts.source.commit, '84d7ceb4f009928221fce7a00e711bab263c5f4e')
    assert.equal(artifacts.source.localization.commit, '82ce04e611d19a12556c3955125b048b36187f52')
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

describe('pokemon-dataset-zh localization fixtures', () => {
  test('three required Species map by number and validated English name', () => {
    assert.deepEqual(
      artifacts.localization.core.entries
        .filter(entry => entry.entityId.startsWith('species:'))
        .map(entry => [entry.entityId, entry.name]),
      [
        ['species:0006', '喷火龙'],
        ['species:0479', '洛托姆'],
        ['species:0678', '超能妙喵'],
      ],
    )
  })

  test('wrong Species number is blocking', () => {
    const candidates = structuredClone(localizationSource.species)
    candidates[0].nationalDexNumber = 7
    assert.throws(() => mapSpeciesLocalizations(artifacts.dataset, candidates), /ZH_SPECIES_NUMBER_CONFLICT/)
  })

  test('wrong Species English name is blocking', () => {
    const candidates = structuredClone(localizationSource.species)
    candidates[0].englishName = 'Not Charizard'
    assert.throws(() => mapSpeciesLocalizations(artifacts.dataset, candidates), /ZH_SPECIES_ENGLISH_CONFLICT/)
  })

  test('all nine Abilities map by official number and English name', () => {
    const mappings = mapAbilityLocalizations(artifacts.dataset, localizationSource.abilities)
    assert.equal(mappings.length, 9)
    assert.deepEqual(mappings.map(mapping => mapping.entry.entityId), artifacts.dataset.abilities.map(ability => ability.abilityId))
  })

  test('duplicate Chinese Ability display names do not merge identities', () => {
    const candidates = structuredClone(localizationSource.abilities)
    candidates[1].chineseName = candidates[0].chineseName
    const mappings = mapAbilityLocalizations(artifacts.dataset, candidates)
    assert.equal(new Set(mappings.map(mapping => mapping.entry.entityId)).size, 9)
  })

  test('non-unique Form mechanics match cannot pass as automatic', () => {
    const rotom = localizationSource.species.find(candidate => candidate.nationalDexNumber === 479)!
    const heat = artifacts.dataset.forms.find(form => form.formId === 'form:0479:heat')!
    const abilityIds = new Map(localizationSource.abilities.map(candidate => [
      candidate.chineseName,
      artifacts.dataset.abilities.find(ability => ability.officialNumber === candidate.officialNumber)!.abilityId,
    ]))
    const heatCandidate = rotom.forms.find(candidate => candidate.nameZh === '加热洛托姆')!
    assert.throws(
      () => requireUniqueAutomaticFormCandidate(heat, [...rotom.forms, structuredClone(heatCandidate)], abilityIds),
      /ZH_FORM_NON_UNIQUE/,
    )
  })

  test('required Species localization is blocking but mechanics remain independently valid', () => {
    const localization = structuredClone(artifacts.localization)
    localization.core.entries = localization.core.entries.filter(entry => entry.entityId !== 'species:0006')
    assert.doesNotThrow(() => validateSmokeDataset(
      artifacts.dataset,
      artifacts.source.sourceReferences,
      artifacts.identityMatches,
      artifacts.valueProvenance,
    ))
    assert.throws(() => validateSmokeDataset(
      artifacts.dataset,
      artifacts.source.sourceReferences,
      artifacts.identityMatches,
      artifacts.valueProvenance,
      localization,
    ), /MISSING_REQUIRED_SPECIES_LOCALIZATION/)
  })

  test('Form mapping classes and localization provenance are complete', () => {
    assert.deepEqual({
      automatic: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'automatic').length,
      ruleBased: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'rule-based').length,
      unresolved: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'unresolved').length,
    }, { automatic: 11, ruleBased: 1, unresolved: 0 })
    assert.equal(artifacts.localizationMechanicsConflicts.length, 0)
    assert.equal(artifacts.localizationProvenanceCount, 43)
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
