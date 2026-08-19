import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DexEntrySchema,
  DexLocalizationEntrySchema,
  DexSchema,
  SourceReferenceSchema,
  ValueProvenanceSchema,
  type Dex,
  type DexEntry,
  type DexLocalizationEntry,
  type SmokeDataset,
  type SourceReference,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import { getProjectRoot, sha256, type VerifiedSource } from './source.ts'

const RawDexRowSchema = z.object({
  id: z.string().regex(/^\d{3}$/),
  national_id: z.union([z.string().regex(/^\d{1,4}$/), z.number().int().positive()]),
  name: z.string().min(1),
}).passthrough()

const DexScopeSchema = z.object({
  scopeRecordId: z.string().min(1),
  dexId: z.string().min(1),
  sourceSelector: z.object({ path: z.string().min(1) }).strict(),
  regionId: z.string().nullable(),
  gameIds: z.array(z.string()),
  versionIds: z.array(z.string()),
  subdex: z.string().nullable(),
  scope: z.string().min(1),
  status: z.enum(['resolved', 'unresolved']),
  duplicatePolicy: z.enum(['unique-regional-number', 'same-species-distinct-forms']),
  localization: z.object({ name: z.string().min(1), shortLabel: z.string().min(1).optional() }).strict(),
  rationale: z.string().min(1),
  sourceEvidence: z.array(z.string().min(1)),
  review: z.object({ status: z.string().min(1), basis: z.string().min(1) }).strict(),
}).strict()

const DexScopesDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  scopes: z.array(DexScopeSchema).length(8),
}).strict()

type DexScope = z.infer<typeof DexScopeSchema>
type RawDexRow = z.infer<typeof RawDexRowSchema>

export interface DexConflict {
  code: string
  severity: 'warning' | 'error'
  dexId: string
  message: string
}

export interface DexScopeAudit {
  dexId: string
  sourcePath: string
  status: 'resolved' | 'unresolved'
  rawRowCount: number
  uniqueRegionalNumberCount: number
  stableRuntimeEntryCount: number
  formSpecificRuntimeEntryCount: number
}

export interface DexSegmentAudit {
  segment: number
  startRow: number
  endRow: number
  rowCount: number
}

export interface QuarantinedDexScope {
  dexId: string
  sourcePath: string
  dataStatus: 'unresolved'
  rawRowCount: number
  uniqueRegionalNumberCount: number
  detectedSegments: DexSegmentAudit[]
  duplicateFormEvidence: Array<{ regionalNumber: string; names: string[] }>
  unresolvedReason: string
}

export interface DexBuildResult {
  dexes: Dex[]
  dexEntries: DexEntry[]
  localizationEntries: DexLocalizationEntry[]
  sourceReferences: SourceReference[]
  valueProvenance: ValueProvenance[]
  conflicts: DexConflict[]
  scopeAudits: DexScopeAudit[]
  quarantine: QuarantinedDexScope[]
}

const EXPECTED_COUNTS = new Map<string, [number, number]>([
  ['dex:kanto:expanded-153', [153, 153]],
  ['dex:sinnoh:expanded-210', [210, 210]],
  ['dex:swsh:galar', [400, 400]],
  ['dex:sv:paldea', [400, 400]],
  ['dex:sv:kitakami', [200, 200]],
  ['dex:sv:blueberry', [243, 243]],
  ['dex:hoenn:expanded-211', [211, 211]],
  ['dex:la:hisui', [708, 242]],
])

function upstreamReference(source: VerifiedSource, path: string): SourceReference {
  const reference = source.localization.sourceReferenceByPath.get(path)
  if (!reference) throw new Error(`Missing pokemon-dataset-zh SourceReference for ${path}`)
  return reference
}

function curatedReference(path: string, fileHash: string): SourceReference {
  const identity = JSON.stringify({ source: 'local-curated', revision: fileHash, path, sha256: fileHash })
  return SourceReferenceSchema.parse({
    sourceReferenceId: `src:local-curated:${sha256(identity).slice(0, 16)}`,
    source: 'local-curated',
    revision: fileHash,
    path,
    sha256: fileHash,
  })
}

function detectSegments(rows: RawDexRow[]): DexSegmentAudit[] {
  const starts = [0]
  for (let index = 1; index < rows.length; index += 1) {
    if (Number(rows[index].id) < Number(rows[index - 1].id)) starts.push(index)
  }
  return starts.map((start, index) => {
    const endExclusive = starts[index + 1] ?? rows.length
    return { segment: index + 1, startRow: start, endRow: endExclusive - 1, rowCount: endExclusive - start }
  })
}

function addProvenance(
  target: ValueProvenance[], entityId: string, fieldPath: string, reference: SourceReference,
  method: 'source-literal' | 'project-normalization' | 'curated-exception',
  mappingClass: 'automatic' | 'rule-based' | 'manual-exception', sourcePointer: string,
): void {
  target.push(ValueProvenanceSchema.parse({
    entityId, fieldPath, sourceReferenceId: reference.sourceReferenceId,
    method, mappingClass, selected: true, sourcePointer,
  }))
}

export function assertDexEntryUniqueness(
  dexes: Dex[], entries: DexEntry[],
  duplicatePolicies: ReadonlyMap<string, 'unique-regional-number' | 'same-species-distinct-forms'> = new Map(),
): void {
  const knownDexes = new Set(dexes.map(dex => dex.dexId))
  const seen = new Map<string, DexEntry>()
  for (const entry of entries) {
    if (!knownDexes.has(entry.dexId)) throw new Error(`DEX_ENTRY_ORPHAN_DEX: ${entry.dexId}`)
    const key = `${entry.dexId}:${entry.regionalNumber}`
    const previous = seen.get(key)
    if (!previous) {
      seen.set(key, entry)
      continue
    }
    const policy = duplicatePolicies.get(entry.dexId) ?? 'unique-regional-number'
    if (policy !== 'same-species-distinct-forms'
      || previous.speciesId !== entry.speciesId
      || previous.formId === null
      || entry.formId === null
      || previous.formId === entry.formId) {
      throw new Error(`DEX_ENTRY_DUPLICATE_REGIONAL_NUMBER: ${key}`)
    }
  }
}

export function stableDexId(scope: Pick<DexScope, 'dexId'>): string {
  return scope.dexId
}

export async function buildDexes(
  dataset: SmokeDataset,
  source: VerifiedSource,
): Promise<DexBuildResult> {
  const curatedPath = 'data-curated/dex-scopes.json'
  const curatedBytes = await readFile(join(getProjectRoot(), ...curatedPath.split('/')))
  const document = DexScopesDocumentSchema.parse(JSON.parse(curatedBytes.toString('utf8')) as unknown)
  const curatedRef = curatedReference(curatedPath, sha256(curatedBytes))
  const dexes: Dex[] = []
  const dexEntries: DexEntry[] = []
  const localizationEntries: DexLocalizationEntry[] = []
  const valueProvenance: ValueProvenance[] = []
  const conflicts: DexConflict[] = []
  const scopeAudits: DexScopeAudit[] = []
  const quarantine: QuarantinedDexScope[] = []
  const speciesByNumber = new Map(dataset.species.map(species => [species.nationalDexNumber, species]))

  for (const [scopeIndex, scope] of document.scopes.entries()) {
    const sourceRef = upstreamReference(source, scope.sourceSelector.path)
    const sourceRows = z.array(RawDexRowSchema).parse(JSON.parse(await readFile(
      join(source.localization.cachePath, ...scope.sourceSelector.path.split('/')), 'utf8',
    )) as unknown)
    const uniqueCount = new Set(sourceRows.map(row => row.id)).size
    const expected = EXPECTED_COUNTS.get(scope.dexId)
    if (!expected || sourceRows.length !== expected[0] || uniqueCount !== expected[1]) {
      throw new Error(`DEX_SOURCE_COUNT_MISMATCH: ${scope.dexId} received ${sourceRows.length}/${uniqueCount}`)
    }

    if (scope.status === 'unresolved') {
      const segments = detectSegments(sourceRows)
      const firstSegment = sourceRows.slice(segments[0].startRow, segments[0].endRow + 1)
      const grouped = new Map<string, string[]>()
      for (const row of firstSegment) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row.name])
      quarantine.push({
        dexId: scope.dexId,
        sourcePath: scope.sourceSelector.path,
        dataStatus: 'unresolved',
        rawRowCount: sourceRows.length,
        uniqueRegionalNumberCount: uniqueCount,
        detectedSegments: segments,
        duplicateFormEvidence: [...grouped.entries()].filter(([, names]) => names.length > 1)
          .map(([regionalNumber, names]) => ({ regionalNumber, names })),
        unresolvedReason: scope.rationale,
      })
      conflicts.push({
        code: 'DEX_SCOPE_UNRESOLVED', severity: 'error', dexId: scope.dexId,
        message: `${scope.sourceSelector.path} is quarantined: ${scope.rationale}`,
      })
      scopeAudits.push({
        dexId: scope.dexId, sourcePath: scope.sourceSelector.path, status: scope.status,
        rawRowCount: sourceRows.length, uniqueRegionalNumberCount: uniqueCount,
        stableRuntimeEntryCount: 0, formSpecificRuntimeEntryCount: 0,
      })
      continue
    }

    const dex = DexSchema.parse({
      dexId: stableDexId(scope), regionId: scope.regionId, gameIds: scope.gameIds,
      versionIds: scope.versionIds, subdex: scope.subdex, scope: scope.scope, dataStatus: 'complete',
    })
    dexes.push(dex)
    localizationEntries.push(DexLocalizationEntrySchema.parse({
      entityId: dex.dexId, name: scope.localization.name, ...(scope.localization.shortLabel ? { shortLabel: scope.localization.shortLabel } : {}),
    }))
    for (const field of ['dexId', 'regionId', 'gameIds', 'versionIds', 'subdex', 'scope', 'dataStatus'] as const) {
      addProvenance(valueProvenance, dex.dexId, `/${field}`, curatedRef, 'curated-exception', 'manual-exception', `/scopes/${scopeIndex}/${field}`)
    }
    addProvenance(valueProvenance, dex.dexId, '/localization/zh-CN/name', curatedRef, 'curated-exception', 'manual-exception', `/scopes/${scopeIndex}/localization/name`)
    if (scope.localization.shortLabel) {
      addProvenance(valueProvenance, dex.dexId, '/localization/zh-CN/shortLabel', curatedRef, 'curated-exception', 'manual-exception', `/scopes/${scopeIndex}/localization/shortLabel`)
    }

    const beforeCount = dexEntries.length
    for (const [rowIndex, row] of sourceRows.entries()) {
      const species = speciesByNumber.get(Number(row.national_id))
      if (!species) continue
      const entry = DexEntrySchema.parse({
        dexId: dex.dexId, regionalNumber: row.id, regionalSortKey: row.id.padStart(8, '0'),
        speciesId: species.speciesId, formId: null, sourceName: row.name,
      })
      dexEntries.push(entry)
      const entryPath = `/entries/${entry.regionalNumber}/${entry.speciesId}`
      addProvenance(valueProvenance, dex.dexId, `${entryPath}/regionalNumber`, sourceRef, 'source-literal', 'automatic', `/${rowIndex}/id`)
      addProvenance(valueProvenance, dex.dexId, `${entryPath}/speciesId`, sourceRef, 'project-normalization', 'automatic', `/${rowIndex}/national_id`)
      addProvenance(valueProvenance, dex.dexId, `${entryPath}/formId`, sourceRef, 'project-normalization', 'automatic', `/${rowIndex}/name`)
    }
    scopeAudits.push({
      dexId: dex.dexId, sourcePath: scope.sourceSelector.path, status: scope.status,
      rawRowCount: sourceRows.length, uniqueRegionalNumberCount: uniqueCount,
      stableRuntimeEntryCount: dexEntries.length - beforeCount, formSpecificRuntimeEntryCount: 0,
    })
  }

  const policies = new Map(document.scopes.map(scope => [scope.dexId, scope.duplicatePolicy] as const))
  assertDexEntryUniqueness(dexes, dexEntries, policies)
  dexes.sort((left, right) => left.dexId.localeCompare(right.dexId, 'en'))
  dexEntries.sort((left, right) => `${left.dexId}:${left.regionalSortKey}:${left.speciesId}:${left.formId ?? ''}`
    .localeCompare(`${right.dexId}:${right.regionalSortKey}:${right.speciesId}:${right.formId ?? ''}`, 'en'))
  localizationEntries.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en'))
  valueProvenance.sort((left, right) => `${left.entityId}${left.fieldPath}`.localeCompare(`${right.entityId}${right.fieldPath}`, 'en'))
  return {
    dexes, dexEntries, localizationEntries, sourceReferences: [curatedRef], valueProvenance,
    conflicts, scopeAudits, quarantine,
  }
}
