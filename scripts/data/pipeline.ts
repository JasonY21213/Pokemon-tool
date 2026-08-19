import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  AbilitySchema,
  FormSchema,
  IdentityMatchSchema,
  NatureSchema,
  SmokeDatasetSchema,
  SmokeManifestSchema,
  SmokeReportSchema,
  SpeciesSchema,
  TypeSchema,
  ValueProvenanceSchema,
  type Ability,
  type AppearanceMatch,
  type Availability,
  type Form,
  type IdentityMatch,
  type Nature,
  type SmokeDataset,
  type SmokeLocalization,
  type SourceReference,
  type Species,
  type TypeEntity,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import { hashFile, serializeJson, writeJson } from './serialization.ts'
import {
  getProjectRoot,
  loadShowdownSource,
  parseAbilityRecord,
  parsePokedexRecord,
  sha256,
  verifySource,
  type RawPokedexRecord,
  type RegistryEntity,
  type ShowdownSourceData,
  type VerifiedSource,
} from './source.ts'
import { validateSmokeDataset } from './validation.ts'
import { buildLocalization, type FormLocalizationMapping, type LocalizationConflict } from './localization.ts'
import { loadPokemonDatasetZhSource } from './pokemon-dataset-zh.ts'
import {
  buildGrowthRates,
  CANONICAL_GROWTH_RATES,
  type GrowthRateAssignmentAudit,
  type GrowthRateConflict,
} from './growth-rate.ts'
import { buildMoves, type MoveConflict, type QuarantinedMove } from './moves.ts'
import { buildEvolutions, type EvolutionConflict } from './evolutions.ts'
import { buildAppearances, type AppearanceConflict } from './appearances.ts'

const STANDARD_TYPES = [
  ['bug', 'Bug'], ['dark', 'Dark'], ['dragon', 'Dragon'], ['electric', 'Electric'],
  ['fairy', 'Fairy'], ['fighting', 'Fighting'], ['fire', 'Fire'], ['flying', 'Flying'],
  ['ghost', 'Ghost'], ['grass', 'Grass'], ['ground', 'Ground'], ['ice', 'Ice'],
  ['normal', 'Normal'], ['poison', 'Poison'], ['psychic', 'Psychic'], ['rock', 'Rock'],
  ['steel', 'Steel'], ['water', 'Water'],
] as const

const FORM_IDS = [
  'charizard', 'charizardmegax', 'charizardmegay', 'charizardgmax',
  'clefairy', 'growlithe', 'eevee', 'eeveestarter', 'shroomish', 'nincada',
  'kadabra', 'alakazam', 'vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon',
  'leafeon', 'glaceon', 'sylveon', 'unown', 'milcery', 'alcremie', 'alcremiegmax',
  'rotom', 'rotomheat', 'rotomwash', 'rotomfrost', 'rotomfan', 'rotommow',
  'meowstic', 'meowsticf',
  'ragingbolt',
] as const

const SPECIES_IDS = [
  'charizard', 'clefairy', 'growlithe', 'eevee', 'shroomish', 'nincada',
  'kadabra', 'alakazam', 'vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon',
  'leafeon', 'glaceon', 'sylveon', 'unown', 'milcery', 'alcremie',
  'rotom', 'meowstic', 'ragingbolt',
] as const
const SLOT_ORDER = new Map([['0', 0], ['1', 1], ['H', 2], ['S', 3]])
const projectRoot = getProjectRoot()

export interface BuildArtifacts {
  dataset: SmokeDataset
  source: VerifiedSource
  identityMatches: IdentityMatch[]
  valueProvenance: ValueProvenance[]
  localization: SmokeLocalization
  formLocalizationMappings: FormLocalizationMapping[]
  localizationMechanicsConflicts: LocalizationConflict[]
  localizationProvenanceCount: number
  growthRateAssignments: GrowthRateAssignmentAudit[]
  growthRateConflicts: GrowthRateConflict[]
  growthRateProvenanceCount: number
  expectedUnresolvedGrowthRateCount: number
  quarantinedMoves: QuarantinedMove[]
  moveConflicts: MoveConflict[]
  moveMappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
  evolutionConflicts: EvolutionConflict[]
  evolutionMappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
  appearanceMatches: AppearanceMatch[]
  appearanceConflicts: AppearanceConflict[]
  appearanceMappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
  appearanceSourceCoverage: {
    unownHomeImages: number
    showdownUnownGlyphs: number
    alcremieHomeImages: number
    alcremieCombinations: number
    alcremieExcludedCoverageRecords: number
    showdownAlcremieCreams: number
  }
  scopeNotes: string[]
}

export interface PipelineResult {
  dataset: SmokeDataset
  sourceCommits: {
    pokemonShowdown: string
    pokemonDatasetZh: string
  }
  outputRoot: string
  runtimeHashes: Record<string, string>
}

function toShowdownId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function availability(isNonstandard?: string): Availability {
  if (isNonstandard === 'Past') return { lifecycle: 'past', obtainability: 'unknown' }
  if (isNonstandard === 'Future') return { lifecycle: 'future', obtainability: 'unobtainable' }
  if (isNonstandard === 'Unobtainable') return { lifecycle: 'current', obtainability: 'unobtainable' }
  if (isNonstandard) return { lifecycle: 'unknown', obtainability: 'unknown' }
  return { lifecycle: 'current', obtainability: 'obtainable' }
}

// Mirrors the fixed snapshot's sim/dex-species.ts generation rules for this smoke scope.
function deriveSpeciesGeneration(num: number, forme = ''): number {
  if (num >= 906 || forme.includes('Paldea')) return 9
  if (num >= 810 || ['Gmax', 'Galar', 'Galar-Zen', 'Hisui'].includes(forme)) return 8
  if (num >= 722 || forme.startsWith('Alola') || forme === 'Starter') return 7
  if (num >= 650 || forme.startsWith('Mega') || forme === 'Primal') return 6
  if (num >= 494) return 5
  if (num >= 387) return 4
  if (num >= 252) return 3
  if (num >= 152) return 2
  if (num >= 1) return 1
  throw new Error(`NON_NATIONAL_SPECIES: cannot derive a national Species generation for number ${num}`)
}

// Mirrors the fixed snapshot's sim/dex-abilities.ts generation rules.
function deriveAbilityGeneration(num: number): number {
  if (num >= 268) return 9
  if (num >= 234) return 8
  if (num >= 192) return 7
  if (num >= 165) return 6
  if (num >= 124) return 5
  if (num >= 77) return 4
  if (num >= 1) return 3
  throw new Error(`INVALID_ABILITY_NUMBER: ${num}`)
}

export function makeNationalSpeciesId(num: number): string {
  if (!Number.isInteger(num) || num <= 0 || num > 9999) {
    throw new Error(`NON_NATIONAL_SPECIES: ${num} cannot receive a species:* ID`)
  }
  return `species:${num.toString().padStart(4, '0')}`
}

function registryEntry(source: VerifiedSource, kind: RegistryEntity['kind'], showdownId: string): RegistryEntity {
  const matches = source.registry.filter(entity => entity.kind === kind && entity.showdownId === showdownId)
  if (matches.length !== 1) {
    throw new Error(`REGISTRY_PROPOSAL_REQUIRED: expected one ${kind} mapping for ${showdownId}, found ${matches.length}`)
  }
  return matches[0]
}

function sourceRef(source: VerifiedSource, path: string): SourceReference {
  const reference = source.sourceReferenceByPath.get(path)
  if (!reference) throw new Error(`Missing source reference for ${path}`)
  return reference
}

function requiredPokedexRecord(data: ShowdownSourceData, id: string): RawPokedexRecord {
  const value = data.pokedex[id]
  if (value === undefined) throw new Error(`Missing Showdown Pokédex record: ${id}`)
  return parsePokedexRecord(value, id)
}

function typeId(name: string): `type:${string}` {
  return `type:${toShowdownId(name)}`
}

function formKind(record: RawPokedexRecord): Form['formKind'] {
  if (!record.baseSpecies) return 'base'
  if (record.forme?.startsWith('Mega')) return 'mega'
  if (record.forme === 'Gmax') return 'gmax'
  return 'special'
}

function mapChangesFrom(source: VerifiedSource, name?: string): string[] {
  if (!name) return []
  return [registryEntry(source, 'form', toShowdownId(name)).projectId]
}

function buildTypes(data: ShowdownSourceData): TypeEntity[] {
  const multiplierForCode = (code: number): 0 | 0.5 | 1 | 2 => {
    if (code === 0) return 1
    if (code === 1) return 2
    if (code === 2) return 0.5
    if (code === 3) return 0
    throw new Error(`Unknown TypeChart damage code: ${code}`)
  }
  return STANDARD_TYPES.map(([showdownId, name]) => {
    const raw = data.typeChart[showdownId]
    if (!raw) throw new Error(`Missing standard Type: ${showdownId}`)
    const damageTaken = STANDARD_TYPES.map(([attackerId, attackerName]) => {
      const code = raw.damageTaken[attackerName]
      const multiplier = code === undefined ? 1 : multiplierForCode(code)
      return { attackingTypeId: typeId(attackerId), multiplier }
    })
    return TypeSchema.parse({
      typeId: typeId(showdownId),
      showdownId,
      canonicalName: { en: name },
      damageTaken,
      availability: { lifecycle: 'current', obtainability: 'obtainable' },
      dataStatus: 'complete',
    })
  })
}

function buildNatures(data: ShowdownSourceData): Nature[] {
  return Object.entries(data.natures).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([showdownId, raw]) => {
    const neutral = raw.plus === undefined && raw.minus === undefined
    return NatureSchema.parse({
      natureId: `nature:${showdownId}`,
      showdownId,
      canonicalName: { en: raw.name },
      plusStat: raw.plus ?? null,
      minusStat: raw.minus ?? null,
      neutral,
      dataStatus: 'complete',
    })
  })
}

function buildForms(data: ShowdownSourceData, source: VerifiedSource): Form[] {
  return FORM_IDS.map(showdownId => {
    const raw = requiredPokedexRecord(data, showdownId)
    const registry = registryEntry(source, 'form', showdownId)
    const speciesShowdownId = toShowdownId(raw.baseSpecies ?? raw.name)
    const species = registryEntry(source, 'species', speciesShowdownId)
    if (registry.anchor.speciesId !== species.projectId) {
      throw new Error(`REGISTRY_ANCHOR_MISMATCH: ${registry.projectId} does not belong to ${species.projectId}`)
    }
    const abilities = Object.entries(raw.abilities).map(([slot, name]) => ({
      slot,
      abilityId: registryEntry(source, 'ability', toShowdownId(name)).projectId,
    })).sort((left, right) => (SLOT_ORDER.get(left.slot) ?? 99) - (SLOT_ORDER.get(right.slot) ?? 99))
    const requiredItemNames = [...(raw.requiredItems ?? []), ...(raw.requiredItem ? [raw.requiredItem] : [])].sort()
    return FormSchema.parse({
      formId: registry.projectId,
      speciesId: species.projectId,
      showdownId,
      canonicalName: { en: raw.name },
      formLabel: raw.forme ?? null,
      formKind: formKind(raw),
      types: raw.types.map(typeId),
      baseStats: raw.baseStats,
      abilities,
      generation: deriveSpeciesGeneration(raw.num, raw.forme),
      heightM: raw.heightm ?? null,
      weightKg: raw.weightkg ?? null,
      gender: raw.gender ?? null,
      battleOnly: raw.battleOnly !== undefined,
      changesFromFormIds: mapChangesFrom(source, raw.changesFrom),
      requiredItemNames,
      requiredAbilityId: raw.requiredAbility
        ? registryEntry(source, 'ability', toShowdownId(raw.requiredAbility)).projectId
        : null,
      growthRateOverride: null,
      availability: availability(raw.isNonstandard),
      dataStatus: 'complete',
    })
  }).sort((left, right) => left.formId.localeCompare(right.formId, 'en'))
}

function buildSpecies(data: ShowdownSourceData, source: VerifiedSource): Species[] {
  return SPECIES_IDS.map(showdownId => {
    const raw = requiredPokedexRecord(data, showdownId)
    const registry = registryEntry(source, 'species', showdownId)
    const expectedId = makeNationalSpeciesId(raw.num)
    if (registry.projectId !== expectedId || registry.anchor.nationalDexNumber !== raw.num) {
      throw new Error(`REGISTRY_ANCHOR_MISMATCH: ${showdownId} expected ${expectedId}/${raw.num}`)
    }
    const baseForm = registryEntry(source, 'form', showdownId)
    return SpeciesSchema.parse({
      speciesId: registry.projectId,
      nationalDexNumber: raw.num,
      showdownId,
      canonicalName: { en: raw.name },
      generation: deriveSpeciesGeneration(raw.num, raw.forme),
      defaultFormId: baseForm.projectId,
      growthRate: { id: null, status: 'unresolved' },
      availability: availability(raw.isNonstandard),
      dataStatus: 'complete',
    })
  }).sort((left, right) => left.nationalDexNumber - right.nationalDexNumber)
}

function buildAbilities(data: ShowdownSourceData, source: VerifiedSource, forms: Form[]): Ability[] {
  const ids = [...new Set(forms.flatMap(form => [
    ...form.abilities.map(slot => slot.abilityId),
    ...(form.requiredAbilityId ? [form.requiredAbilityId] : []),
  ]))].sort()
  return ids.map(abilityId => {
    const registry = source.registry.find(entity => entity.kind === 'ability' && entity.projectId === abilityId)
    if (!registry) throw new Error(`REGISTRY_PROPOSAL_REQUIRED: no Ability registry record for ${abilityId}`)
    const rawValue = data.abilities[registry.showdownId]
    if (rawValue === undefined) throw new Error(`Missing Showdown Ability record: ${registry.showdownId}`)
    const raw = parseAbilityRecord(rawValue, registry.showdownId)
    if (registry.anchor.officialNumber !== raw.num) {
      throw new Error(`REGISTRY_ANCHOR_MISMATCH: ${registry.showdownId} expected Ability #${raw.num}`)
    }
    return AbilitySchema.parse({
      abilityId: registry.projectId,
      officialNumber: raw.num,
      showdownId: registry.showdownId,
      canonicalName: { en: raw.name },
      generation: raw.gen ?? deriveAbilityGeneration(raw.num),
      availability: availability(raw.isNonstandard),
      dataStatus: 'complete',
    })
  })
}

function provenance(
  dataset: SmokeDataset,
  source: VerifiedSource,
): { identityMatches: IdentityMatch[]; valueProvenance: ValueProvenance[] } {
  const pokedex = sourceRef(source, 'data/pokedex.ts').sourceReferenceId
  const abilities = sourceRef(source, 'data/abilities.ts').sourceReferenceId
  const natures = sourceRef(source, 'data/natures.ts').sourceReferenceId
  const types = sourceRef(source, 'data/typechart.ts').sourceReferenceId
  const dexSpecies = sourceRef(source, 'sim/dex-species.ts').sourceReferenceId
  const dexAbilities = sourceRef(source, 'sim/dex-abilities.ts').sourceReferenceId
  const identityMatches: IdentityMatch[] = []
  const values: ValueProvenance[] = []
  const addValue = (entityId: string, fieldPath: string, sourceReferenceId: string, method: ValueProvenance['method']) => {
    values.push(ValueProvenanceSchema.parse({
      entityId,
      fieldPath,
      sourceReferenceId,
      method,
      mappingClass: 'automatic',
      selected: true,
    }))
  }

  for (const entity of dataset.types) {
    identityMatches.push(IdentityMatchSchema.parse({ entityId: entity.typeId, entityKind: 'type', showdownId: entity.showdownId, mappingClass: 'automatic', sourceReferenceId: types }))
    addValue(entity.typeId, '/canonicalName/en', types, 'source-literal')
    addValue(entity.typeId, '/damageTaken', types, 'project-normalization')
  }
  for (const entity of dataset.natures) {
    identityMatches.push(IdentityMatchSchema.parse({ entityId: entity.natureId, entityKind: 'nature', showdownId: entity.showdownId, mappingClass: 'automatic', sourceReferenceId: natures }))
    for (const field of ['/canonicalName/en', '/plusStat', '/minusStat', '/neutral']) addValue(entity.natureId, field, natures, field === '/neutral' ? 'project-normalization' : 'source-literal')
  }
  for (const entity of dataset.species) {
    identityMatches.push(IdentityMatchSchema.parse({ entityId: entity.speciesId, entityKind: 'species', showdownId: entity.showdownId, mappingClass: 'automatic', sourceReferenceId: pokedex }))
    for (const field of ['/speciesId', '/nationalDexNumber', '/canonicalName/en', '/defaultFormId']) addValue(entity.speciesId, field, pokedex, field === '/speciesId' || field === '/defaultFormId' ? 'project-normalization' : 'source-literal')
    addValue(entity.speciesId, '/generation', dexSpecies, 'showdown-dex-rule')
  }
  for (const entity of dataset.forms) {
    identityMatches.push(IdentityMatchSchema.parse({ entityId: entity.formId, entityKind: 'form', showdownId: entity.showdownId, mappingClass: entity.formKind === 'gmax' ? 'rule-based' : 'automatic', sourceReferenceId: pokedex }))
    for (const field of ['/formId', '/speciesId', '/canonicalName/en', '/types', '/baseStats', '/abilities', '/changesFromFormIds', '/requiredItemNames']) {
      addValue(entity.formId, field, pokedex, field === '/formId' || field === '/speciesId' || field === '/changesFromFormIds' ? 'project-normalization' : 'source-literal')
    }
    addValue(entity.formId, '/generation', dexSpecies, 'showdown-dex-rule')
  }
  for (const entity of dataset.abilities) {
    identityMatches.push(IdentityMatchSchema.parse({ entityId: entity.abilityId, entityKind: 'ability', showdownId: entity.showdownId, mappingClass: 'automatic', sourceReferenceId: abilities }))
    for (const field of ['/abilityId', '/officialNumber', '/canonicalName/en']) addValue(entity.abilityId, field, abilities, field === '/abilityId' ? 'project-normalization' : 'source-literal')
    addValue(entity.abilityId, '/generation', dexAbilities, 'showdown-dex-rule')
  }
  return {
    identityMatches: identityMatches.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    valueProvenance: values.sort((left, right) => `${left.entityId}${left.fieldPath}`.localeCompare(`${right.entityId}${right.fieldPath}`, 'en')),
  }
}

export async function buildSmokeArtifacts(
  cacheOverride?: string,
  localizationCacheOverride?: string,
): Promise<BuildArtifacts> {
  const source = await verifySource(cacheOverride, localizationCacheOverride)
  const data = await loadShowdownSource(source)
  const syclant = requiredPokedexRecord(data, 'syclant')
  if (syclant.num > 0) throw new Error('The CAP negative fixture unexpectedly has a positive national number')
  const forms = buildForms(data, source)
  const localizationSource = await loadPokemonDatasetZhSource(source)
  const moveBuild = buildMoves(data, source, localizationSource)
  const appearanceBuild = buildAppearances(data, source, localizationSource)
  const evolutionBuild = buildEvolutions(data, source, localizationSource, appearanceBuild.appearances)
  const dataset = SmokeDatasetSchema.parse({
    types: buildTypes(data),
    natures: buildNatures(data),
    species: buildSpecies(data, source),
    forms,
    abilities: buildAbilities(data, source, forms),
    growthRates: CANONICAL_GROWTH_RATES,
    moves: moveBuild.stableMoves,
    appearances: appearanceBuild.appearances,
    evolutions: evolutionBuild.evolutions,
  })
  const audit = provenance(dataset, source)
  const localization = buildLocalization(dataset, localizationSource)
  const growthRates = buildGrowthRates(dataset, localizationSource, localization.formMappings)
  const resolvedDataset = SmokeDatasetSchema.parse({
    ...dataset,
    species: growthRates.species,
    forms: growthRates.forms,
  })
  const resolvedLocalization: SmokeLocalization = {
    ...localization.localization,
    moves: { locale: 'zh-CN', entries: moveBuild.localizationEntries },
    evolutions: { locale: 'zh-CN', entries: evolutionBuild.localizationEntries },
    appearances: { locale: 'zh-CN', entries: appearanceBuild.localizationEntries },
  }
  return {
    dataset: resolvedDataset,
    source,
    identityMatches: [...audit.identityMatches, ...moveBuild.identityMatches, ...appearanceBuild.identityMatches, ...evolutionBuild.identityMatches]
      .sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    valueProvenance: [...audit.valueProvenance, ...localization.valueProvenance, ...growthRates.valueProvenance, ...moveBuild.valueProvenance, ...appearanceBuild.valueProvenance, ...evolutionBuild.valueProvenance]
      .sort((left, right) => `${left.entityId}${left.fieldPath}`.localeCompare(`${right.entityId}${right.fieldPath}`, 'en')),
    localization: resolvedLocalization,
    formLocalizationMappings: localization.formMappings,
    localizationMechanicsConflicts: localization.mechanicsConflicts,
    localizationProvenanceCount: localization.valueProvenance.length,
    growthRateAssignments: growthRates.assignments,
    growthRateConflicts: growthRates.conflicts,
    growthRateProvenanceCount: growthRates.valueProvenance.length,
    expectedUnresolvedGrowthRateCount: growthRates.expectedUnresolvedCount,
    quarantinedMoves: moveBuild.quarantinedMoves,
    moveConflicts: moveBuild.conflicts,
    moveMappingCounts: moveBuild.mappingCounts,
    evolutionConflicts: evolutionBuild.conflicts,
    evolutionMappingCounts: evolutionBuild.mappingCounts,
    appearanceMatches: appearanceBuild.appearanceMatches,
    appearanceConflicts: appearanceBuild.conflicts,
    appearanceMappingCounts: appearanceBuild.mappingCounts,
    appearanceSourceCoverage: appearanceBuild.sourceCoverage,
    scopeNotes: [
      'Stellar exists in the fixed TypeChart but is explicitly excluded from the 18-type smoke matrix.',
      'Non-attacking TypeChart keys such as brn, par, powder, and prankster are not emitted as Types.',
      'Meowstic Mega records present in the fixed snapshot are outside this explicitly limited fixture scope.',
      'The CAP negative fixture Syclant is checked but never receives a species:* ID or runtime entity.',
      'requiredItemNames is a smoke-only source value; canonical Item entities are deferred beyond this slice.',
      'No converter cache layer is implemented in this slice; every run verifies and reads the pinned source.',
      'GrowthRate formulas and level 1-100 experience calculations are explicitly deferred.',
      'Move output is restricted to twelve identity fixtures; Future Nihil Light is quarantined and excluded from stable runtime data.',
      'Evolution output is restricted to Eevee, Kadabra, and Milcery proof relationships; Alcremie appearance conditions remain partial where the fixed sources omit direction, duration, or time.',
      'Appearance output is restricted to 28 Unown glyphs and 63 Alcremie cream-by-sweet combinations; image binaries and unrelated cosmetics remain out of scope.',
    ],
  }
}

async function clearGeneratedOutput(outputRoot: string): Promise<void> {
  const generatedRoot = resolve(projectRoot, 'generated')
  const resolvedOutput = resolve(outputRoot)
  if (resolvedOutput !== generatedRoot) throw new Error(`Refusing to clear unexpected output path: ${resolvedOutput}`)
  await rm(resolvedOutput, { recursive: true, force: true })
  await mkdir(resolvedOutput, { recursive: true })
}

export async function runSmokePipeline(options: {
  cachePath?: string
  localizationCachePath?: string
  clean?: boolean
} = {}): Promise<PipelineResult> {
  const outputRoot = resolve(projectRoot, 'generated')
  if (options.clean ?? true) await clearGeneratedOutput(outputRoot)
  const artifacts = await buildSmokeArtifacts(options.cachePath, options.localizationCachePath)
  const validation = validateSmokeDataset(
    artifacts.dataset,
    artifacts.source.sourceReferences,
    artifacts.identityMatches,
    artifacts.valueProvenance,
    artifacts.localization,
  )
  const runtimeRoot = join(outputRoot, 'smoke-runtime')
  const runtimeValues: Array<[string, unknown]> = [
    ['types.json', artifacts.dataset.types],
    ['natures.json', artifacts.dataset.natures],
    ['species.json', artifacts.dataset.species],
    ['forms.json', artifacts.dataset.forms],
    ['abilities.json', artifacts.dataset.abilities],
    ['growth-rates.json', artifacts.dataset.growthRates],
    ['moves.json', artifacts.dataset.moves],
    ['appearances.json', artifacts.dataset.appearances],
    ['evolutions.json', artifacts.dataset.evolutions],
    ['localization/zh-CN.core.json', artifacts.localization.core],
    ['localization/zh-CN.abilities.json', artifacts.localization.abilities],
    ['localization/zh-CN.moves.json', artifacts.localization.moves],
    ['localization/zh-CN.evolutions.json', artifacts.localization.evolutions],
    ['localization/zh-CN.appearances.json', artifacts.localization.appearances],
  ]
  for (const [path, value] of runtimeValues) await writeJson(join(runtimeRoot, path), value)
  const fileEntries = []
  for (const [path] of runtimeValues) fileEntries.push({ path, sha256: await hashFile(join(runtimeRoot, path)) })
  fileEntries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const dataVersion = sha256(serializeJson(fileEntries))
  const manifest = SmokeManifestSchema.parse({
    schemaVersion: 1,
    dataVersion: `sha256:${dataVersion}`,
    sources: [
      { id: 'pokemon-showdown', commit: artifacts.source.commit },
      { id: 'pokemon-dataset-zh', commit: artifacts.source.localization.commit },
    ],
    files: fileEntries,
  })
  await writeJson(join(runtimeRoot, 'manifest.json'), manifest)
  await writeJson(join(outputRoot, 'provenance', 'source-references.json'), artifacts.source.sourceReferences)
  await writeJson(join(outputRoot, 'provenance', 'identity-matches.json'), artifacts.identityMatches)
  await writeJson(join(outputRoot, 'provenance', 'value-provenance.json'), artifacts.valueProvenance)
  await writeJson(join(outputRoot, 'reports', 'registry-proposals.json'), [])
  await writeJson(join(outputRoot, 'reports', 'localization-mapping.json'), {
    schemaVersion: 1,
    sourceCommit: artifacts.source.localization.commit,
    formMappings: artifacts.formLocalizationMappings,
    mappingCounts: {
      automatic: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'automatic').length,
      ruleBased: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'rule-based').length,
      unresolved: artifacts.formLocalizationMappings.filter(mapping => mapping.mappingClass === 'unresolved').length,
    },
    mechanicsConflicts: artifacts.localizationMechanicsConflicts,
    localizationProvenanceCount: artifacts.localizationProvenanceCount,
  })
  await writeJson(join(outputRoot, 'reports', 'growth-rate-mapping.json'), {
    schemaVersion: 1,
    sourceCommit: artifacts.source.localization.commit,
    assignments: artifacts.growthRateAssignments,
    conflicts: artifacts.growthRateConflicts,
    counts: {
      canonicalGrowthRates: artifacts.dataset.growthRates.length,
      speciesDefaults: artifacts.growthRateAssignments.filter(assignment => assignment.field === '/growthRate').length,
      formOverrides: artifacts.growthRateAssignments.filter(assignment => assignment.field === '/growthRateOverride').length,
      provenance: artifacts.growthRateProvenanceCount,
      conflicts: artifacts.growthRateConflicts.length,
      expectedUnresolved: artifacts.expectedUnresolvedGrowthRateCount,
    },
  })
  await writeJson(join(outputRoot, 'reports', 'move-mapping.json'), {
    schemaVersion: 1,
    sourceCommits: {
      pokemonShowdown: artifacts.source.commit,
      pokemonDatasetZh: artifacts.source.localization.commit,
    },
    fixtureCount: 12,
    stableRuntimeCount: artifacts.dataset.moves.length,
    mappingCounts: artifacts.moveMappingCounts,
    conflicts: artifacts.moveConflicts,
    quarantine: artifacts.quarantinedMoves,
  })
  await writeJson(join(outputRoot, 'reports', 'evolution-mapping.json'), {
    schemaVersion: 1,
    sourceCommits: {
      pokemonShowdown: artifacts.source.commit,
      pokemonDatasetZh: artifacts.source.localization.commit,
    },
    edgeCount: artifacts.dataset.evolutions.length,
    appearanceCount: artifacts.dataset.appearances.length,
    mappingCounts: artifacts.evolutionMappingCounts,
    conflicts: artifacts.evolutionConflicts,
  })
  await writeJson(join(outputRoot, 'reports', 'appearance-mapping.json'), {
    schemaVersion: 1,
    sourceCommits: {
      pokemonShowdown: artifacts.source.commit,
      pokemonDatasetZh: artifacts.source.localization.commit,
    },
    appearanceCount: artifacts.dataset.appearances.length,
    mappingCounts: artifacts.appearanceMappingCounts,
    sourceCoverage: artifacts.appearanceSourceCoverage,
    defaultPolicy: {
      unown: 'glyph-a-from-showdown-baseForme',
      alcremie: 'none-source-does-not-identify-a-default-sweet',
    },
    conflicts: artifacts.appearanceConflicts,
    matches: artifacts.appearanceMatches,
  })
  const report = SmokeReportSchema.parse({
    schemaVersion: 1,
    sourceCommits: {
      pokemonShowdown: artifacts.source.commit,
      pokemonDatasetZh: artifacts.source.localization.commit,
    },
    status: 'passed',
    counts: {
      types: artifacts.dataset.types.length,
      natures: artifacts.dataset.natures.length,
      species: artifacts.dataset.species.length,
      forms: artifacts.dataset.forms.length,
      abilities: artifacts.dataset.abilities.length,
      growthRates: artifacts.dataset.growthRates.length,
      moves: artifacts.dataset.moves.length,
      appearances: artifacts.dataset.appearances.length,
      evolutions: artifacts.dataset.evolutions.length,
    },
    scopeNotes: artifacts.scopeNotes,
    issues: validation.issues,
  })
  await writeJson(join(outputRoot, 'reports', 'smoke-validation.json'), report)
  const runtimeHashes: Record<string, string> = {}
  for (const [path] of [...runtimeValues, ['manifest.json', manifest] as [string, unknown]]) {
    runtimeHashes[path] = await hashFile(join(runtimeRoot, path))
  }
  return {
    dataset: artifacts.dataset,
    sourceCommits: {
      pokemonShowdown: artifacts.source.commit,
      pokemonDatasetZh: artifacts.source.localization.commit,
    },
    outputRoot,
    runtimeHashes,
  }
}
