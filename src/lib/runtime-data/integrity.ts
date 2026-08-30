import type { CoreRuntimeData, LearnsetRuntimeData, RuntimeDataWithLearnsets, RuntimeManifest } from './types.ts'

export const RUNTIME_SCHEMA_VERSION = 1
export const CORE_RUNTIME_DATA_FILES = [
  'species.json',
  'forms.json',
  'abilities.json',
  'items.json',
  'types.json',
  'natures.json',
  'growth-rates.json',
  'moves.json',
  'evolutions.json',
] as const

export const RUNTIME_DATA_FILES = [...CORE_RUNTIME_DATA_FILES, 'learnsets.json'] as const

export type RuntimeDataFileName = typeof RUNTIME_DATA_FILES[number]

export class RuntimeDataIntegrityError extends Error {
  readonly code: string

  constructor(code: string, detail: string) {
    super(detail)
    this.name = 'RuntimeDataIntegrityError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ensure(condition: unknown, code: string, detail: string): asserts condition {
  if (!condition) throw new RuntimeDataIntegrityError(code, detail)
}

function unique(values: string[], code: string): Set<string> {
  const result = new Set(values)
  ensure(result.size === values.length, code, `${code}: duplicate stable ID`)
  return result
}

export function runtimeDataUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}data/${path}`
}

export function validateRuntimeManifest(value: unknown): RuntimeManifest {
  ensure(isRecord(value), 'MANIFEST_FORMAT', 'Runtime manifest must be an object.')
  ensure(value.schemaVersion === RUNTIME_SCHEMA_VERSION, 'MANIFEST_VERSION', `Unsupported runtime schema version: ${String(value.schemaVersion)}`)
  ensure(Array.isArray(value.files), 'MANIFEST_FILES', 'Runtime manifest files must be an array.')
  const paths: string[] = []
  for (const file of value.files) {
    ensure(isRecord(file), 'MANIFEST_FILE_FORMAT', 'Runtime manifest file entry must be an object.')
    ensure(typeof file.path === 'string', 'MANIFEST_FILE_PATH', 'Runtime manifest file path is invalid.')
    ensure(Number.isInteger(file.recordCount) && Number(file.recordCount) >= 0, 'MANIFEST_RECORD_COUNT', `Invalid record count for ${file.path}.`)
    ensure(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'MANIFEST_HASH', `Invalid SHA-256 for ${file.path}.`)
    paths.push(file.path)
  }
  const expected = [...RUNTIME_DATA_FILES].sort()
  ensure(paths.length === expected.length && [...paths].sort().every((path, index) => path === expected[index]), 'MANIFEST_FILE_SET', 'Runtime manifest does not list the exact supported data file set.')
  ensure(new Set(paths).size === paths.length, 'MANIFEST_DUPLICATE_FILE', 'Runtime manifest contains a duplicate file entry.')
  return value as RuntimeManifest
}

export function validateCoreRuntimeData(data: Omit<CoreRuntimeData, 'manifest'>, manifest: RuntimeManifest): void {
  const collections: Record<(typeof CORE_RUNTIME_DATA_FILES)[number], unknown[]> = {
    'species.json': data.species,
    'forms.json': data.forms,
    'abilities.json': data.abilities,
    'items.json': data.items,
    'types.json': data.types,
    'natures.json': data.natures,
    'growth-rates.json': data.growthRates,
    'moves.json': data.moves,
    'evolutions.json': data.evolutions,
  }
  for (const path of CORE_RUNTIME_DATA_FILES) {
    ensure(Array.isArray(collections[path]), 'DATA_FILE_FORMAT', `${path} must contain the expected collection.`)
    const expectedCount = manifest.files.find(file => file.path === path)?.recordCount
    ensure(collections[path].length === expectedCount, 'DATA_RECORD_COUNT', `${path} record count does not match the manifest.`)
  }
  const speciesIds = unique(data.species.map(record => record.speciesId), 'SPECIES_ID_UNIQUENESS')
  const formIds = unique(data.forms.map(record => record.formId), 'FORM_ID_UNIQUENESS')
  const abilityIds = unique(data.abilities.map(record => record.abilityId), 'ABILITY_ID_UNIQUENESS')
  unique(data.items.map(record => record.itemId), 'ITEM_ID_UNIQUENESS')
  const typeIds = unique(data.types.map(record => record.typeId), 'TYPE_ID_UNIQUENESS')
  unique(data.natures.map(record => record.natureId), 'NATURE_ID_UNIQUENESS')
  const growthRateIds = unique(data.growthRates.map(record => record.growthRateId), 'GROWTH_RATE_ID_UNIQUENESS')
  unique(data.moves.map(record => record.moveId), 'MOVE_ID_UNIQUENESS')
  unique(data.evolutions.map(record => record.evolutionId), 'EVOLUTION_ID_UNIQUENESS')

  ensure(data.species.every(record => formIds.has(record.defaultFormId) && record.formIds.length > 0 && record.formIds.every(id => formIds.has(id)) && (record.growthRate.status === 'unresolved' ? record.growthRate.id === null : record.growthRate.id !== null && growthRateIds.has(record.growthRate.id))), 'SPECIES_REFERENCE', 'Species data contains a dangling Form or growth-rate reference.')
  ensure(data.forms.every(record => speciesIds.has(record.speciesId) && record.types.every(id => typeIds.has(id)) && record.abilities.every(slot => abilityIds.has(slot.abilityId)) && (record.growthRateOverride === null || (record.growthRateOverride.status === 'unresolved' ? record.growthRateOverride.id === null : record.growthRateOverride.id !== null && growthRateIds.has(record.growthRateOverride.id)))), 'FORM_REFERENCE', 'Form data contains a dangling Species, Type, Ability, or growth-rate reference.')
  ensure(data.types.every(record => record.damageTaken.every(entry => typeIds.has(entry.attackingTypeId))), 'TYPE_REFERENCE', 'Type data contains a dangling attacking Type reference.')
  ensure(data.moves.every(record => typeIds.has(record.typeId)), 'MOVE_REFERENCE', 'Move data contains a dangling Type reference.')
  ensure(data.evolutions.every(record => formIds.has(record.sourceFormId) && formIds.has(record.targetFormId)), 'EVOLUTION_REFERENCE', 'Evolution data contains a dangling Form reference.')
}

export function validateLearnsetRuntimeData(learnsets: LearnsetRuntimeData, core: Pick<CoreRuntimeData, 'forms' | 'moves' | 'manifest'>): void {
  ensure(Array.isArray(learnsets?.entries), 'DATA_FILE_FORMAT', 'learnsets.json must contain the expected collection.')
  const expectedCount = core.manifest.files.find(file => file.path === 'learnsets.json')?.recordCount
  ensure(learnsets.entries.length === expectedCount, 'DATA_RECORD_COUNT', 'learnsets.json record count does not match the manifest.')
  ensure(learnsets.scope === 'pinned-showdown-known-association-across-generations', 'LEARNSET_SCOPE', 'Learnset scope is missing or incompatible.')
  const formIds = new Set(core.forms.map(record => record.formId))
  const moveIds = new Set(core.moves.map(record => record.moveId))
  ensure(learnsets.entries.length === formIds.size && learnsets.entries.every(record => formIds.has(record.entityId) && (record.parentEntityId === null || formIds.has(record.parentEntityId)) && record.directMoveIds.every(id => moveIds.has(id))), 'LEARNSET_REFERENCE', 'Learnset data contains a dangling Form or Move reference.')
}

export function validateLoadedRuntimeData(data: Omit<RuntimeDataWithLearnsets, 'manifest'>, manifest: RuntimeManifest): void {
  const core = { ...data, manifest }
  validateCoreRuntimeData(core, manifest)
  validateLearnsetRuntimeData(data.learnsets, core)
}
