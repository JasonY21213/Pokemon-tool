import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import {
  AppearanceSchema,
  type EvolutionCondition,
  type EvolutionEdge,
  type SmokeDataset,
} from '../../../src/lib/data-model/smoke-schema.ts'
import {
  mapAbilityLocalizations,
  mapSpeciesLocalizations,
  requireUniqueAutomaticFormCandidate,
} from '../localization.ts'
import { buildGrowthRates, CANONICAL_GROWTH_RATES, parseGrowthRate } from '../growth-rate.ts'
import { assertUniqueMoveNumbers, parseChineseAccuracy, parseChineseNumeric, requireZhMoveCandidate } from '../moves.ts'
import { assertUniqueEvolutionMappings, buildEvolutions } from '../evolutions.ts'
import { buildSmokeArtifacts, makeNationalSpeciesId, type BuildArtifacts } from '../pipeline.ts'
import { loadPokemonDatasetZhSource, type PokemonDatasetZhAdapterOutput } from '../pokemon-dataset-zh.ts'
import { validateSmokeDataset } from '../validation.ts'
import { loadShowdownSource, type ShowdownSourceData } from '../source.ts'

let artifacts: BuildArtifacts
let localizationSource: PokemonDatasetZhAdapterOutput
let showdownData: ShowdownSourceData

before(async () => {
  artifacts = await buildSmokeArtifacts()
  localizationSource = await loadPokemonDatasetZhSource(artifacts.source)
  showdownData = await loadShowdownSource(artifacts.source)
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
    }, { types: 18, natures: 25, species: 21, forms: 31, abilities: 37, growthRates: 6, moves: 11 })
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

describe('EvolutionEdge and Appearance fixtures', () => {
  const edge = (methodToken: string) => artifacts.dataset.evolutions.find(candidate => candidate.methodToken === methodToken)!

  test('Eevee base Form has exactly eight independent branches', () => {
    const edges = artifacts.dataset.evolutions.filter(candidate => candidate.source.kind === 'form' && candidate.source.id === 'form:0133:base')
    assert.equal(edges.length, 8)
    assert.equal(new Set(edges.map(candidate => candidate.target.id)).size, 8)
  })

  test('Partner Eevee inherits no evolution edges', () => {
    assert.equal(artifacts.dataset.evolutions.filter(candidate => candidate.source.id === 'form:0133:partner').length, 0)
  })

  test('Water Stone is a structured item condition', () => {
    assert.ok(edge('water-stone').conditions.some(condition => condition.kind === 'item' && condition.itemId === 'item:water-stone'))
  })

  test('Espeon uses friendship AND day conditions', () => {
    const conditions = edge('friendship-day').conditions
    assert.ok(conditions.some(condition => condition.kind === 'friendship'))
    assert.ok(conditions.some(condition => condition.kind === 'time' && condition.value === 'day'))
  })

  test('Umbreon uses friendship AND night conditions', () => {
    const conditions = edge('friendship-night').conditions
    assert.ok(conditions.some(condition => condition.kind === 'friendship'))
    assert.ok(conditions.some(condition => condition.kind === 'time' && condition.value === 'night'))
  })

  test('Sylveon keeps the Fairy move-known branch', () => {
    assert.ok(edge('affection-fairy-move').conditions.some(condition => condition.kind === 'move-known' && condition.typeId === 'type:fairy'))
  })

  test('Kadabra to Alakazam selects trade as canonical mechanics', () => {
    const trade = edge('trade')
    assert.deepEqual(trade.source, { kind: 'form', id: 'form:0064:base' })
    assert.deepEqual(trade.target, { kind: 'form', id: 'form:0065:base' })
    assert.ok(trade.conditions.some(condition => condition.kind === 'trade'))
  })

  test('Kadabra Linking Cord alternative stays raw instead of becoming trade AND item', () => {
    const trade = edge('trade')
    assert.equal(trade.conditions.some(condition => condition.kind === 'item' || condition.kind === 'held-item'), false)
    assert.match(artifacts.localization.evolutions.entries.find(entry => entry.entityId === trade.evolutionId)!.conditionText, /联系绳/)
    assert.ok(artifacts.evolutionConflicts.some(conflict => conflict.evolutionId === trade.evolutionId && conflict.severity === 'warning'))
  })

  test('Milcery edges retain held-item, spin, raw fallback, and partial status', () => {
    const edges = artifacts.dataset.evolutions.filter(candidate => candidate.source.id === 'form:0868:base')
    assert.equal(edges.length, 3)
    assert.ok(edges.every(candidate => candidate.dataStatus === 'partial'
      && candidate.conditions.some(condition => condition.kind === 'held-item')
      && candidate.conditions.some(condition => condition.kind === 'spin' && condition.direction === 'unknown')
      && candidate.conditions.some(condition => condition.kind === 'raw')))
  })

  test('Milcery resultAppearanceId resolves to one of three proof Appearances', () => {
    assert.equal(artifacts.dataset.appearances.length, 3)
    const appearanceIds = new Set(artifacts.dataset.appearances.map(appearance => appearance.appearanceId))
    assert.ok(artifacts.dataset.evolutions.filter(candidate => candidate.source.id === 'form:0868:base')
      .every(candidate => candidate.resultAppearanceId !== null && appearanceIds.has(candidate.resultAppearanceId)))
  })

  test('Showdown source/target mismatch is blocking', () => {
    const data: ShowdownSourceData = {
      ...showdownData,
      pokedex: {
        ...showdownData.pokedex,
        vaporeon: {
          ...(showdownData.pokedex.vaporeon as Record<string, unknown>),
          prevo: 'Pikachu',
        },
      },
    }
    assert.throws(() => buildEvolutions(data, artifacts.source, localizationSource), /EVOLUTION_GRAPH_TARGET_MISMATCH/)
  })

  test('orphan evolution target is rejected', () => {
    const dataset = clonedDataset()
    dataset.evolutions[0].target = { kind: 'form', id: 'form:9999:base' }
    assert.throws(() => validate(dataset), /ORPHAN_EVOLUTION_TARGET/)
  })

  test('duplicate evolution ID is rejected', () => {
    const dataset = clonedDataset()
    dataset.evolutions.push(structuredClone(dataset.evolutions[0]))
    assert.throws(() => validate(dataset), /DUPLICATE_ID|DUPLICATE_EVOLUTION_ID/)
  })

  test('same source target and method cannot be disguised as an OR alternative', () => {
    const edges = structuredClone(artifacts.dataset.evolutions)
    const duplicateMethod = structuredClone(edges[0])
    duplicateMethod.evolutionId = 'evolution:0064-base:0065-base:trade-alternative'
    assert.throws(() => assertUniqueEvolutionMappings([...edges, duplicateMethod]), /NON_UNIQUE_EVOLUTION_MAPPING/)
  })

  test('invalid resultAppearanceId is rejected', () => {
    const dataset = clonedDataset()
    dataset.evolutions.find(candidate => candidate.resultAppearanceId)!.resultAppearanceId = 'appearance:0869:mint-cream:star-sweet'
    assert.throws(() => validate(dataset), /ORPHAN_RESULT_APPEARANCE/)
  })

  test('Appearance schema rejects battle mechanics fields', () => {
    const appearance = structuredClone(artifacts.dataset.appearances[0]) as unknown as Record<string, unknown>
    appearance.baseStats = { hp: 1 }
    assert.throws(() => AppearanceSchema.parse(appearance))
  })

  test('missing raw text produces partial data without discarding structured mechanics', () => {
    const source = structuredClone(localizationSource)
    source.evolutions = source.evolutions.filter(candidate => !(candidate.documentNationalDexNumber === 133 && candidate.targetNameZh === '水伊布'))
    const result = buildEvolutions(showdownData, artifacts.source, source)
    const water = result.evolutions.find(candidate => candidate.methodToken === 'water-stone')!
    assert.equal(water.dataStatus, 'partial')
    assert.equal(water.conditionTextKey, null)
    assert.ok(water.conditions.some(condition => condition.kind === 'item'))
    assert.equal(water.conditions.some(condition => condition.kind === 'raw'), false)
  })

  test('structured mechanics remain selected when localized raw text differs', () => {
    const trade = edge('trade')
    assert.ok(trade.conditions.some(condition => condition.kind === 'trade'))
    assert.ok(artifacts.evolutionConflicts.some(conflict => conflict.resolution === 'structured-selected-raw-preserved'))
  })

  test('Evolution and Appearance provenance is complete and resolvable', () => {
    const references = new Set(artifacts.source.sourceReferences.map(reference => reference.sourceReferenceId))
    const values = artifacts.valueProvenance.filter(value => value.entityId.startsWith('evolution:') || value.entityId.startsWith('appearance:'))
    assert.ok(values.length > 0)
    assert.ok(values.every(value => references.has(value.sourceReferenceId)))
    const keys = new Set(values.map(value => `${value.entityId}${value.fieldPath}`))
    assert.ok(artifacts.dataset.evolutions.every(candidate => [
      '/evolutionId', '/source', '/target', '/methodToken', '/conditionTextKey',
    ].every(field => keys.has(`${candidate.evolutionId}${field}`))
      && candidate.conditions.every((_, index) => keys.has(`${candidate.evolutionId}/conditions/${index}`))))
    const conditionPointer = (candidate: EvolutionEdge, kind: EvolutionCondition['kind']) => {
      const index = candidate.conditions.findIndex(condition => condition.kind === kind)
      return values.find(value => value.entityId === candidate.evolutionId && value.fieldPath === `/conditions/${index}`)?.sourcePointer
    }
    assert.equal(conditionPointer(edge('water-stone'), 'item'), '/vaporeon/evoItem')
    assert.equal(conditionPointer(edge('friendship-day'), 'time'), '/espeon/evoCondition')
    assert.equal(conditionPointer(edge('trade'), 'trade'), '/alakazam/evoType')
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
        ['species:0064', '勇基拉'],
        ['species:0065', '胡地'],
        ['species:0133', '伊布'],
        ['species:0134', '水伊布'],
        ['species:0135', '雷伊布'],
        ['species:0136', '火伊布'],
        ['species:0196', '太阳伊布'],
        ['species:0197', '月亮伊布'],
        ['species:0285', '蘑蘑菇'],
        ['species:0290', '土居忍士'],
        ['species:0470', '叶伊布'],
        ['species:0471', '冰伊布'],
        ['species:0479', '洛托姆'],
        ['species:0678', '超能妙喵'],
        ['species:0700', '仙子伊布'],
        ['species:0868', '小仙奶'],
        ['species:0869', '霜奶仙'],
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
    assert.equal(mappings.length, 37)
    assert.deepEqual(mappings.map(mapping => mapping.entry.entityId), artifacts.dataset.abilities.map(ability => ability.abilityId))
  })

  test('duplicate Chinese Ability display names do not merge identities', () => {
    const candidates = structuredClone(localizationSource.abilities)
    candidates[1].chineseName = candidates[0].chineseName
    const mappings = mapAbilityLocalizations(artifacts.dataset, candidates)
    assert.equal(new Set(mappings.map(mapping => mapping.entry.entityId)).size, 37)
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
    }, { automatic: 29, ruleBased: 1, unresolved: 1 })
    assert.equal(artifacts.localizationMechanicsConflicts.length, 0)
    assert.equal(artifacts.localizationProvenanceCount, 135)
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

  test('all fixture Species receive their default GrowthRate', () => {
    assert.equal(artifacts.growthRateAssignments.filter(assignment => assignment.field === '/growthRate').length, 21)
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
    assert.equal(growthProvenance.length, 44)
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
