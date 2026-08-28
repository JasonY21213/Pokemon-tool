import { join, resolve } from 'node:path'
import type { RuntimeAbility, RuntimeForm, RuntimeManifest, RuntimeNature, RuntimeSpecies, RuntimeType } from '../../src/lib/runtime-data/types.ts'
import { buildFullDryRun, type FullDryRunArtifacts } from './full-dry-run.ts'
import { getProjectRoot, sha256 } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

const SLOT_ORDER = new Map([['0', 0], ['1', 1], ['H', 2], ['S', 3]])

type CanonicalRecord = Record<string, unknown>

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

function localizationMap(entries: Array<Record<string, unknown>>): Map<string, CanonicalRecord> {
  return new Map(entries.map(entry => [stringValue(entry, 'entityId'), entry]))
}

function tagMap(assignments: Array<{ entityId: string; tagId: string }>): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const assignment of assignments) result.set(assignment.entityId, [...(result.get(assignment.entityId) ?? []), assignment.tagId])
  return result
}

function assertRuntimeReferences(species: RuntimeSpecies[], forms: RuntimeForm[], abilities: RuntimeAbility[], types: RuntimeType[], natures: RuntimeNature[]): void {
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
}

export function buildRuntimeData(artifacts: FullDryRunArtifacts): { species: RuntimeSpecies[]; forms: RuntimeForm[]; abilities: RuntimeAbility[]; types: RuntimeType[]; natures: RuntimeNature[] } {
  const speciesLocalization = localizationMap(artifacts.localization.species)
  const formLocalization = localizationMap(artifacts.localization.forms)
  const abilityLocalization = localizationMap(artifacts.localization.abilities)
  const tagsByEntity = tagMap(artifacts.tags.assignments)
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
  assertRuntimeReferences(species, forms, abilities, types, natures)
  return { species, forms, abilities, types, natures }
}

export async function emitRuntimeData(artifacts: FullDryRunArtifacts, outputRoot = resolve(getProjectRoot(), 'public', 'data')): Promise<{ outputRoot: string; manifest: RuntimeManifest }> {
  const runtime = buildRuntimeData(artifacts)
  const files: Array<[string, unknown, number]> = [
    ['species.json', runtime.species, runtime.species.length],
    ['forms.json', runtime.forms, runtime.forms.length],
    ['abilities.json', runtime.abilities, runtime.abilities.length],
    ['types.json', runtime.types, runtime.types.length],
    ['natures.json', runtime.natures, runtime.natures.length],
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
