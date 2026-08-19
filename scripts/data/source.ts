import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  Sha256Schema,
  SourceCommitSchema,
  SourceReferenceSchema,
  type SourceReference,
} from '../../src/lib/data-model/smoke-schema.ts'

const SelectedPathSchema = z.object({
  path: z.string().min(1),
  sha256: Sha256Schema,
}).strict()

const ShowdownSourceLockSchema = z.object({
    sourceId: z.literal('pokemon-showdown'),
    repo: z.literal('https://github.com/smogon/pokemon-showdown'),
    commit: SourceCommitSchema,
    acquisition: z.literal('external-sparse-cache'),
    cacheEnvironmentVariable: z.literal('POKEMON_TOOL_SHOWDOWN_CACHE'),
    selectedPaths: z.array(SelectedPathSchema).min(1),
}).strict()

const PokemonDatasetZhSourceLockSchema = z.object({
  sourceId: z.literal('pokemon-dataset-zh'),
  repo: z.literal('https://github.com/42arch/pokemon-dataset-zh'),
  commit: SourceCommitSchema,
  acquisition: z.literal('external-object-cache'),
  cacheEnvironmentVariable: z.literal('POKEMON_TOOL_DATASET_ZH_CACHE'),
  selectedPaths: z.array(SelectedPathSchema).min(1),
}).strict()

const SourceLockSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.tuple([ShowdownSourceLockSchema, PokemonDatasetZhSourceLockSchema]),
}).strict()

const RegistryEntitySchema = z.object({
  kind: z.enum(['species', 'form', 'ability']),
  projectId: z.string().min(1),
  anchor: z.record(z.string(), z.union([z.string(), z.number()])),
  showdownId: z.string().regex(/^[a-z0-9]+$/),
  status: z.literal('active'),
  firstSeen: SourceCommitSchema,
  lastSeen: SourceCommitSchema,
}).strict()

const RegistrySchema = z.object({
  schemaVersion: z.literal(1),
  sourceCommit: SourceCommitSchema,
  entities: z.array(RegistryEntitySchema),
}).strict()

const RawStatBlockSchema = z.object({
  hp: z.number().int().positive(),
  atk: z.number().int().positive(),
  def: z.number().int().positive(),
  spa: z.number().int().positive(),
  spd: z.number().int().positive(),
  spe: z.number().int().positive(),
}).strict()

const RawPokedexRecordSchema = z.object({
  num: z.number().int(),
  name: z.string().min(1),
  baseSpecies: z.string().min(1).optional(),
  forme: z.string().min(1).optional(),
  types: z.array(z.string().min(1)).min(1).max(2),
  baseStats: RawStatBlockSchema,
  abilities: z.record(z.string(), z.string().min(1)),
  heightm: z.number().nonnegative().optional(),
  weightkg: z.number().nonnegative().optional(),
  gender: z.enum(['M', 'F', 'N']).optional(),
  isNonstandard: z.string().optional(),
  battleOnly: z.union([z.string(), z.array(z.string())]).optional(),
  changesFrom: z.string().min(1).optional(),
  requiredItem: z.string().min(1).optional(),
  requiredItems: z.array(z.string().min(1)).optional(),
  requiredAbility: z.string().min(1).optional(),
}).passthrough()

const RawAbilityRecordSchema = z.object({
  num: z.number().int(),
  name: z.string().min(1),
  gen: z.number().int().positive().optional(),
  isNonstandard: z.string().optional(),
}).passthrough()

const RawNatureRecordSchema = z.object({
  name: z.string().min(1),
  plus: z.enum(['atk', 'def', 'spa', 'spd', 'spe']).optional(),
  minus: z.enum(['atk', 'def', 'spa', 'spd', 'spe']).optional(),
}).strict()

const RawTypeRecordSchema = z.object({
  damageTaken: z.record(z.string(), z.number().int().min(0).max(3)),
}).passthrough()

export type RawPokedexRecord = z.infer<typeof RawPokedexRecordSchema>
export type RawAbilityRecord = z.infer<typeof RawAbilityRecordSchema>
export type RawNatureRecord = z.infer<typeof RawNatureRecordSchema>
export type RawTypeRecord = z.infer<typeof RawTypeRecordSchema>
export type RegistryEntity = z.infer<typeof RegistryEntitySchema>

export interface ShowdownSourceData {
  pokedex: Record<string, unknown>
  abilities: Record<string, unknown>
  natures: Record<string, RawNatureRecord>
  typeChart: Record<string, RawTypeRecord>
}

export interface VerifiedSource {
  cachePath: string
  commit: string
  sourceReferences: SourceReference[]
  sourceReferenceByPath: ReadonlyMap<string, SourceReference>
  localization: {
    cachePath: string
    commit: string
    sourceReferences: SourceReference[]
    sourceReferenceByPath: ReadonlyMap<string, SourceReference>
  }
  registry: RegistryEntity[]
}

const projectRoot = resolve(import.meta.dirname, '../..')

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function defaultCachePath(commit: string): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(localAppData, 'pokemon-tool', 'upstream', 'pokemon-showdown', commit)
}

function defaultLocalizationCachePath(commit: string): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(localAppData, 'pokemon-tool', 'upstream', 'pokemon-dataset-zh', commit)
}

function makeSourceReference(
  source: 'pokemon-showdown' | 'pokemon-dataset-zh',
  commit: string,
  path: string,
  fileHash: string,
): SourceReference {
  const identity = JSON.stringify({ source, commit, path, sha256: fileHash })
  return SourceReferenceSchema.parse({
    sourceReferenceId: `src:${source}:${sha256(identity).slice(0, 16)}`,
    source,
    commit,
    path,
    sha256: fileHash,
  })
}

function verifyGitRevision(cachePath: string, expectedCommit: string): void {
  const safePath = cachePath.replaceAll('\\', '/')
  let actualCommit: string
  try {
    actualCommit = execFileSync(
      'git',
      ['-c', `safe.directory=${safePath}`, '-C', cachePath, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    actualCommit = execFileSync(
      'git',
      ['-c', `safe.directory=${safePath}`, '-C', cachePath, 'rev-parse', 'FETCH_HEAD'],
      { encoding: 'utf8' },
    ).trim()
  }
  if (actualCommit !== expectedCommit) {
    throw new Error(`Source SHA mismatch at external cache: expected ${expectedCommit}, received ${actualCommit}`)
  }
}

async function verifySelectedFiles(
  sourceName: 'pokemon-showdown' | 'pokemon-dataset-zh',
  cachePath: string,
  commit: string,
  selectedPaths: Array<z.infer<typeof SelectedPathSchema>>,
): Promise<SourceReference[]> {
  const sourceReferences: SourceReference[] = []
  for (const selected of selectedPaths) {
    const bytes = await readFile(join(cachePath, ...selected.path.split('/')))
    const actualHash = sha256(bytes)
    if (actualHash !== selected.sha256) {
      throw new Error(`Source hash mismatch for ${selected.path}: expected ${selected.sha256}, received ${actualHash}`)
    }
    sourceReferences.push(makeSourceReference(sourceName, commit, selected.path, actualHash))
  }
  return sourceReferences
}

export async function verifySource(
  cacheOverride?: string,
  localizationCacheOverride?: string,
): Promise<VerifiedSource> {
  const lock = SourceLockSchema.parse(await readJson(join(projectRoot, 'data-source', 'source-lock.json')))
  const showdown = lock.sources[0]
  const localizationSource = lock.sources[1]
  const cachePath = resolve(cacheOverride ?? process.env[showdown.cacheEnvironmentVariable] ?? defaultCachePath(showdown.commit))
  const localizationCachePath = resolve(
    localizationCacheOverride
      ?? process.env[localizationSource.cacheEnvironmentVariable]
      ?? defaultLocalizationCachePath(localizationSource.commit),
  )

  try {
    verifyGitRevision(cachePath, showdown.commit)
    verifyGitRevision(localizationCachePath, localizationSource.commit)
  } catch (error) {
    throw new Error(`Pinned upstream cache is unavailable or invalid. ${String(error)}`)
  }

  const showdownReferences = await verifySelectedFiles('pokemon-showdown', cachePath, showdown.commit, showdown.selectedPaths)
  const localizationReferences = await verifySelectedFiles(
    'pokemon-dataset-zh',
    localizationCachePath,
    localizationSource.commit,
    localizationSource.selectedPaths,
  )

  const registryDocument = RegistrySchema.parse(await readJson(join(projectRoot, 'data-curated', 'id-registry.json')))
  if (registryDocument.sourceCommit !== showdown.commit) {
    throw new Error('ID registry source commit does not match source-lock.json')
  }
  const sourceReferenceByPath = new Map(showdownReferences.map(reference => [reference.path, reference]))
  const localizationSourceReferenceByPath = new Map(localizationReferences.map(reference => [reference.path, reference]))
  return {
    cachePath,
    commit: showdown.commit,
    sourceReferences: [...showdownReferences, ...localizationReferences],
    sourceReferenceByPath,
    localization: {
      cachePath: localizationCachePath,
      commit: localizationSource.commit,
      sourceReferences: localizationReferences,
      sourceReferenceByPath: localizationSourceReferenceByPath,
    },
    registry: registryDocument.entities,
  }
}

async function importRecord(path: string, exportName: string): Promise<Record<string, unknown>> {
  const moduleUrl = pathToFileURL(path).href
  const loaded = await import(moduleUrl) as Record<string, unknown>
  const exported = loaded[exportName]
  if (typeof exported !== 'object' || exported === null || Array.isArray(exported)) {
    throw new Error(`Expected object export ${exportName} in ${path}`)
  }
  return exported as Record<string, unknown>
}

function parseRecord<T>(
  input: Record<string, unknown>,
  schema: z.ZodType<T>,
  label: string,
): Record<string, T> {
  return Object.fromEntries(Object.entries(input).map(([id, value]) => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new Error(`Invalid ${label} record ${id}: ${z.prettifyError(parsed.error)}`)
    }
    return [id, parsed.data]
  }))
}

export async function loadShowdownSource(source: VerifiedSource): Promise<ShowdownSourceData> {
  const dataPath = join(source.cachePath, 'data')
  const [pokedex, abilities, natures, typeChart] = await Promise.all([
    importRecord(join(dataPath, 'pokedex.ts'), 'Pokedex'),
    importRecord(join(dataPath, 'abilities.ts'), 'Abilities'),
    importRecord(join(dataPath, 'natures.ts'), 'Natures'),
    importRecord(join(dataPath, 'typechart.ts'), 'TypeChart'),
  ])
  return {
    pokedex,
    abilities,
    natures: parseRecord(natures, RawNatureRecordSchema, 'Nature'),
    typeChart: parseRecord(typeChart, RawTypeRecordSchema, 'Type'),
  }
}

export function parsePokedexRecord(value: unknown, id: string): RawPokedexRecord {
  const parsed = RawPokedexRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid Pokédex record ${id}: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export function parseAbilityRecord(value: unknown, id: string): RawAbilityRecord {
  const parsed = RawAbilityRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid Ability record ${id}: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export function getProjectRoot(): string {
  return projectRoot
}
