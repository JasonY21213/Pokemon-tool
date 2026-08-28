import { join, resolve } from 'node:path'
import type { RuntimeAbility, RuntimeAccuracy, RuntimeEvolution, RuntimeForm, RuntimeGrowthRate, RuntimeGrowthRateResolution, RuntimeLearnsets, RuntimeManifest, RuntimeMove, RuntimeNature, RuntimeNumericValue, RuntimeSpecies, RuntimeType } from '../../src/lib/runtime-data/types.ts'
import { buildFullDryRun, type FullDryRunArtifacts } from './full-dry-run.ts'
import { CANONICAL_GROWTH_RATES } from './growth-rate.ts'
import { getProjectRoot, sha256 } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

const SLOT_ORDER = new Map([['0', 0], ['1', 1], ['H', 2], ['S', 3]])

type CanonicalRecord = Record<string, unknown>

function experienceTotal(formulaId: string, level: number): number {
  if (level === 1) return 0
  const cube = level ** 3
  if (formulaId === 'erratic') {
    if (level <= 50) return Math.floor((cube * (100 - level)) / 50)
    if (level <= 68) return Math.floor((cube * (150 - level)) / 100)
    if (level <= 98) return Math.floor((cube * Math.floor((1911 - 10 * level) / 3)) / 500)
    return Math.floor((cube * (160 - level)) / 100)
  }
  if (formulaId === 'fast') return Math.floor((4 * cube) / 5)
  if (formulaId === 'mediumFast') return cube
  if (formulaId === 'mediumSlow') return Math.max(0, Math.floor((6 * cube) / 5 - 15 * level ** 2 + 100 * level - 140))
  if (formulaId === 'slow') return Math.floor((5 * cube) / 4)
  if (formulaId === 'fluctuating') {
    if (level <= 15) return Math.floor((cube * (Math.floor((level + 1) / 3) + 24)) / 50)
    if (level <= 36) return Math.floor((cube * (level + 14)) / 50)
    return Math.floor((cube * (Math.floor(level / 2) + 32)) / 50)
  }
  throw new Error(`RUNTIME_GROWTH_RATE_FORMULA: ${formulaId}`)
}

function growthResolution(value: unknown): RuntimeGrowthRateResolution {
  if (!value || typeof value !== 'object') throw new Error('RUNTIME_GROWTH_RATE_RESOLUTION')
  const record = value as CanonicalRecord
  if (record.status === 'resolved' && typeof record.id === 'string') return { id: record.id, status: 'resolved' }
  if (record.status === 'unresolved' && record.id === null) return { id: null, status: 'unresolved' }
  throw new Error('RUNTIME_GROWTH_RATE_RESOLUTION')
}

function stringValue(record: CanonicalRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`RUNTIME_EMISSION_INVALID_${key.toUpperCase()}`)
  return value
}

function canonicalName(record: CanonicalRecord): string {
  const value = record.canonicalName
  if (!value || typeof value !== 'object' || typeof (value as CanonicalRecord).en !== 'string') throw new Error('RUNTIME_EMISSION_INVALID_CANONICAL_NAME')
  return (value as CanonicalRecord).en as string
}

function statBlock(record: CanonicalRecord): RuntimeForm['baseStats'] {
  const value = record.baseStats
  if (!value || typeof value !== 'object') throw new Error('RUNTIME_EMISSION_INVALID_BASE_STATS')
  const stats = value as CanonicalRecord
  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
  if (!keys.every(key => Number.isInteger(stats[key]) && Number(stats[key]) > 0)) throw new Error('RUNTIME_EMISSION_INVALID_BASE_STATS')
  return Object.fromEntries(keys.map(key => [key, stats[key]])) as RuntimeForm['baseStats']
}

function numericValue(value: unknown, notApplicable = false): RuntimeNumericValue {
  if (notApplicable) return { kind: 'not-applicable' }
  return Number.isInteger(value) && Number(value) > 0 ? { kind: 'numeric', value: Number(value) } : { kind: 'unknown' }
}

function accuracyValue(value: unknown): RuntimeAccuracy {
  if (value === 'always') return { kind: 'always' }
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 100 ? { kind: 'percent', value: Number(value) } : { kind: 'unknown' }
}

function localizationMap(entries: Array<Record<string, unknown>>): Map<string, CanonicalRecord> {
  return new Map(entries.map(entry => [stringValue(entry, 'entityId'), entry]))
}

function tagMap(assignments: Array<{ entityId: string; tagId: string }>): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const assignment of assignments) result.set(assignment.entityId, [...(result.get(assignment.entityId) ?? []), assignment.tagId])
  return result
}

function assertRuntimeReferences(species: RuntimeSpecies[], forms: RuntimeForm[], abilities: RuntimeAbility[], types: RuntimeType[], natures: RuntimeNature[], growthRates: RuntimeGrowthRate[], moves: RuntimeMove[], evolutions: RuntimeEvolution[], learnsets: RuntimeLearnsets): void {
  const formIds = new Set(forms.map(form => form.formId))
  const abilityIds = new Set(abilities.map(ability => ability.abilityId))
  for (const entry of species) {
    if (!formIds.has(entry.defaultFormId) || entry.formIds.length === 0 || !entry.formIds.every(id => formIds.has(id))) throw new Error(`RUNTIME_SPECIES_FORM_REFERENCE: ${entry.speciesId}`)
  }
  const speciesIds = new Set(species.map(entry => entry.speciesId))
  for (const form of forms) {
    if (!speciesIds.has(form.speciesId)) throw new Error(`RUNTIME_FORM_SPECIES_REFERENCE: ${form.formId}`)
    if (!form.abilities.every(slot => abilityIds.has(slot.abilityId))) throw new Error(`RUNTIME_FORM_ABILITY_REFERENCE: ${form.formId}`)
    if (!form.types.every(typeId => types.some(type => type.typeId === typeId))) throw new Error(`RUNTIME_FORM_TYPE_REFERENCE: ${form.formId}`)
  }
  const typeIds = new Set(types.map(type => type.typeId))
  if (typeIds.size !== 18 || types.some(type => type.damageTaken.length !== 18 || !type.damageTaken.every(entry => typeIds.has(entry.attackingTypeId)))) throw new Error('RUNTIME_TYPE_REFERENCE_INTEGRITY')
  if (natures.length !== 25 || new Set(natures.map(nature => nature.natureId)).size !== 25 || natures.some(nature => nature.neutral ? nature.plusStat !== null || nature.minusStat !== null : nature.plusStat === null || nature.minusStat === null || nature.plusStat === nature.minusStat)) throw new Error('RUNTIME_NATURE_REFERENCE_INTEGRITY')
  const growthIds = new Set(growthRates.map(rate => rate.growthRateId))
  if (growthRates.length !== 6 || growthRates.some(rate => rate.totalExpByLevel.length !== 100 || rate.totalExpByLevel[99] !== rate.level100Total || rate.totalExpByLevel.some((total, index) => !Number.isInteger(total) || total < 0 || (index > 0 && total < rate.totalExpByLevel[index - 1])))) throw new Error('RUNTIME_GROWTH_RATE_TABLE_INTEGRITY')
  if (species.some(entry => entry.growthRate.status === 'resolved' ? !entry.growthRate.id || !growthIds.has(entry.growthRate.id) : entry.growthRate.id !== null)) throw new Error('RUNTIME_SPECIES_GROWTH_REFERENCE')
  if (forms.some(entry => entry.growthRateOverride !== null && (entry.growthRateOverride.status === 'resolved' ? !entry.growthRateOverride.id || !growthIds.has(entry.growthRateOverride.id) : entry.growthRateOverride.id !== null))) throw new Error('RUNTIME_FORM_GROWTH_REFERENCE')
  if (new Set(moves.map(move => move.moveId)).size !== moves.length || moves.some(move => !typeIds.has(move.typeId) || !move.zhName || !move.zhDescription)) throw new Error('RUNTIME_MOVE_REFERENCE_INTEGRITY')
  if (evolutions.some(edge => !formIds.has(edge.sourceFormId) || !formIds.has(edge.targetFormId) || (edge.level !== null && (!Number.isInteger(edge.level) || edge.level < 1)) || (edge.dataStatus === 'complete' && edge.rawCondition !== null))) throw new Error('RUNTIME_EVOLUTION_REFERENCE_INTEGRITY')
  const moveIds = new Set(moves.map(move => move.moveId))
  if (learnsets.entries.length !== forms.length || new Set(learnsets.entries.map(entry => entry.entityId)).size !== forms.length) throw new Error('RUNTIME_LEARNSET_ENTITY_COVERAGE')
  if (learnsets.entries.some(entry => !formIds.has(entry.entityId) || (entry.parentEntityId !== null && !formIds.has(entry.parentEntityId)) || !entry.directMoveIds.every(moveId => moveIds.has(moveId)) || new Set(entry.directMoveIds).size !== entry.directMoveIds.length)) throw new Error('RUNTIME_LEARNSET_REFERENCE_INTEGRITY')
}

export function buildRuntimeData(artifacts: FullDryRunArtifacts): { species: RuntimeSpecies[]; forms: RuntimeForm[]; abilities: RuntimeAbility[]; types: RuntimeType[]; natures: RuntimeNature[]; growthRates: RuntimeGrowthRate[]; moves: RuntimeMove[]; evolutions: RuntimeEvolution[]; learnsets: RuntimeLearnsets } {
  const speciesLocalization = localizationMap(artifacts.localization.species)
  const formLocalization = localizationMap(artifacts.localization.forms)
  const abilityLocalization = localizationMap(artifacts.localization.abilities)
  const moveLocalization = localizationMap(artifacts.localization.moves)
  const tagsByEntity = tagMap(artifacts.tags.assignments)
  const growthBySpecies = new Map(artifacts.growthRates.map(record => [stringValue(record, 'entityId'), growthResolution({ id: record.growthRateId, status: record.status })]))
  const growthOverrideByForm = new Map(artifacts.formGrowthRateOverrides.map(record => [stringValue(record, 'formId'), growthResolution(record.growthRateOverride)]))
  const abilityByCanonicalName = new Map<string, CanonicalRecord>()
  for (const ability of artifacts.abilities) {
    const name = canonicalName(ability)
    if (abilityByCanonicalName.has(name)) throw new Error(`RUNTIME_ABILITY_NAME_NOT_UNIQUE: ${name}`)
    abilityByCanonicalName.set(name, ability)
  }
  const formIdsBySpecies = new Map<string, string[]>()
  for (const form of artifacts.forms) {
    const speciesId = stringValue(form, 'speciesId')
    formIdsBySpecies.set(speciesId, [...(formIdsBySpecies.get(speciesId) ?? []), stringValue(form, 'formId')])
  }
  const species = artifacts.species.map(record => {
    const speciesId = stringValue(record, 'speciesId')
    const localized = speciesLocalization.get(speciesId)
    return {
      speciesId,
      nationalDexNumber: Number(record.nationalDexNumber),
      canonicalName: canonicalName(record),
      zhName: localized ? stringValue(localized, 'name') : (() => { throw new Error(`RUNTIME_SPECIES_LOCALIZATION: ${speciesId}`) })(),
      defaultFormId: stringValue(record, 'defaultFormId'),
      growthRate: growthBySpecies.get(speciesId) ?? (() => { throw new Error(`RUNTIME_SPECIES_GROWTH_RATE: ${speciesId}`) })(),
      formIds: formIdsBySpecies.get(speciesId) ?? [],
      tagIds: tagsByEntity.get(speciesId) ?? [],
    }
  })
  const forms = artifacts.forms.map(record => {
    const formId = stringValue(record, 'formId')
    const rawAbilities = record.abilities
    if (!rawAbilities || typeof rawAbilities !== 'object' || Array.isArray(rawAbilities)) throw new Error(`RUNTIME_FORM_ABILITIES: ${formId}`)
    const abilities = Object.entries(rawAbilities as CanonicalRecord)
      .map(([slot, abilityName]) => ({ slot, abilityName }))
      .sort((left, right) => (SLOT_ORDER.get(left.slot) ?? 99) - (SLOT_ORDER.get(right.slot) ?? 99))
    const localized = formLocalization.get(formId)
    return {
      formId,
      speciesId: stringValue(record, 'speciesId'),
      canonicalName: canonicalName(record),
      zhName: localized ? stringValue(localized, 'name') : null,
      types: Array.isArray(record.types) && record.types.every(type => typeof type === 'string') ? record.types as string[] : (() => { throw new Error(`RUNTIME_FORM_TYPES: ${formId}`) })(),
      baseStats: statBlock(record),
      abilities: abilities.map(({ slot, abilityName }) => {
        if (!SLOT_ORDER.has(slot) || typeof abilityName !== 'string') throw new Error(`RUNTIME_FORM_ABILITY_SLOT: ${formId}`)
        const ability = abilityByCanonicalName.get(abilityName)
        if (!ability) throw new Error(`RUNTIME_ABILITY_NAME_REFERENCE: ${formId}:${abilityName}`)
        return { slot: slot as RuntimeForm['abilities'][number]['slot'], abilityId: stringValue(ability, 'abilityId') }
      }),
      tagIds: tagsByEntity.get(formId) ?? [],
      growthRateOverride: growthOverrideByForm.get(formId) ?? null,
    }
  })
  const abilities = artifacts.abilities.map(record => {
    const abilityId = stringValue(record, 'abilityId')
    const localized = abilityLocalization.get(abilityId)
    return {
      abilityId,
      canonicalName: canonicalName(record),
      zhName: localized ? stringValue(localized, 'name') : null,
      zhDescription: localized && typeof localized.shortDescription === 'string' && localized.shortDescription.length > 0 ? localized.shortDescription : null,
    }
  })
  const types: RuntimeType[] = artifacts.types.map(record => {
    const rawDamageTaken = record.damageTaken
    if (!Array.isArray(rawDamageTaken)) throw new Error('RUNTIME_TYPE_DAMAGE_TAKEN')
    return {
      typeId: stringValue(record, 'typeId'),
      canonicalName: canonicalName(record),
      damageTaken: rawDamageTaken.map(value => {
        if (!value || typeof value !== 'object') throw new Error('RUNTIME_TYPE_DAMAGE_TAKEN')
        const relationship = value as CanonicalRecord
        const multiplier = relationship.multiplier
        if (multiplier !== 0 && multiplier !== 0.5 && multiplier !== 1 && multiplier !== 2) throw new Error('RUNTIME_TYPE_MULTIPLIER')
        return { attackingTypeId: stringValue(relationship, 'attackingTypeId'), multiplier: multiplier as RuntimeType['damageTaken'][number]['multiplier'] }
      }),
    }
  })
  const natures: RuntimeNature[] = artifacts.natures.map(record => {
    const plusStat = record.plusStat
    const minusStat = record.minusStat
    const stat = (value: unknown): RuntimeNature['plusStat'] => value === null ? null : value === 'atk' || value === 'def' || value === 'spa' || value === 'spd' || value === 'spe' ? value : (() => { throw new Error('RUNTIME_NATURE_STAT') })()
    return { natureId: stringValue(record, 'natureId'), canonicalName: canonicalName(record), plusStat: stat(plusStat), minusStat: stat(minusStat), neutral: record.neutral === true }
  })
  const growthRates: RuntimeGrowthRate[] = CANONICAL_GROWTH_RATES.map(rate => ({
    growthRateId: rate.growthRateId,
    canonicalName: rate.canonicalName,
    level100Total: rate.level100Total,
    totalExpByLevel: Array.from({ length: 100 }, (_, index) => experienceTotal(rate.formulaId, index + 1)),
  })).sort((left, right) => left.growthRateId.localeCompare(right.growthRateId, 'en'))
  const moves: RuntimeMove[] = artifacts.moves
    .filter(record => record.dataStatus === 'complete')
    .map(record => {
      const moveId = stringValue(record, 'moveId')
      const localized = moveLocalization.get(moveId)
      const category = record.category
      if (category !== 'physical' && category !== 'special' && category !== 'status') throw new Error(`RUNTIME_MOVE_CATEGORY: ${moveId}`)
      return {
        moveId,
        canonicalName: canonicalName(record),
        zhName: localized ? stringValue(localized, 'name') : null,
        zhDescription: localized && typeof localized.shortDescription === 'string' && localized.shortDescription.length > 0 ? localized.shortDescription : null,
        typeId: stringValue(record, 'typeId'),
      category: category as RuntimeMove['category'],
        power: numericValue(record.basePower, category === 'status'),
        accuracy: accuracyValue(record.accuracy),
        pp: numericValue(record.pp),
        priority: Number.isInteger(record.priority) ? Number(record.priority) : (() => { throw new Error(`RUNTIME_MOVE_PRIORITY: ${moveId}`) })(),
      }
    })
    .sort((left, right) => left.moveId.localeCompare(right.moveId, 'en'))
  const evolutions: RuntimeEvolution[] = artifacts.evolutions
    .filter(record => record.sourceFormId !== null && record.targetFormId !== null && (record.dataStatus === 'complete' || record.dataStatus === 'partial'))
    .map(record => ({
      evolutionId: stringValue(record, 'evolutionId'),
      sourceFormId: stringValue(record, 'sourceFormId'),
      targetFormId: stringValue(record, 'targetFormId'),
      method: typeof record.evoType === 'string' ? record.evoType : null,
      level: Number.isInteger(record.evoLevel) ? Number(record.evoLevel) : null,
      item: typeof record.evoItem === 'string' ? record.evoItem : null,
      rawCondition: typeof record.rawCondition === 'string' ? record.rawCondition : null,
      dataStatus: record.dataStatus as RuntimeEvolution['dataStatus'],
    }))
    .sort((left, right) => left.evolutionId.localeCompare(right.evolutionId, 'en'))
  const directMoveIdsByEntity = new Map<string, string[]>()
  for (const entry of artifacts.learnsets) directMoveIdsByEntity.set(entry.entityId, [...(directMoveIdsByEntity.get(entry.entityId) ?? []), entry.moveId])
  const learnsets: RuntimeLearnsets = {
    scope: 'pinned-showdown-known-association-across-generations',
    entries: artifacts.learnsetInheritance.map(edge => ({
      entityId: edge.entityId,
      parentEntityId: edge.parentEntityId,
      directMoveIds: (directMoveIdsByEntity.get(edge.entityId) ?? []).sort((left, right) => left.localeCompare(right, 'en')),
    })).sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
  }
  assertRuntimeReferences(species, forms, abilities, types, natures, growthRates, moves, evolutions, learnsets)
  return { species, forms, abilities, types, natures, growthRates, moves, evolutions, learnsets }
}

export async function emitRuntimeData(artifacts: FullDryRunArtifacts, outputRoot = resolve(getProjectRoot(), 'public', 'data')): Promise<{ outputRoot: string; manifest: RuntimeManifest }> {
  const runtime = buildRuntimeData(artifacts)
  const files: Array<[string, unknown, number]> = [
    ['species.json', runtime.species, runtime.species.length],
    ['forms.json', runtime.forms, runtime.forms.length],
    ['abilities.json', runtime.abilities, runtime.abilities.length],
    ['types.json', runtime.types, runtime.types.length],
    ['natures.json', runtime.natures, runtime.natures.length],
    ['growth-rates.json', runtime.growthRates, runtime.growthRates.length],
    ['moves.json', runtime.moves, runtime.moves.length],
    ['evolutions.json', runtime.evolutions, runtime.evolutions.length],
    ['learnsets.json', runtime.learnsets, runtime.learnsets.entries.length],
  ]
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    files: files.map(([path, value, recordCount]) => ({ path, recordCount, sha256: sha256(serializeJson(value)) })),
  }
  for (const [path, value] of files) await writeJson(join(outputRoot, path), value)
  await writeJson(join(outputRoot, 'manifest.json'), manifest)
  return { outputRoot, manifest }
}

export async function runRuntimeEmission(): Promise<{ outputRoot: string; manifest: RuntimeManifest }> {
  return await emitRuntimeData(await buildFullDryRun())
}
