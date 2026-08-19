import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import type { SmokeDataset } from '../../../src/lib/data-model/smoke-schema.ts'
import {
  mapAbilityLocalizations,
  mapSpeciesLocalizations,
  requireUniqueAutomaticFormCandidate,
} from '../localization.ts'
import { buildGrowthRates, CANONICAL_GROWTH_RATES, parseGrowthRate } from '../growth-rate.ts'
import { assertUniqueMoveNumbers, parseChineseAccuracy, parseChineseNumeric, requireZhMoveCandidate } from '../moves.ts'
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
      growthRates: artifacts.dataset.growthRates.length,
      moves: artifacts.dataset.moves.length,
    }, { types: 18, natures: 25, species: 9, forms: 19, abilities: 23, growthRates: 6, moves: 11 })
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

describe('Move identity and core mechanics fixtures', () => {
  test('official Move numbers are unique and duplicates fail', () => {
    assert.doesNotThrow(() => assertUniqueMoveNumbers(artifacts.dataset.moves))
    const duplicate = structuredClone(artifacts.dataset.moves)
    duplicate[1].officialNumber = duplicate[0].officialNumber
    assert.throws(() => assertUniqueMoveNumbers(duplicate), /DUPLICATE_MOVE_NUMBER/)
  })

  test('English identity mismatch is blocking', () => {
    const candidates = structuredClone(localizationSource)
    candidates.moves.find(move => move.officialNumberRaw === '1')!.englishName = 'Wrong Pound'
    const pound = artifacts.dataset.moves.find(move => move.showdownId === 'pound')!
    assert.throws(() => requireZhMoveCandidate(pound, candidates.moves), /ZH_MOVE_ENGLISH_CONFLICT/)
  })

  test('G-Max Wildfire uses the explicit no-number registry rule', () => {
    const move = artifacts.dataset.moves.find(candidate => candidate.showdownId === 'gmaxwildfire')
    assert.equal(move?.moveId, 'move:special:gmax-wildfire')
    assert.equal(move?.officialNumber, null)
    assert.equal(artifacts.identityMatches.find(match => match.entityId === move?.moveId)?.mappingClass, 'rule-based')
  })

  test('Showdown accuracy true becomes always, never percent 100', () => {
    assert.deepEqual(artifacts.dataset.moves.find(move => move.showdownId === 'swift')?.accuracy, { kind: 'always' })
  })

  test('Chinese dash remains unknown and is not automatically always', () => {
    assert.deepEqual(parseChineseAccuracy('—'), { kind: 'unknown' })
  })

  test('NumericSemantic distinguishes variable, not-applicable, and unknown', () => {
    assert.deepEqual(artifacts.dataset.moves.find(move => move.showdownId === 'maxflare')?.basePower, { kind: 'variable' })
    assert.deepEqual(artifacts.dataset.moves.find(move => move.showdownId === 'swordsdance')?.basePower, { kind: 'not-applicable' })
    assert.deepEqual(parseChineseNumeric('—'), { kind: 'unknown' })
  })

  test('Nihil Light identity succeeds but its mechanics conflict is quarantined', () => {
    const quarantined = artifacts.quarantinedMoves.find(entry => entry.move.showdownId === 'nihillight')
    assert.ok(quarantined)
    assert.equal(quarantined.move.moveId, 'move:0920')
    assert.ok(quarantined.conflicts.some(conflict => conflict.code === 'MOVE_BASE_POWER_CONFLICT' && conflict.severity === 'error'))
  })

  test('Future Nihil Light is excluded from the stable runtime dataset', () => {
    assert.equal(artifacts.dataset.moves.some(move => move.showdownId === 'nihillight'), false)
    assert.equal(artifacts.quarantinedMoves[0].move.availability.lifecycle, 'future')
  })

  test('Chinese localization never overrides canonical mechanics', () => {
    const malignant = artifacts.dataset.moves.find(move => move.showdownId === 'malignantchain')
    assert.deepEqual(malignant?.basePower, { kind: 'numeric', value: 100 })
    assert.equal(artifacts.localization.moves.entries.find(entry => entry.entityId === malignant?.moveId)?.name, '邪毒锁链')
  })

  test('Move identities and provenance resolve to locked source references', () => {
    const referenceIds = new Set(artifacts.source.sourceReferences.map(reference => reference.sourceReferenceId))
    const moveIdentities = artifacts.identityMatches.filter(match => match.entityKind === 'move')
    const moveProvenance = artifacts.valueProvenance.filter(value => value.entityId.startsWith('move:'))
    assert.equal(moveIdentities.length, 12)
    assert.ok(moveIdentities.every(match => referenceIds.has(match.sourceReferenceId)))
    assert.ok(moveProvenance.every(value => referenceIds.has(value.sourceReferenceId)))
  })

  test('every stable Move has complete identity and mechanics provenance', () => {
    const keys = new Set(artifacts.valueProvenance.filter(value => value.selected).map(value => `${value.entityId}${value.fieldPath}`))
    const fields = ['/moveId', '/officialNumber', '/showdownId', '/canonicalName/en', '/typeId', '/category', '/basePower', '/accuracy', '/pp', '/priority', '/target', '/generation', '/availability']
    assert.ok(artifacts.dataset.moves.every(move => fields.every(field => keys.has(`${move.moveId}${field}`))))
  })
})

describe('pokemon-dataset-zh localization fixtures', () => {
  test('all fixture Species map by number and validated English name', () => {
    assert.deepEqual(
      artifacts.localization.core.entries
        .filter(entry => entry.entityId.startsWith('species:'))
        .map(entry => [entry.entityId, entry.name]),
      [
        ['species:0006', '喷火龙'],
        ['species:0035', '皮皮'],
        ['species:0058', '卡蒂狗'],
        ['species:0133', '伊布'],
        ['species:0285', '蘑蘑菇'],
        ['species:0290', '土居忍士'],
        ['species:0479', '洛托姆'],
        ['species:0678', '超能妙喵'],
        ['species:1021', '猛雷鼓'],
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

  test('all fixture Abilities map by official number and English name', () => {
    const mappings = mapAbilityLocalizations(artifacts.dataset, localizationSource.abilities)
    assert.equal(mappings.length, 23)
    assert.deepEqual(mappings.map(mapping => mapping.entry.entityId), artifacts.dataset.abilities.map(ability => ability.abilityId))
  })

  test('duplicate Chinese Ability display names do not merge identities', () => {
    const candidates = structuredClone(localizationSource.abilities)
    candidates[1].chineseName = candidates[0].chineseName
    const mappings = mapAbilityLocalizations(artifacts.dataset, candidates)
    assert.equal(new Set(mappings.map(mapping => mapping.entry.entityId)).size, 23)
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
    }, { automatic: 17, ruleBased: 1, unresolved: 1 })
    assert.equal(artifacts.localizationMechanicsConflicts.length, 0)
    assert.equal(artifacts.localizationProvenanceCount, 83)
    assert.doesNotThrow(() => validate(artifacts.dataset))
  })
})

describe('GrowthRate canonical mapping fixtures', () => {
  test('all six Chinese labels and Lv.100 totals resolve to the canonical identities', () => {
    assert.deepEqual([
      '600,000（最快）',
      '800,000（快）',
      '1,000,000（较快）',
      '1,059,860（较慢）',
      '1,250,000（慢）',
      '1,640,000（最慢）',
    ].map(raw => parseGrowthRate(raw).growthRateId), [
      'growth:erratic',
      'growth:fast',
      'growth:medium-fast',
      'growth:medium-slow',
      'growth:slow',
      'growth:fluctuating',
    ])
  })

  test('a Chinese label and Lv.100 total mismatch is blocking', () => {
    assert.throws(() => parseGrowthRate('1,000,000（较慢）'), /GROWTH_RATE_SOURCE_CONFLICT/)
  })

  test('unknown remains a legal unresolved source value without a guessed curve', () => {
    assert.deepEqual(parseGrowthRate('未知'), {
      status: 'unresolved',
      growthRateId: null,
      level100Total: null,
      rawLabel: '未知',
      rawValue: '未知',
    })
  })

  test('all nine fixture Species receive their default GrowthRate', () => {
    assert.equal(artifacts.growthRateAssignments.filter(assignment => assignment.field === '/growthRate').length, 9)
    assert.ok(artifacts.dataset.species.every(species => species.growthRate.status === 'resolved'
      || species.speciesId === 'species:1021'))
  })

  test('Forms matching their Species default do not emit redundant overrides', () => {
    const overrides = artifacts.dataset.forms.filter(form => form.growthRateOverride !== null)
    assert.deepEqual(overrides.map(form => form.formId), ['form:0133:partner'])
  })

  test('Partner Eevee receives the medium-slow override', () => {
    const partner = artifacts.dataset.forms.find(form => form.formId === 'form:0133:partner')
    assert.deepEqual(partner?.growthRateOverride, { id: 'growth:medium-slow', status: 'resolved' })
  })

  test('Partner Eevee does not change the Eevee Species default', () => {
    const eevee = artifacts.dataset.species.find(species => species.speciesId === 'species:0133')
    assert.deepEqual(eevee?.growthRate, { id: 'growth:medium-fast', status: 'resolved' })
  })

  test('a differing source Form without canonical identity becomes a conflict, not an override', () => {
    const source = structuredClone(localizationSource)
    const growlithe = source.species.find(candidate => candidate.nationalDexNumber === 58)!
    growlithe.forms[1].experience100Raw = '800,000（快）'
    const result = buildGrowthRates(artifacts.dataset, source, artifacts.formLocalizationMappings)
    assert.equal(result.conflicts.length, 1)
    assert.equal(result.conflicts[0].code, 'UNMAPPED_FORM_GROWTH_RATE_DIFFERENCE')
    assert.equal(result.conflicts[0].formId, null)
  })

  test('every selected GrowthRate field has an exact source pointer and selected provenance', () => {
    const growthProvenance = artifacts.valueProvenance.filter(value => value.fieldPath.startsWith('/growthRate'))
    assert.equal(growthProvenance.length, 20)
    assert.ok(growthProvenance.every(value => value.selected && value.sourcePointer?.endsWith('/experience_100')))
  })

  test('canonical totals are unique and Raging Bolt is the one expected unresolved warning', () => {
    assert.deepEqual(CANONICAL_GROWTH_RATES.map(rate => rate.level100Total), [
      600_000, 800_000, 1_000_000, 1_059_860, 1_250_000, 1_640_000,
    ])
    assert.equal(new Set(CANONICAL_GROWTH_RATES.map(rate => rate.level100Total)).size, 6)
    const ragingBolt = artifacts.dataset.species.find(species => species.speciesId === 'species:1021')
    assert.deepEqual(ragingBolt?.growthRate, { id: null, status: 'unresolved' })
    const result = validateSmokeDataset(
      artifacts.dataset,
      artifacts.source.sourceReferences,
      artifacts.identityMatches,
      artifacts.valueProvenance,
      artifacts.localization,
    )
    assert.deepEqual(result.issues.map(issue => issue.code), ['EXPECTED_UNRESOLVED_GROWTH_RATE'])
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
