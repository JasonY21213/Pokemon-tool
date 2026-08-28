import { performance } from 'node:perf_hooks'
import { readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { buildSmokeArtifacts } from './pipeline.ts'
import { parseGrowthRate } from './growth-rate.ts'
import { buildFormLocalizations, type StableFormLocalizationTarget } from './form-localization.ts'
import { buildTagArtifacts, emptyTagArtifacts, loadCuratedTags, type TagArtifacts } from './tags.ts'
import { serializeJson, writeJson } from './serialization.ts'
import {
  loadReviewDecisions,
  decisionTargetsMove,
  reviewedAbilityNumber,
  type ReviewDecision,
} from './review-decisions.ts'
import {
  getProjectRoot,
  loadShowdownSource,
  parseAbilityRecord,
  parseMoveRecord,
  parsePokedexRecord,
  sha256,
  verifySource,
  type RawPokedexRecord,
  type VerifiedSource,
} from './source.ts'

const FIXED_SHOWDOWN_SHA = '84d7ceb4f009928221fce7a00e711bab263c5f4e'
const FIXED_ZH_SHA = '82ce04e611d19a12556c3955125b048b36187f52'

const RawZhFormSchema = z.object({
  name: z.string().min(1),
  types: z.array(z.string().min(1)).min(1).max(2),
  abilities: z.array(z.object({ name: z.string().min(1), is_hidden: z.boolean() }).passthrough()),
  experience_100: z.string().min(1),
}).passthrough()

const RawZhPokemonSchema = z.object({
  name_zh: z.string().min(1),
  name_en: z.string().min(1),
  pokedex_id: z.string().regex(/^\d{4}$/),
  forms: z.array(RawZhFormSchema).min(1),
  evolution_chains: z.array(z.array(z.object({
    name: z.string().min(1), text: z.string().nullable(), from: z.string().nullable(),
  }).passthrough())).optional(),
  home_images: z.array(z.object({ name: z.string().min(1) }).passthrough()).optional(),
}).passthrough()

const ZhAbilitySchema = z.object({
  id: z.string().regex(/^\d{3}$/), name_zh: z.string().min(1), name_en: z.string().min(1),
  description: z.string(), generation: z.number().int().positive(),
}).passthrough()

const ZhMoveSchema = z.object({
  id: z.string().min(1), name_zh: z.string().min(1), name_en: z.string().min(1),
  type: z.string().min(1), category: z.string().min(1), power: z.string().min(1),
  accuracy: z.string().min(1), pp: z.string().min(1), description: z.string().optional(), generation: z.number().int().positive(),
}).passthrough()

const RawDexRowSchema = z.object({
  id: z.string().min(1), national_id: z.union([z.string(), z.number().int().positive()]).optional(), name: z.string().min(1),
}).passthrough()

type RawZhPokemon = z.infer<typeof RawZhPokemonSchema>
type RawZhAbility = z.infer<typeof ZhAbilitySchema>
type RawZhMove = z.infer<typeof ZhMoveSchema>
type MappingClass = 'automatic' | 'rule-based' | 'manual-exception' | 'unresolved'
type Severity = 'info' | 'warning' | 'error' | 'blocking'

export interface RegistryProposal {
  entityKind: 'species' | 'form' | 'ability' | 'move'
  proposedProjectId: string
  immutableAnchors: Record<string, string | number>
  showdownId: string
  reason: string
  status: 'proposed' | 'review-required'
}

export interface DryRunConflict {
  conflictId: string
  domain: 'identity' | 'mechanics' | 'growth' | 'localization' | 'appearance' | 'evolution' | 'dex' | 'provenance'
  severity: Severity
  entityId: string | null
  code: string
  message: string
}

interface SourceManifestEntry {
  source: 'pokemon-showdown' | 'pokemon-dataset-zh'
  path: string
  sha256: string
  byteLength: number
}

interface ZhPokemonRecord {
  path: string
  bytesHash: string
  byteLength: number
  value: RawZhPokemon
}

export interface FullDryRunArtifacts {
  sourceManifest: {
    schemaVersion: 1
    sources: Array<{ source: string; commit: string }>
    selectedFileCount: number
    selectedTreeHash: string
    files: SourceManifestEntry[]
  }
  species: Array<Record<string, unknown>>
  types: Array<Record<string, unknown>>
  natures: Array<Record<string, unknown>>
  forms: Array<Record<string, unknown>>
  abilities: Array<Record<string, unknown>>
  moves: Array<Record<string, unknown>>
  growthRates: Array<Record<string, unknown>>
  formGrowthRateOverrides: Array<Record<string, unknown>>
  appearances: unknown[]
  appearanceCandidates: Array<Record<string, unknown>>
  evolutions: Array<Record<string, unknown>>
  dexes: Array<Record<string, unknown>>
  dexEntries: Array<Record<string, unknown>>
  dexCandidates: Array<Record<string, unknown>>
  localization: {
    species: Array<Record<string, unknown>>
    forms: Array<Record<string, unknown>>
    abilities: Array<Record<string, unknown>>
    moves: Array<Record<string, unknown>>
  }
  tags: TagArtifacts['canonical']
  tagProvenance: TagArtifacts['provenance']
  tagMigrationReport: TagArtifacts['report']
  provenance: Array<Record<string, unknown>>
  conflicts: DryRunConflict[]
  registryProposals: RegistryProposal[]
  extraShowdownRecords: Array<Record<string, unknown>>
  summary: Record<string, unknown>
  performance: Record<string, number>
}

function toId(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '')
    .replaceAll('♀', 'F').replaceAll('♂', 'M').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function slug(value: string): string {
  const normalized = value.replaceAll('%', ' percent ').replaceAll('♀', ' female ').replaceAll('♂', ' male ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-+/g, '-')
  return normalized || 'unresolved'
}

function specialMoveToken(value: string): string {
  return slug(value).replace(/^g-max-/, 'gmax-')
}

function speciesId(num: number): string {
  return `species:${num.toString().padStart(4, '0')}`
}

function formToken(raw: RawPokedexRecord, showdownId: string): string {
  if (!raw.baseSpecies) return 'base'
  return slug(raw.forme ?? showdownId)
}

function formProjectId(num: number, raw: RawPokedexRecord, showdownId: string): string {
  return `form:${num.toString().padStart(4, '0')}:${formToken(raw, showdownId)}`
}

function defaultFullCachePath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(localAppData, 'pokemon-tool', 'upstream', 'pokemon-dataset-zh-json', FIXED_ZH_SHA)
}

async function listJson(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

async function readJsonBytes<T>(path: string, schema: z.ZodType<T>): Promise<{ value: T; hash: string; byteLength: number }> {
  const bytes = await readFile(path)
  return { value: schema.parse(JSON.parse(bytes.toString('utf8')) as unknown), hash: sha256(bytes), byteLength: bytes.length }
}

function conflict(
  target: DryRunConflict[], domain: DryRunConflict['domain'], severity: Severity,
  entityId: string | null, code: string, message: string,
): void {
  const token = `${domain}|${severity}|${entityId ?? ''}|${code}|${message}`
  const conflictId = `conflict:${sha256(token).slice(0, 16)}`
  if (!target.some(item => item.conflictId === conflictId)) {
    target.push({ conflictId, domain, severity, entityId, code, message })
  }
}

function mappingDistribution(values: Array<{ mappingClass: MappingClass }>): Record<MappingClass, number> {
  return {
    automatic: values.filter(value => value.mappingClass === 'automatic').length,
    'rule-based': values.filter(value => value.mappingClass === 'rule-based').length,
    'manual-exception': values.filter(value => value.mappingClass === 'manual-exception').length,
    unresolved: values.filter(value => value.mappingClass === 'unresolved').length,
  }
}

function mechanicsValue(raw: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null
  return Number(raw)
}

async function loadFullZh(cachePath: string): Promise<{
  pokemon: ZhPokemonRecord[]
  abilities: RawZhAbility[]
  moves: RawZhMove[]
  dexFiles: Array<{ path: string; rows: z.infer<typeof RawDexRowSchema>[]; hash: string; byteLength: number }>
  manifestEntries: SourceManifestEntry[]
}> {
  const pokemonDirectory = join(cachePath, 'data', 'pokemon')
  const pokemonNames = await listJson(pokemonDirectory)
  if (pokemonNames.length !== 1025) throw new Error(`FULL_ZH_POKEMON_COUNT: expected 1025, received ${pokemonNames.length}`)
  const pokemon: ZhPokemonRecord[] = []
  const manifestEntries: SourceManifestEntry[] = []
  for (const [index, name] of pokemonNames.entries()) {
    const path = `data/pokemon/${name}`
    const parsed = await readJsonBytes(join(pokemonDirectory, name), RawZhPokemonSchema)
    const expected = index + 1
    if (Number(parsed.value.pokedex_id) !== expected || !name.startsWith(parsed.value.pokedex_id)) {
      throw new Error(`FULL_ZH_NUMBER_SEQUENCE: ${name} does not represent #${expected}`)
    }
    pokemon.push({ path, bytesHash: parsed.hash, byteLength: parsed.byteLength, value: parsed.value })
    manifestEntries.push({ source: 'pokemon-dataset-zh', path, sha256: parsed.hash, byteLength: parsed.byteLength })
  }
  const abilityPath = 'data/ability_list.json'
  const abilityParsed = await readJsonBytes(join(cachePath, ...abilityPath.split('/')), z.array(ZhAbilitySchema))
  manifestEntries.push({ source: 'pokemon-dataset-zh', path: abilityPath, sha256: abilityParsed.hash, byteLength: abilityParsed.byteLength })
  const movePath = 'data/move_list.json'
  const moveParsed = await readJsonBytes(join(cachePath, ...movePath.split('/')), z.array(ZhMoveSchema))
  manifestEntries.push({ source: 'pokemon-dataset-zh', path: movePath, sha256: moveParsed.hash, byteLength: moveParsed.byteLength })
  const dexDirectory = join(cachePath, 'data', 'pokedex')
  const dexFiles = []
  for (const name of await listJson(dexDirectory)) {
    const path = `data/pokedex/${name}`
    const parsed = await readJsonBytes(join(dexDirectory, name), z.array(RawDexRowSchema))
    dexFiles.push({ path, rows: parsed.value, hash: parsed.hash, byteLength: parsed.byteLength })
    manifestEntries.push({ source: 'pokemon-dataset-zh', path, sha256: parsed.hash, byteLength: parsed.byteLength })
  }
  if (dexFiles.length !== 24) throw new Error(`FULL_ZH_DEX_COUNT: expected 24, received ${dexFiles.length}`)
  return { pokemon, abilities: abilityParsed.value, moves: moveParsed.value, dexFiles, manifestEntries }
}

async function selectedShowdownManifest(source: VerifiedSource): Promise<SourceManifestEntry[]> {
  return Promise.all(source.sourceReferences.filter(reference => reference.source === 'pokemon-showdown').map(async reference => ({
    source: 'pokemon-showdown' as const,
    path: reference.path,
    sha256: reference.sha256,
    byteLength: (await readFile(join(source.cachePath, ...reference.path.split('/')))).length,
  }))).then(entries => entries.sort((left, right) => left.path.localeCompare(right.path, 'en')))
}

function classifyForm(raw: RawPokedexRecord): MappingClass {
  if (!raw.baseSpecies) return 'automatic'
  if (raw.battleOnly || /gmax|tera/i.test(raw.forme ?? '')) return 'rule-based'
  return 'automatic'
}

function buildSpeciesAndForms(
  pokedex: Record<string, unknown>, zhPokemon: ZhPokemonRecord[], source: VerifiedSource,
  proposals: RegistryProposal[], conflicts: DryRunConflict[], provenance: Array<Record<string, unknown>>,
): { species: Array<Record<string, unknown>>; forms: Array<Record<string, unknown>>; extras: Array<Record<string, unknown>> } {
  const records: Array<{ showdownId: string; raw: RawPokedexRecord }> = []
  const extras: Array<Record<string, unknown>> = []
  for (const [showdownId, value] of Object.entries(pokedex)) {
    const candidateNum = typeof value === 'object' && value !== null && 'num' in value ? Number((value as { num: unknown }).num) : 0
    if (!Number.isInteger(candidateNum) || candidateNum < 1 || candidateNum > 1025) {
      extras.push({ showdownId, num: candidateNum, reason: 'outside-official-national-scope' })
      continue
    }
    const raw = parsePokedexRecord(value, showdownId)
    if (raw.isCosmeticForme) {
      extras.push({ showdownId, num: raw.num, reason: 'cosmetic-form-routed-to-appearance' })
      continue
    }
    records.push({ showdownId, raw })
  }
  const registryByExternal = new Map(source.registry.map(entry => [`${entry.kind}:${entry.showdownId}`, entry]))
  const byNum = new Map<number, Array<{ showdownId: string; raw: RawPokedexRecord }>>()
  for (const record of records) byNum.set(record.raw.num, [...(byNum.get(record.raw.num) ?? []), record])
  const species: Array<Record<string, unknown>> = []
  const forms: Array<Record<string, unknown>> = []
  const formIds = new Map<string, string>()
  for (let num = 1; num <= 1025; num += 1) {
    const candidates = byNum.get(num) ?? []
    const bases = candidates.filter(candidate => !candidate.raw.baseSpecies)
    const zh = zhPokemon[num - 1].value
    const id = speciesId(num)
    if (bases.length !== 1) {
      conflict(conflicts, 'identity', 'blocking', id, 'SPECIES_BASE_NON_UNIQUE', `National #${num} has ${bases.length} base Showdown records.`)
    }
    const base = bases[0]
    const mappingClass: MappingClass = base ? 'automatic' : 'unresolved'
    if (base && toId(base.raw.name) !== toId(zh.name_en)) {
      conflict(conflicts, 'identity', 'blocking', id, 'SPECIES_ENGLISH_MISMATCH', `${base.raw.name} != ${zh.name_en}`)
    }
    species.push({
      speciesId: id, nationalDexNumber: num, showdownId: base?.showdownId ?? null,
      canonicalName: { en: base?.raw.name ?? zh.name_en }, defaultFormId: `form:${num.toString().padStart(4, '0')}:base`,
      mappingClass, dataStatus: base ? 'complete' : 'unresolved',
    })
    provenance.push({ entityId: id, domain: 'species', sourcePaths: [base ? 'data/pokedex.ts' : null, zhPokemon[num - 1].path].filter(Boolean) })
    if (base && !registryByExternal.has(`species:${base.showdownId}`)) {
      proposals.push({ entityKind: 'species', proposedProjectId: id, immutableAnchors: { nationalDexNumber: num }, showdownId: base.showdownId, reason: 'Official National Dex Species discovered by full dry run.', status: 'proposed' })
    }
    for (const candidate of candidates) {
      const existing = registryByExternal.get(`form:${candidate.showdownId}`)
      const proposedId = existing?.projectId ?? formProjectId(num, candidate.raw, candidate.showdownId)
      const prior = formIds.get(proposedId)
      const mapping = prior && prior !== candidate.showdownId ? 'unresolved' : classifyForm(candidate.raw)
      if (mapping === 'unresolved') {
        conflict(conflicts, 'identity', 'blocking', proposedId, 'FORM_ID_COLLISION', `${prior} and ${candidate.showdownId} propose the same Form ID.`)
      }
      formIds.set(proposedId, candidate.showdownId)
      forms.push({
        formId: proposedId, speciesId: id, showdownId: candidate.showdownId,
        canonicalName: { en: candidate.raw.name }, formLabel: candidate.raw.forme ?? null,
        types: candidate.raw.types.map(type => `type:${type.toLowerCase()}`), baseStats: candidate.raw.baseStats,
        abilities: candidate.raw.abilities, battleOnly: Boolean(candidate.raw.battleOnly),
        changesFrom: candidate.raw.changesFrom ?? null, requiredItem: candidate.raw.requiredItem ?? null,
        requiredItems: candidate.raw.requiredItems ?? [], requiredAbility: candidate.raw.requiredAbility ?? null,
        mappingClass: mapping, dataStatus: mapping === 'unresolved' ? 'unresolved' : 'complete',
      })
      provenance.push({ entityId: proposedId, domain: 'form', sourcePaths: ['data/pokedex.ts'] })
      if (!existing) proposals.push({
        entityKind: 'form', proposedProjectId: proposedId,
        immutableAnchors: { speciesId: id, formToken: formToken(candidate.raw, candidate.showdownId) },
        showdownId: candidate.showdownId, reason: 'Official mechanically meaningful Showdown Form discovered by full dry run.',
        status: mapping === 'unresolved' ? 'review-required' : 'proposed',
      })
    }
  }
  return {
    species: species.sort((left, right) => Number(left.nationalDexNumber) - Number(right.nationalDexNumber)),
    forms: forms.sort((left, right) => String(left.formId).localeCompare(String(right.formId), 'en')),
    extras: extras.sort((left, right) => String(left.showdownId).localeCompare(String(right.showdownId), 'en')),
  }
}

function buildAbilities(
  data: Record<string, unknown>, zhRows: RawZhAbility[], source: VerifiedSource,
  proposals: RegistryProposal[], conflicts: DryRunConflict[], provenance: Array<Record<string, unknown>>,
  decisions: ReviewDecision[],
): { abilities: Array<Record<string, unknown>>; localization: Array<Record<string, unknown>> } {
  const zhByNumber = new Map(zhRows.map(row => [Number(row.id), row]))
  const registry = new Map(source.registry.filter(entry => entry.kind === 'ability').map(entry => [entry.showdownId, entry]))
  const abilities = []
  const localization = []
  const parsed = Object.entries(data).map(([showdownId, value]) => {
    const raw = parseAbilityRecord(value, showdownId)
    return { showdownId, raw, officialNumber: reviewedAbilityNumber(decisions, showdownId, raw.num) }
  })
    .filter(item => item.raw.num > 0)
  const numberCounts = new Map<number, number>()
  for (const item of parsed) numberCounts.set(item.officialNumber, (numberCounts.get(item.officialNumber) ?? 0) + 1)
  for (const { showdownId, raw, officialNumber } of parsed) {
    const hasNumberCollision = (numberCounts.get(officialNumber) ?? 0) > 1
    const numberWasReviewed = officialNumber !== raw.num
    const id = hasNumberCollision
      ? `ability:unresolved:${showdownId}`
      : `ability:${officialNumber.toString().padStart(4, '0')}`
    if (hasNumberCollision) {
      conflict(conflicts, 'identity', 'blocking', id, 'ABILITY_NUMBER_COLLISION', `Reviewed Ability number ${officialNumber} is shared by ${numberCounts.get(officialNumber)} records.`)
    }
    const zh = hasNumberCollision ? undefined : zhByNumber.get(officialNumber)
    let mappingClass: MappingClass = numberWasReviewed ? 'manual-exception' : 'automatic'
    if (hasNumberCollision) {
      mappingClass = 'unresolved'
    } else if (!zh) {
      mappingClass = 'unresolved'
      conflict(conflicts, 'localization', 'warning', id, 'ABILITY_ZH_MISSING', `No zh-CN Ability row for #${officialNumber} ${raw.name}.`)
    } else if (toId(zh.name_en) !== showdownId) {
      const isKnownGroupedName = (officialNumber === 266 || officialNumber === 267) && toId(zh.name_en) === 'asone'
      mappingClass = (officialNumber >= 301 && officialNumber <= 304) || isKnownGroupedName ? 'rule-based' : 'unresolved'
      if (mappingClass === 'unresolved') conflict(conflicts, 'identity', 'blocking', id, 'ABILITY_ENGLISH_MISMATCH', `${raw.name} != ${zh.name_en}`)
    }
    abilities.push({ abilityId: id, officialNumber, showdownId, canonicalName: { en: raw.name }, generation: raw.gen ?? zh?.generation ?? null, availability: raw.isNonstandard ?? null, mappingClass, dataStatus: mappingClass === 'unresolved' ? 'unresolved' : 'complete', reviewDecisionId: numberWasReviewed || (raw.num === 284 && ['vesselofruin', 'tabletsofruin', 'beadsofruin'].includes(showdownId)) ? 'review:ability:ruin-number-collision:0284' : undefined })
    if (zh) localization.push({ entityId: id, name: zh.name_zh, shortDescription: zh.description || undefined, mappingClass })
    provenance.push({ entityId: id, domain: 'ability', sourcePaths: ['data/abilities.ts', ...(zh ? ['data/ability_list.json'] : [])], reviewDecisionId: numberWasReviewed || raw.num === 284 ? 'review:ability:ruin-number-collision:0284' : undefined })
    if (!registry.has(showdownId)) proposals.push({ entityKind: 'ability', proposedProjectId: id, immutableAnchors: { officialNumber }, showdownId, reason: numberWasReviewed ? 'Official number selected by reviewed fixed-source consensus.' : 'Official numbered Ability discovered by full dry run.', status: mappingClass === 'unresolved' ? 'review-required' : 'proposed' })
  }
  return {
    abilities: abilities.sort((left, right) => Number(left.officialNumber) - Number(right.officialNumber)
      || String(left.abilityId).localeCompare(String(right.abilityId), 'en')),
    localization: localization.sort((left, right) => String(left.entityId).localeCompare(String(right.entityId), 'en')),
  }
}

function buildMoves(
  data: Record<string, unknown>, zhRows: RawZhMove[], source: VerifiedSource,
  proposals: RegistryProposal[], conflicts: DryRunConflict[], provenance: Array<Record<string, unknown>>,
  decisions: ReviewDecision[],
): { moves: Array<Record<string, unknown>>; localization: Array<Record<string, unknown>> } {
  const zhByEnglish = new Map<string, RawZhMove[]>()
  for (const row of zhRows) zhByEnglish.set(toId(row.name_en), [...(zhByEnglish.get(toId(row.name_en)) ?? []), row])
  const registry = new Map(source.registry.filter(entry => entry.kind === 'move').map(entry => [entry.showdownId, entry]))
  const zhByOfficialNumber = new Map<number, RawZhMove[]>()
  for (const row of zhRows) {
    const officialNumber = Number(row.id)
    if (Number.isInteger(officialNumber)) zhByOfficialNumber.set(officialNumber, [...(zhByOfficialNumber.get(officialNumber) ?? []), row])
  }
  const parsed = Object.entries(data).map(([showdownId, value]) => ({ showdownId, raw: parseMoveRecord(value, showdownId) }))
    .filter(item => item.raw.num > 0)
  const numberCounts = new Map<number, number>()
  for (const item of parsed) numberCounts.set(item.raw.num, (numberCounts.get(item.raw.num) ?? 0) + 1)
  const moves = []
  const localization = []
  const ids = new Set<string>()
  for (const { showdownId, raw } of parsed) {
    const numbered = raw.num < 1000 && numberCounts.get(raw.num) === 1
    const existing = registry.get(showdownId)
    const id = existing?.projectId ?? (numbered ? `move:${raw.num.toString().padStart(4, '0')}` : `move:special:${specialMoveToken(raw.name)}`)
    let mappingClass: MappingClass = numbered ? 'automatic' : 'rule-based'
    if (ids.has(id)) {
      mappingClass = 'unresolved'
      conflict(conflicts, 'identity', 'blocking', id, 'MOVE_ID_COLLISION', `Multiple Showdown Moves propose ${id}.`)
    }
    ids.add(id)
    const exactNumberMatches = zhByOfficialNumber.get(raw.num)
    const englishMatches = zhByEnglish.get(showdownId) ?? zhByEnglish.get(toId(raw.name)) ?? []
    const zhMatches = exactNumberMatches ?? englishMatches
    const zh = zhMatches.length === 1 ? zhMatches[0] : undefined
    if (!zh) {
      conflict(conflicts, 'localization', 'warning', id, zhMatches.length ? 'MOVE_ZH_AMBIGUOUS' : 'MOVE_ZH_MISSING', `${raw.name} matched ${zhMatches.length} zh-CN rows.`)
    }
    const mechanicsConflicts: string[] = []
    if (zh && englishMatches.length === 1 && englishMatches[0] === zh) {
      const power = mechanicsValue(zh.power)
      const pp = mechanicsValue(zh.pp)
      const accuracy = mechanicsValue(zh.accuracy)
      if (power !== null && raw.basePower > 0 && power !== raw.basePower) mechanicsConflicts.push('basePower')
      if (pp !== null && raw.pp > 0 && pp !== raw.pp) mechanicsConflicts.push('pp')
      if (accuracy !== null && raw.accuracy !== true && accuracy !== raw.accuracy) mechanicsConflicts.push('accuracy')
      if (toId(zh.type) && !toId(zh.type).includes(toId(raw.type))) {
        // Chinese type labels are not compared as English identity.
      }
    }
    const reviewedQuarantine = decisions.find(decision =>
      decision.decisionId === 'review:move:nihil-light:current-release-quarantine'
      && decision.status === 'accepted'
      && decisionTargetsMove(decision, id, showdownId))
    for (const field of mechanicsConflicts) {
      const severity: Severity = reviewedQuarantine ? 'warning' : showdownId === 'nihillight' ? 'error' : 'warning'
      const code = reviewedQuarantine ? 'MOVE_MECHANICS_CONFLICT_REVIEWED_QUARANTINE' : 'MOVE_MECHANICS_CONFLICT'
      conflict(conflicts, 'mechanics', severity, id, code, `${raw.name} differs from zh source at ${field}.${reviewedQuarantine ? ` Reviewed by ${reviewedQuarantine.decisionId}.` : ''}`)
    }
    const quarantined = raw.isNonstandard === 'Future' || mappingClass === 'unresolved' || mechanicsConflicts.some(() => showdownId === 'nihillight')
    moves.push({
      moveId: id, officialNumber: numbered ? raw.num : null, showdownId, canonicalName: { en: raw.name },
      typeId: `type:${raw.type.toLowerCase()}`, category: raw.category.toLowerCase(), basePower: raw.basePower,
      accuracy: raw.accuracy === true ? 'always' : raw.accuracy, pp: raw.pp, priority: raw.priority, target: raw.target,
      availability: raw.isNonstandard ?? 'current', mappingClass, dataStatus: quarantined ? 'quarantined' : 'complete', mechanicsConflictCount: mechanicsConflicts.length,
      reviewDecisionId: reviewedQuarantine?.decisionId,
    })
    if (zh && !quarantined) localization.push({ entityId: id, name: zh.name_zh, ...(zh.description ? { shortDescription: zh.description } : {}), mappingClass })
    provenance.push({ entityId: id, domain: 'move', sourcePaths: ['data/moves.ts', ...(zh ? ['data/move_list.json'] : [])], reviewDecisionId: reviewedQuarantine?.decisionId })
    if (!existing) proposals.push({ entityKind: 'move', proposedProjectId: id, immutableAnchors: numbered ? { officialNumber: raw.num } : { specialToken: specialMoveToken(raw.name) }, showdownId, reason: numbered ? 'Official numbered Move discovered by full dry run.' : 'Unnumbered/special Move requires reviewed stable ID.', status: mappingClass === 'unresolved' ? 'review-required' : 'proposed' })
  }
  return {
    moves: moves.sort((left, right) => String(left.moveId).localeCompare(String(right.moveId), 'en')),
    localization: localization.sort((left, right) => String(left.entityId).localeCompare(String(right.entityId), 'en')),
  }
}

function buildGrowth(zhPokemon: ZhPokemonRecord[], conflicts: DryRunConflict[], provenance: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const assignments = []
  for (const [index, record] of zhPokemon.entries()) {
    const id = speciesId(index + 1)
    const base = record.value.forms[0]
    let parsed: ReturnType<typeof parseGrowthRate>
    try {
      parsed = parseGrowthRate(base.experience_100)
    } catch (error) {
      conflict(conflicts, 'growth', 'error', id, 'GROWTH_RAW_UNRECOGNIZED', String(error))
      assignments.push({ entityId: id, status: 'unresolved', growthRateId: null, rawValue: base.experience_100, overrides: [] })
      continue
    }
    if (parsed.status === 'unresolved') conflict(conflicts, 'growth', 'warning', id, 'GROWTH_UNRESOLVED', `${record.value.name_en} has raw GrowthRate ${parsed.rawValue}.`)
    const overrides = []
    for (const [formIndex, form] of record.value.forms.slice(1).entries()) {
      const formParsed = parseGrowthRate(form.experience_100)
      if (formParsed.growthRateId !== parsed.growthRateId || formParsed.status !== parsed.status) {
        overrides.push({ sourceFormIndex: formIndex + 1, sourceFormName: form.name, growthRateId: formParsed.growthRateId, status: formParsed.status })
      }
    }
    assignments.push({ entityId: id, status: parsed.status, growthRateId: parsed.growthRateId, rawValue: parsed.rawValue, overrides })
    provenance.push({ entityId: id, domain: 'growth', sourcePaths: [record.path], sourcePointer: '/forms/0/experience_100' })
  }
  return assignments
}

function buildAppearanceCandidates(
  zhPokemon: ZhPokemonRecord[], formCounts: Map<number, number>, cosmeticEvidence: Map<number, number>,
): Array<Record<string, unknown>> {
  const candidates = []
  for (const [index, record] of zhPokemon.entries()) {
    const images = record.value.home_images ?? []
    if (index + 1 === 201 || index + 1 === 869) continue
    if (images.length <= 1) continue
    const structuredForms = record.value.forms.length
    const showdownForms = formCounts.get(index + 1) ?? 0
    const cosmetics = cosmeticEvidence.get(index + 1) ?? 0
    const classification = cosmetics > 0 ? 'likely-appearance'
      : structuredForms > 1 || showdownForms > 1 ? 'likely-form'
        : images.length > 2 ? 'ambiguous' : 'ignored-image-only'
    candidates.push({ speciesId: speciesId(index + 1), imageRecordCount: images.length, structuredFormCount: structuredForms, showdownFormCount: showdownForms, showdownCosmeticCount: cosmetics, classification })
  }
  return candidates.sort((left, right) => String(left.speciesId).localeCompare(String(right.speciesId), 'en'))
}

function buildEvolutions(
  forms: Array<Record<string, unknown>>, pokedex: Record<string, unknown>, zhPokemon: ZhPokemonRecord[],
  conflicts: DryRunConflict[], provenance: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const formByShowdown = new Map(forms.map(form => [String(form.showdownId), String(form.formId)]))
  const edges = []
  const ids = new Set<string>()
  for (const [targetId, value] of Object.entries(pokedex)) {
    const candidateNum = typeof value === 'object' && value !== null && 'num' in value ? Number((value as { num: unknown }).num) : 0
    if (candidateNum < 1 || candidateNum > 1025) continue
    const target = parsePokedexRecord(value, targetId)
    if (!target.prevo || !formByShowdown.has(targetId)) continue
    const sourceId = toId(target.prevo)
    const sourceFormId = formByShowdown.get(sourceId)
    const targetFormId = formByShowdown.get(targetId)
    const methodToken = slug([target.evoType, target.evoItem, target.evoCondition, target.evoLevel].filter(Boolean).join('-') || 'unspecified')
    const evolutionId = `evolution:${sourceId}:${targetId}:${methodToken}`
    let mappingClass: MappingClass = target.evoCondition ? 'rule-based' : 'automatic'
    if (!sourceFormId || !targetFormId || ids.has(evolutionId)) {
      mappingClass = 'unresolved'
      conflict(conflicts, 'evolution', 'error', evolutionId, 'EVOLUTION_GRAPH_UNRESOLVED', `${target.prevo} -> ${target.name} cannot be uniquely mapped.`)
    }
    ids.add(evolutionId)
    const rawFallbackCount = target.evoCondition ? 1 : 0
    edges.push({
      evolutionId, sourceFormId: sourceFormId ?? null, targetFormId: targetFormId ?? null,
      evoType: target.evoType ?? null, evoLevel: target.evoLevel ?? null, evoItem: target.evoItem ?? null,
      rawCondition: target.evoCondition ?? null, mappingClass, dataStatus: rawFallbackCount ? 'partial' : mappingClass === 'unresolved' ? 'unresolved' : 'complete',
    })
    provenance.push({ entityId: evolutionId, domain: 'evolution', sourcePaths: ['data/pokedex.ts', zhPokemon[candidateNum - 1].path] })
  }
  return edges.sort((left, right) => String(left.evolutionId).localeCompare(String(right.evolutionId), 'en'))
}

async function buildDexDomain(
  fullCache: string, dexFiles: Array<{ path: string; rows: z.infer<typeof RawDexRowSchema>[] }>,
  provenance: Array<Record<string, unknown>>, conflicts: DryRunConflict[],
): Promise<{ dexes: Array<Record<string, unknown>>; entries: Array<Record<string, unknown>>; candidates: Array<Record<string, unknown>> }> {
  const curated = JSON.parse(await readFile(join(getProjectRoot(), 'data-curated', 'dex-scopes.json'), 'utf8')) as {
    scopes: Array<{ dexId: string; sourceSelector: { path: string }; status: string; regionId: string | null; gameIds: string[]; versionIds: string[]; subdex: string | null; scope: string; localization: { name: string; shortLabel?: string } }>
  }
  const byPath = new Map(dexFiles.map(file => [file.path, file]))
  const dexes = []
  const entries = []
  const selectedPaths = new Set(curated.scopes.map(scope => scope.sourceSelector.path))
  for (const scope of curated.scopes) {
    const file = byPath.get(scope.sourceSelector.path)
    if (!file) throw new Error(`FULL_DEX_SOURCE_MISSING: ${scope.sourceSelector.path}`)
    if (scope.status !== 'resolved') {
      conflict(conflicts, 'dex', 'error', scope.dexId, 'DEX_SCOPE_QUARANTINED', `${scope.sourceSelector.path} remains unresolved with ${file.rows.length} rows.`)
      continue
    }
    dexes.push({ dexId: scope.dexId, regionId: scope.regionId, gameIds: scope.gameIds, versionIds: scope.versionIds, subdex: scope.subdex, scope: scope.scope, dataStatus: 'complete', localization: scope.localization })
    for (const row of file.rows) {
      const national = Number(row.national_id)
      if (!Number.isInteger(national) || national < 1 || national > 1025) {
        conflict(conflicts, 'dex', 'error', scope.dexId, 'DEX_ENTRY_NATIONAL_ID_INVALID', `${scope.sourceSelector.path} ${row.id} has ${row.national_id}.`)
        continue
      }
      entries.push({ dexId: scope.dexId, regionalNumber: row.id, regionalSortKey: String(row.id).padStart(8, '0'), speciesId: speciesId(national), formId: null, sourceName: row.name })
    }
    provenance.push({ entityId: scope.dexId, domain: 'dex', sourcePaths: ['data-curated/dex-scopes.json', scope.sourceSelector.path] })
  }
  const candidates = dexFiles.filter(file => !selectedPaths.has(file.path)).map(file => ({
    sourcePath: file.path, sourceFileName: basename(file.path, '.json'), rawRowCount: file.rows.length,
    uniqueRegionalNumberCount: new Set(file.rows.map(row => row.id)).size, status: 'candidate-scope-review-required',
  })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'en'))
  void fullCache
  return {
    dexes: dexes.sort((left, right) => String(left.dexId).localeCompare(String(right.dexId), 'en')),
    entries: entries.sort((left, right) => `${left.dexId}:${left.regionalSortKey}:${left.speciesId}`.localeCompare(`${right.dexId}:${right.regionalSortKey}:${right.speciesId}`, 'en')),
    candidates,
  }
}

function validateArtifacts(artifacts: Omit<FullDryRunArtifacts, 'summary' | 'performance'>, conflicts: DryRunConflict[]): void {
  if (artifacts.species.length !== 1025) conflict(conflicts, 'identity', 'blocking', null, 'SPECIES_COVERAGE', `Expected 1025 Species, received ${artifacts.species.length}.`)
  const numbers = artifacts.species.map(species => Number(species.nationalDexNumber))
  if (new Set(numbers).size !== 1025) conflict(conflicts, 'identity', 'blocking', null, 'SPECIES_NUMBER_DUPLICATE', 'National Dex numbers are not unique.')
  if (artifacts.species.some(species => Number(species.nationalDexNumber) <= 0)) conflict(conflicts, 'identity', 'blocking', null, 'CAP_IN_MAIN_NAMESPACE', 'Non-positive Species entered the main namespace.')
  const speciesIds = new Set(artifacts.species.map(species => String(species.speciesId)))
  const formIds = new Set(artifacts.forms.map(form => String(form.formId)))
  for (const form of artifacts.forms) if (!speciesIds.has(String(form.speciesId))) conflict(conflicts, 'provenance', 'blocking', String(form.formId), 'ORPHAN_FORM_SPECIES', `${form.speciesId} is missing.`)
  for (const entry of artifacts.dexEntries) {
    if (!speciesIds.has(String(entry.speciesId))) conflict(conflicts, 'provenance', 'blocking', String(entry.dexId), 'ORPHAN_DEX_SPECIES', `${entry.speciesId} is missing.`)
  }
  for (const edge of artifacts.evolutions) {
    if (edge.sourceFormId && !formIds.has(String(edge.sourceFormId))) conflict(conflicts, 'provenance', 'blocking', String(edge.evolutionId), 'ORPHAN_EVOLUTION_SOURCE', String(edge.sourceFormId))
    if (edge.targetFormId && !formIds.has(String(edge.targetFormId))) conflict(conflicts, 'provenance', 'blocking', String(edge.evolutionId), 'ORPHAN_EVOLUTION_TARGET', String(edge.targetFormId))
  }
  const proposalIds = artifacts.registryProposals.map(proposal => proposal.proposedProjectId)
  if (new Set(proposalIds).size !== proposalIds.length) conflict(conflicts, 'identity', 'blocking', null, 'REGISTRY_PROPOSAL_DUPLICATE', 'Registry proposals contain duplicate project IDs.')
  const localizationSpeciesIds = new Set(artifacts.localization.species.map(entry => String(entry.entityId)))
  for (const id of speciesIds) if (!localizationSpeciesIds.has(id)) conflict(conflicts, 'localization', 'blocking', id, 'SPECIES_ZH_REQUIRED_MISSING', 'Required zh-CN Species name is missing.')
  const localizationFormIds = new Set(artifacts.localization.forms.map(entry => String(entry.entityId)))
  const missingFormLocalization = artifacts.forms.filter(form => !localizationFormIds.has(String(form.formId))).length
  if (missingFormLocalization > 0) {
    conflict(conflicts, 'localization', 'warning', null, 'FORM_ZH_MAPPING_INCOMPLETE', `${missingFormLocalization} Form names require reliable zh-CN mapping review.`)
  }
}

function summaryFor(artifacts: Omit<FullDryRunArtifacts, 'summary' | 'performance'>): Record<string, unknown> {
  const bySeverity = Object.fromEntries((['info', 'warning', 'error', 'blocking'] as const).map(severity => [severity, artifacts.conflicts.filter(item => item.severity === severity).length]))
  const byDomain = Object.fromEntries((['identity', 'mechanics', 'growth', 'localization', 'appearance', 'evolution', 'dex', 'provenance'] as const).map(domain => [domain, artifacts.conflicts.filter(item => item.domain === domain).length]))
  const growthOverrides = artifacts.growthRates.reduce((sum, assignment) => sum + (Array.isArray(assignment.overrides) ? assignment.overrides.length : 0), 0)
  const abilityNumberCounts = new Map<number, number>()
  for (const ability of artifacts.abilities) abilityNumberCounts.set(Number(ability.officialNumber), (abilityNumberCounts.get(Number(ability.officialNumber)) ?? 0) + 1)
  const duplicateDisplayNameGroups = (values: Array<Record<string, unknown>>): number => {
    const counts = new Map<string, number>()
    for (const value of values) counts.set(String(value.name), (counts.get(String(value.name)) ?? 0) + 1)
    return [...counts.values()].filter(count => count > 1).length
  }
  const formLocalizationIds = new Set(artifacts.localization.forms.map(entry => String(entry.entityId)))
  return {
    schemaVersion: 1,
    dryRun: true,
    sourceCommits: { pokemonShowdown: FIXED_SHOWDOWN_SHA, pokemonDatasetZh: FIXED_ZH_SHA },
    species: { expected: 1025, matched: artifacts.species.filter(item => item.dataStatus === 'complete').length, unresolved: artifacts.species.filter(item => item.dataStatus === 'unresolved').length, extraExcluded: artifacts.extraShowdownRecords.length },
    forms: { total: artifacts.forms.length, ...mappingDistribution(artifacts.forms as Array<{ mappingClass: MappingClass }>), excludedCosmetic: artifacts.extraShowdownRecords.filter(item => item.reason === 'cosmetic-form-routed-to-appearance').length, excludedNonofficial: artifacts.extraShowdownRecords.filter(item => item.reason === 'outside-official-national-scope').length },
    abilities: { total: artifacts.abilities.length, ...mappingDistribution(artifacts.abilities as Array<{ mappingClass: MappingClass }>), officialNumberCollisionGroups: [...abilityNumberCounts.values()].filter(count => count > 1).length, localizationComplete: artifacts.localization.abilities.length, localizationMissing: artifacts.abilities.length - artifacts.localization.abilities.length },
    moves: { total: artifacts.moves.length, stable: artifacts.moves.filter(item => item.dataStatus === 'complete').length, quarantined: artifacts.moves.filter(item => item.dataStatus === 'quarantined').length, future: artifacts.moves.filter(item => item.availability === 'Future').length, past: artifacts.moves.filter(item => item.availability === 'Past').length, officialNumbered: artifacts.moves.filter(item => item.officialNumber !== null).length, unnumberedSpecial: artifacts.moves.filter(item => item.officialNumber === null).length, ...mappingDistribution(artifacts.moves as Array<{ mappingClass: MappingClass }>), mechanicsConflicts: artifacts.conflicts.filter(item => item.domain === 'mechanics').length, localizationMissing: artifacts.moves.length - artifacts.localization.moves.length },
    growthRate: { resolved: artifacts.growthRates.filter(item => item.status === 'resolved').length, unresolved: artifacts.growthRates.filter(item => item.status === 'unresolved').length, overrides: growthOverrides, sourceInternalInconsistencies: artifacts.conflicts.filter(item => item.domain === 'growth' && item.severity === 'error').length, unknownRawValues: [...new Set(artifacts.growthRates.filter(item => item.status === 'unresolved').map(item => String(item.rawValue)))].sort() },
    appearance: { generated: artifacts.appearances.length, candidateDiscoveries: artifacts.appearanceCandidates.length, discoveryDistribution: Object.fromEntries(['likely-appearance', 'likely-form', 'ambiguous', 'ignored-image-only'].map(classification => [classification, artifacts.appearanceCandidates.filter(item => item.classification === classification).length])) },
    evolution: { totalEdges: artifacts.evolutions.length, ...mappingDistribution(artifacts.evolutions as Array<{ mappingClass: MappingClass }>), partial: artifacts.evolutions.filter(item => item.dataStatus === 'partial').length, unresolvedEdges: artifacts.evolutions.filter(item => item.dataStatus === 'unresolved').length, rawFallbackCount: artifacts.evolutions.filter(item => item.rawCondition).length, graphConflicts: artifacts.conflicts.filter(item => item.domain === 'evolution').length },
    dex: { resolved: artifacts.dexes.length, candidate: artifacts.dexCandidates.length, unresolved: artifacts.conflicts.filter(item => item.code === 'DEX_SCOPE_QUARANTINED').length, quarantined: artifacts.conflicts.filter(item => item.code === 'DEX_SCOPE_QUARANTINED').length, stableEntryCount: artifacts.dexEntries.length, candidateRawRows: artifacts.dexCandidates.map(item => ({ sourcePath: item.sourcePath, rawRowCount: item.rawRowCount })) },
    localization: {
      species: { complete: artifacts.localization.species.length, missing: artifacts.species.length - artifacts.localization.species.length, duplicateDisplayNameGroups: duplicateDisplayNameGroups(artifacts.localization.species) },
      forms: { complete: artifacts.localization.forms.length, missing: artifacts.forms.filter(form => !formLocalizationIds.has(String(form.formId))).length, ruleBasedNames: artifacts.localization.forms.filter(item => item.mappingClass === 'rule-based').length, unresolved: artifacts.forms.length - artifacts.localization.forms.length, duplicateDisplayNameGroups: duplicateDisplayNameGroups(artifacts.localization.forms) },
      abilities: { complete: artifacts.localization.abilities.length, missing: artifacts.abilities.length - artifacts.localization.abilities.length, duplicateDisplayNameGroups: duplicateDisplayNameGroups(artifacts.localization.abilities) },
      moves: { complete: artifacts.localization.moves.length, missing: artifacts.moves.length - artifacts.localization.moves.length, duplicateDisplayNameGroups: duplicateDisplayNameGroups(artifacts.localization.moves) },
    },
    tags: {
      definitions: artifacts.tags.definitions.length,
      assignments: artifacts.tags.assignments.length,
      species: artifacts.tags.assignments.filter(item => item.entityId.startsWith('species:')).length,
      forms: artifacts.tags.assignments.filter(item => item.entityId.startsWith('form:')).length,
      unresolved: artifacts.tagProvenance.unresolved.length,
      byTag: Object.fromEntries(artifacts.tags.definitions.map(definition => [definition.tagId, artifacts.tags.assignments.filter(item => item.tagId === definition.tagId).length])),
    },
    provenanceCount: artifacts.provenance.length,
    conflicts: { bySeverity, byDomain, total: artifacts.conflicts.length },
    registryProposals: Object.fromEntries(['species', 'form', 'ability', 'move'].map(kind => [kind, artifacts.registryProposals.filter(item => item.entityKind === kind).length])),
    selectedSourceFiles: artifacts.sourceManifest.selectedFileCount,
  }
}

export async function buildFullDryRun(options: { fullCachePath?: string; skipTags?: boolean } = {}): Promise<FullDryRunArtifacts> {
  const start = performance.now()
  let stage = performance.now()
  const source = await verifySource()
  if (source.commit !== FIXED_SHOWDOWN_SHA || source.localization.commit !== FIXED_ZH_SHA) throw new Error('FULL_DRY_RUN_SOURCE_SHA_CHANGED')
  const fullCache = resolve(options.fullCachePath ?? process.env.POKEMON_TOOL_DATASET_ZH_FULL_CACHE ?? defaultFullCachePath())
  const fullZh = await loadFullZh(fullCache)
  const sourceVerifyMs = performance.now() - stage
  stage = performance.now()
  const showdown = await loadShowdownSource(source)
  const reviewDecisions = await loadReviewDecisions()
  const parseMs = performance.now() - stage
  stage = performance.now()
  const proposals: RegistryProposal[] = []
  const conflicts: DryRunConflict[] = []
  const provenance: Array<Record<string, unknown>> = []
  const speciesForms = buildSpeciesAndForms(showdown.pokedex, fullZh.pokemon, source, proposals, conflicts, provenance)
  const abilityBuild = buildAbilities(showdown.abilities, fullZh.abilities, source, proposals, conflicts, provenance, reviewDecisions)
  const moveBuild = buildMoves(showdown.moves, fullZh.moves, source, proposals, conflicts, provenance, reviewDecisions)
  const growthRates = buildGrowth(fullZh.pokemon, conflicts, provenance)
  const smoke = await buildSmokeArtifacts()
  const formCounts = new Map<number, number>()
  const cosmeticEvidence = new Map<number, number>()
  for (const form of speciesForms.forms) formCounts.set(Number(String(form.speciesId).slice(8)), (formCounts.get(Number(String(form.speciesId).slice(8))) ?? 0) + 1)
  for (const species of speciesForms.species) {
    const showdownId = String(species.showdownId ?? '')
    if (!showdownId) continue
    const raw = parsePokedexRecord(showdown.pokedex[showdownId], showdownId)
    cosmeticEvidence.set(Number(species.nationalDexNumber), raw.cosmeticFormes?.length ?? 0)
  }
  const appearanceCandidates = buildAppearanceCandidates(fullZh.pokemon, formCounts, cosmeticEvidence)
  const evolutions = buildEvolutions(speciesForms.forms, showdown.pokedex, fullZh.pokemon, conflicts, provenance)
  const dexBuild = await buildDexDomain(fullCache, fullZh.dexFiles, provenance, conflicts)
  const localizationSpecies = fullZh.pokemon.map((record, index) => ({ entityId: speciesId(index + 1), name: record.value.name_zh, sourcePath: record.path }))
  const formLocalization = buildFormLocalizations(
    speciesForms.forms as unknown as StableFormLocalizationTarget[],
    fullZh.pokemon,
    fullZh.abilities,
  )
  const localizationForms = formLocalization.entries
  const tagArtifacts = options.skipTags
    ? emptyTagArtifacts()
    : buildTagArtifacts(await loadCuratedTags(), { species: speciesForms.species, forms: speciesForms.forms })
  const showdownManifest = await selectedShowdownManifest(source)
  const manifestFiles = [...showdownManifest, ...fullZh.manifestEntries].sort((left, right) => `${left.source}:${left.path}`.localeCompare(`${right.source}:${right.path}`, 'en'))
  const sourceManifest = {
    schemaVersion: 1 as const,
    sources: [{ source: 'pokemon-showdown', commit: FIXED_SHOWDOWN_SHA }, { source: 'pokemon-dataset-zh', commit: FIXED_ZH_SHA }],
    selectedFileCount: manifestFiles.length,
    selectedTreeHash: sha256(serializeJson(manifestFiles)),
    files: manifestFiles,
  }
  proposals.sort((left, right) => `${left.entityKind}:${left.proposedProjectId}`.localeCompare(`${right.entityKind}:${right.proposedProjectId}`, 'en'))
  provenance.sort((left, right) => `${left.entityId}:${left.domain}`.localeCompare(`${right.entityId}:${right.domain}`, 'en'))
  const mappingMs = performance.now() - stage
  stage = performance.now()
  const partial = {
    sourceManifest, types: smoke.dataset.types as unknown as Array<Record<string, unknown>>, natures: smoke.dataset.natures as unknown as Array<Record<string, unknown>>, species: speciesForms.species, forms: speciesForms.forms,
    abilities: abilityBuild.abilities, moves: moveBuild.moves, growthRates, formGrowthRateOverrides: smoke.dataset.forms.filter(form => form.growthRateOverride !== null).map(form => ({ formId: form.formId, growthRateOverride: form.growthRateOverride })),
    appearances: smoke.dataset.appearances, appearanceCandidates, evolutions,
    dexes: dexBuild.dexes, dexEntries: dexBuild.entries, dexCandidates: dexBuild.candidates,
    localization: { species: localizationSpecies, forms: localizationForms, abilities: abilityBuild.localization, moves: moveBuild.localization },
    tags: tagArtifacts.canonical, tagProvenance: tagArtifacts.provenance, tagMigrationReport: tagArtifacts.report,
    provenance, conflicts, registryProposals: proposals, extraShowdownRecords: speciesForms.extras,
  }
  validateArtifacts(partial, conflicts)
  conflicts.sort((left, right) => `${left.severity}:${left.domain}:${left.conflictId}`.localeCompare(`${right.severity}:${right.domain}:${right.conflictId}`, 'en'))
  const validationMs = performance.now() - stage
  return {
    ...partial,
    summary: summaryFor(partial),
    performance: {
      sourceVerifyMs: Number(sourceVerifyMs.toFixed(3)), parseMs: Number(parseMs.toFixed(3)),
      mappingMs: Number(mappingMs.toFixed(3)), validationMs: Number(validationMs.toFixed(3)),
      emissionMs: 0, totalMs: Number((performance.now() - start).toFixed(3)), peakRssBytes: process.memoryUsage().rss,
    },
  }
}

export async function emitFullDryRun(artifacts: FullDryRunArtifacts): Promise<{ outputRoot: string; deterministicHashes: Record<string, string> }> {
  const outputRoot = resolve(getProjectRoot(), 'generated', 'full-dry-run')
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  const deterministic: Array<[string, unknown]> = [
    ['canonical-candidates/types.json', artifacts.types],
    ['canonical-candidates/natures.json', artifacts.natures],
    ['canonical-candidates/species.json', artifacts.species],
    ['canonical-candidates/forms.json', artifacts.forms],
    ['canonical-candidates/abilities.json', artifacts.abilities],
    ['canonical-candidates/moves.json', artifacts.moves],
    ['canonical-candidates/growth-rates.json', artifacts.growthRates],
    ['canonical-candidates/form-growth-rate-overrides.json', artifacts.formGrowthRateOverrides],
    ['canonical-candidates/appearances.json', artifacts.appearances],
    ['canonical-candidates/evolutions.json', artifacts.evolutions],
    ['canonical-candidates/dexes.json', artifacts.dexes],
    ['canonical-candidates/dex-entries.json', artifacts.dexEntries],
    ['canonical-candidates/localization.json', artifacts.localization],
    ['canonical-candidates/tags.json', artifacts.tags],
    ['provenance/source-manifest.json', artifacts.sourceManifest],
    ['provenance/candidate-provenance.json', artifacts.provenance],
    ['provenance/tag-assignments.json', artifacts.tagProvenance],
    ['reports/summary.json', artifacts.summary],
    ['reports/conflicts.json', artifacts.conflicts],
    ['reports/extra-showdown-records.json', artifacts.extraShowdownRecords],
    ['reports/appearance-candidates.json', artifacts.appearanceCandidates],
    ['reports/dex-candidates.json', artifacts.dexCandidates],
    ['reports/tag-migration.json', artifacts.tagMigrationReport],
    ['id-registry-proposals.json', artifacts.registryProposals],
    ['reports/registry-diff.json', {
      addProposalCount: artifacts.registryProposals.length,
      renameCandidates: [],
      removalCandidates: [],
      existingRegistryMutationCount: 0,
    }],
  ]
  const deterministicHashes: Record<string, string> = {}
  const emissionStart = performance.now()
  for (const [path, value] of deterministic) {
    await writeJson(join(outputRoot, path), value)
    deterministicHashes[path] = sha256(await readFile(join(outputRoot, path)))
  }
  const runtimePreview = {
    schemaVersion: 1, dryRun: true, publishable: false,
    sourceTreeHash: artifacts.sourceManifest.selectedTreeHash,
    candidateHashes: Object.fromEntries(Object.entries(deterministicHashes).filter(([path]) => path.startsWith('canonical-candidates/'))),
  }
  await writeJson(join(outputRoot, 'runtime-preview', 'manifest.json'), runtimePreview)
  deterministicHashes['runtime-preview/manifest.json'] = sha256(await readFile(join(outputRoot, 'runtime-preview', 'manifest.json')))
  const emissionMs = performance.now() - emissionStart
  await writeJson(join(outputRoot, 'run-metadata', 'performance.json'), {
    ...artifacts.performance,
    emissionMs: Number(emissionMs.toFixed(3)),
    totalMs: Number((Number(artifacts.performance.totalMs) + emissionMs).toFixed(3)),
  })
  return { outputRoot, deterministicHashes: Object.fromEntries(Object.entries(deterministicHashes).sort(([left], [right]) => left.localeCompare(right, 'en'))) }
}

export async function runFullDryRun(options: { fullCachePath?: string; skipTags?: boolean } = {}): Promise<{
  artifacts: FullDryRunArtifacts
  outputRoot: string
  deterministicHashes: Record<string, string>
}> {
  const artifacts = await buildFullDryRun(options)
  const emission = await emitFullDryRun(artifacts)
  return { artifacts, ...emission }
}
