import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RuntimeItem, RuntimeItemLocalization } from '../../src/lib/runtime-data/types.ts'

export type ItemLocalizationMappingClass = 'automatic' | 'owner-override'

export type ItemLocalizationSourceProvenance = {
  sourceId: string
  sourceName: string
  sourceUrl: string
  sourceTable: '道具列表'
  sourceLocator: 'manual-list-snapshot'
  sourceRow: number | null
  sourceEnglishName: string | null
  copiedAt: string
  ownerOverride: boolean
}

export type CuratedItemLocalizationRecord = {
  stableId: string
  showdownId: string
  canonicalEnglishName: string
  zhHansName: string
  mappingClass: ItemLocalizationMappingClass
  sourceProvenance: ItemLocalizationSourceProvenance
}

export type CuratedItemLocalizationSource = {
  schemaVersion: 1
  scope: 'active Item registry only'
  source: {
    sourceId: string
    sourceName: string
    sourceUrl: string
    copiedAt: string
    sourceTable: '道具列表'
    mappingMethod: string
    provenanceMode: string
    license: { name: string; url: string; attributionBoundary: string }
    transportEvidence: {
      sourceWorkbook: string
      sourceWorkbookSize: number
      sourceWorkbookSha256: string
      sourceRole: string
      primarySheet: '道具列表'
      secondarySheet: '道具列表2'
    }
    secondarySource: {
      sheet: '道具列表2'
      role: string
      descriptionIntegration: string
      crossCheck: {
        dataRows: number
        comparedActiveItems: number
        agreeingItems: number
        mismatchItems: number
        mismatches: Array<{ stableId: string; canonicalEnglishName: string; formalZhHansName: string; secondaryZhHansNames: string[] }>
      }
    }
  }
  ownerOverrides: Array<{
    stableId: string
    showdownId: string
    canonicalEnglishName: string
    zhHansName: string
    reason: string
    sourceCandidates: Array<{ sourceRow: number; sourceEnglishName: string; zhHansName: string | null }>
  }>
  records: CuratedItemLocalizationRecord[]
}

export type ItemLocalizationCoverage = {
  activeItems: number
  localizedItems: number
  automatic: number
  ownerOverrides: number
  missing: number
  ambiguous: number
  duplicateStableIds: number
  danglingReferences: number
}

const SOURCE_PATH = resolve(import.meta.dirname, '../../data-curated/item-localization.json')
export const ITEM_LOCALIZATION_SOURCE_WORKBOOK = 'data-source/52poke-item-localization.xlsx'
export const ITEM_LOCALIZATION_SOURCE_WORKBOOK_SIZE = 3533083
export const ITEM_LOCALIZATION_SOURCE_WORKBOOK_SHA256 = '1731b09471fd92b070b37b9feb6c22bd80c1efa48e52a7b42da32fd453ebb3a7'
const STABLE_ID_PATTERN = /^item:\d{4}$/
const SHOWDOWN_ID_PATTERN = /^[a-z0-9]+$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`ITEM_LOCALIZATION_SOURCE_FIELD: ${path}`)
  return value
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null
  return requiredString(value, path)
}

function parseProvenance(value: unknown, path: string, source: CuratedItemLocalizationSource['source']): ItemLocalizationSourceProvenance {
  if (!isRecord(value)) throw new Error(`ITEM_LOCALIZATION_SOURCE_PROVENANCE: ${path}`)
  const sourceRow = value.sourceRow
  if (sourceRow !== null && (!Number.isInteger(sourceRow) || Number(sourceRow) < 2)) throw new Error(`ITEM_LOCALIZATION_SOURCE_ROW: ${path}`)
  const result = {
    sourceId: requiredString(value.sourceId, `${path}.sourceId`),
    sourceName: requiredString(value.sourceName, `${path}.sourceName`),
    sourceUrl: requiredString(value.sourceUrl, `${path}.sourceUrl`),
    sourceTable: value.sourceTable,
    sourceLocator: value.sourceLocator,
    sourceRow: sourceRow as number | null,
    sourceEnglishName: nullableString(value.sourceEnglishName, `${path}.sourceEnglishName`),
    copiedAt: requiredString(value.copiedAt, `${path}.copiedAt`),
    ownerOverride: value.ownerOverride,
  }
  if (result.sourceId !== source.sourceId || result.sourceName !== source.sourceName || result.sourceUrl !== source.sourceUrl || result.sourceTable !== source.sourceTable || result.sourceLocator !== 'manual-list-snapshot' || typeof result.ownerOverride !== 'boolean') {
    throw new Error(`ITEM_LOCALIZATION_SOURCE_PROVENANCE_MISMATCH: ${path}`)
  }
  return result as ItemLocalizationSourceProvenance
}

function parseSource(value: unknown): CuratedItemLocalizationSource {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.scope !== 'active Item registry only' || !isRecord(value.source) || !Array.isArray(value.records) || !Array.isArray(value.ownerOverrides)) throw new Error('ITEM_LOCALIZATION_SOURCE_FORMAT')
  const rawSource = value.source
  const source = {
    sourceId: requiredString(rawSource.sourceId, 'source.sourceId'),
    sourceName: requiredString(rawSource.sourceName, 'source.sourceName'),
    sourceUrl: requiredString(rawSource.sourceUrl, 'source.sourceUrl'),
    copiedAt: requiredString(rawSource.copiedAt, 'source.copiedAt'),
    sourceTable: rawSource.sourceTable,
    mappingMethod: requiredString(rawSource.mappingMethod, 'source.mappingMethod'),
    provenanceMode: requiredString(rawSource.provenanceMode, 'source.provenanceMode'),
    license: rawSource.license,
    transportEvidence: rawSource.transportEvidence,
    secondarySource: rawSource.secondarySource,
  }
  if (source.sourceTable !== '道具列表' || !isRecord(source.license) || !isRecord(source.transportEvidence) || !isRecord(source.secondarySource)) throw new Error('ITEM_LOCALIZATION_SOURCE_METADATA')
  if (source.license.name !== 'CC BY-NC-SA 3.0' || typeof source.license.url !== 'string' || typeof source.license.attributionBoundary !== 'string') throw new Error('ITEM_LOCALIZATION_SOURCE_LICENSE')
  if (source.transportEvidence.sourceWorkbook !== ITEM_LOCALIZATION_SOURCE_WORKBOOK || source.transportEvidence.sourceWorkbookSize !== ITEM_LOCALIZATION_SOURCE_WORKBOOK_SIZE || source.transportEvidence.sourceWorkbookSha256 !== ITEM_LOCALIZATION_SOURCE_WORKBOOK_SHA256 || typeof source.transportEvidence.sourceRole !== 'string' || source.transportEvidence.primarySheet !== '道具列表' || source.transportEvidence.secondarySheet !== '道具列表2' || !SHA256_PATTERN.test(source.transportEvidence.sourceWorkbookSha256)) throw new Error('ITEM_LOCALIZATION_SOURCE_TRANSPORT')
  if (source.secondarySource.sheet !== '道具列表2' || typeof source.secondarySource.role !== 'string' || typeof source.secondarySource.descriptionIntegration !== 'string' || !isRecord(source.secondarySource.crossCheck) || !Number.isInteger(source.secondarySource.crossCheck.dataRows) || !Number.isInteger(source.secondarySource.crossCheck.comparedActiveItems) || !Number.isInteger(source.secondarySource.crossCheck.agreeingItems) || !Number.isInteger(source.secondarySource.crossCheck.mismatchItems) || !Array.isArray(source.secondarySource.crossCheck.mismatches)) throw new Error('ITEM_LOCALIZATION_SOURCE_SECONDARY')
  const typedSource = source as CuratedItemLocalizationSource['source']

  const records = value.records.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`ITEM_LOCALIZATION_RECORD_FORMAT: ${index}`)
    const mappingClass: ItemLocalizationMappingClass = raw.mappingClass as ItemLocalizationMappingClass
    if (mappingClass !== 'automatic' && mappingClass !== 'owner-override') throw new Error(`ITEM_LOCALIZATION_MAPPING_CLASS: ${index}`)
    const stableId = requiredString(raw.stableId, `records[${index}].stableId`)
    const showdownId = requiredString(raw.showdownId, `records[${index}].showdownId`)
    if (!STABLE_ID_PATTERN.test(stableId) || !SHOWDOWN_ID_PATTERN.test(showdownId)) throw new Error(`ITEM_LOCALIZATION_ID_FORMAT: ${index}`)
    return {
      stableId,
      showdownId,
      canonicalEnglishName: requiredString(raw.canonicalEnglishName, `records[${index}].canonicalEnglishName`),
      zhHansName: requiredString(raw.zhHansName, `records[${index}].zhHansName`),
      mappingClass,
      sourceProvenance: parseProvenance(raw.sourceProvenance, `records[${index}].sourceProvenance`, typedSource),
    }
  })
  const ownerOverrides = value.ownerOverrides.map((raw, index) => {
    if (!isRecord(raw) || !Array.isArray(raw.sourceCandidates)) throw new Error(`ITEM_LOCALIZATION_OVERRIDE_FORMAT: ${index}`)
    return {
      stableId: requiredString(raw.stableId, `ownerOverrides[${index}].stableId`),
      showdownId: requiredString(raw.showdownId, `ownerOverrides[${index}].showdownId`),
      canonicalEnglishName: requiredString(raw.canonicalEnglishName, `ownerOverrides[${index}].canonicalEnglishName`),
      zhHansName: requiredString(raw.zhHansName, `ownerOverrides[${index}].zhHansName`),
      reason: requiredString(raw.reason, `ownerOverrides[${index}].reason`),
      sourceCandidates: raw.sourceCandidates.map((candidate, candidateIndex) => {
        if (!isRecord(candidate) || !Number.isInteger(candidate.sourceRow) || Number(candidate.sourceRow) < 2) throw new Error(`ITEM_LOCALIZATION_OVERRIDE_CANDIDATE: ${index}:${candidateIndex}`)
        return { sourceRow: Number(candidate.sourceRow), sourceEnglishName: requiredString(candidate.sourceEnglishName, `ownerOverrides[${index}].sourceCandidates[${candidateIndex}].sourceEnglishName`), zhHansName: nullableString(candidate.zhHansName, `ownerOverrides[${index}].sourceCandidates[${candidateIndex}].zhHansName`) }
      }),
    }
  })
  if (records.length !== 567 || ownerOverrides.length !== 2) throw new Error(`ITEM_LOCALIZATION_SOURCE_COVERAGE: records=${records.length}, overrides=${ownerOverrides.length}`)
  if (records.filter(record => record.mappingClass === 'automatic').length !== 565 || records.filter(record => record.mappingClass === 'owner-override').length !== 2) throw new Error('ITEM_LOCALIZATION_SOURCE_MAPPING_COUNTS')
  const recordOverrides = records.filter(record => record.mappingClass === 'owner-override')
  if (new Set(ownerOverrides.map(override => override.stableId)).size !== ownerOverrides.length || ownerOverrides.some(override => {
    const record = recordOverrides.find(candidate => candidate.stableId === override.stableId)
    return !record || record.showdownId !== override.showdownId || record.canonicalEnglishName !== override.canonicalEnglishName || record.zhHansName !== override.zhHansName
  }) || recordOverrides.some(record => !ownerOverrides.some(override => override.stableId === record.stableId))) throw new Error('ITEM_LOCALIZATION_OWNER_OVERRIDE_REGISTRY')
  for (const record of records) if (record.sourceProvenance.ownerOverride !== (record.mappingClass === 'owner-override')) throw new Error(`ITEM_LOCALIZATION_SOURCE_OVERRIDE_FLAG: ${record.stableId}`)
  const crossCheck = typedSource.secondarySource.crossCheck
  if (crossCheck.dataRows !== 1500 || crossCheck.comparedActiveItems !== 463 || crossCheck.agreeingItems !== 459 || crossCheck.mismatchItems !== 4 || crossCheck.mismatches.length !== 4) throw new Error('ITEM_LOCALIZATION_SOURCE_SECONDARY_COUNTS')
  return { schemaVersion: 1, scope: 'active Item registry only', source: typedSource, ownerOverrides, records }
}

export function loadItemLocalizationSource(path = SOURCE_PATH): CuratedItemLocalizationSource {
  return parseSource(JSON.parse(readFileSync(path, 'utf8')) as unknown)
}

function showdownIdFromCanonicalName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

export function buildItemLocalizations(items: RuntimeItem[], source = loadItemLocalizationSource()): RuntimeItemLocalization[] {
  if (items.length !== 567) throw new Error(`ITEM_LOCALIZATION_ACTIVE_ITEM_COUNT: ${items.length}`)
  const sourceByStableId = new Map<string, CuratedItemLocalizationRecord>()
  for (const record of source.records) {
    if (sourceByStableId.has(record.stableId)) throw new Error(`ITEM_LOCALIZATION_DUPLICATE_STABLE_ID: ${record.stableId}`)
    sourceByStableId.set(record.stableId, record)
  }
  const itemIds = new Set(items.map(item => item.itemId))
  if (itemIds.size !== items.length) throw new Error('ITEM_LOCALIZATION_RUNTIME_DUPLICATE_STABLE_ID')
  if (sourceByStableId.size !== items.length || [...sourceByStableId.keys()].some(itemId => !itemIds.has(itemId))) throw new Error('ITEM_LOCALIZATION_SOURCE_RUNTIME_COVERAGE')
  const result = items.map(item => {
    const record = sourceByStableId.get(item.itemId)
    if (!record) throw new Error(`ITEM_LOCALIZATION_MISSING: ${item.itemId}`)
    if (record.canonicalEnglishName !== item.canonicalName || record.showdownId !== showdownIdFromCanonicalName(item.canonicalName)) throw new Error(`ITEM_LOCALIZATION_IDENTITY_MISMATCH: ${item.itemId}`)
    return {
      itemId: record.stableId,
      showdownId: record.showdownId,
      canonicalName: record.canonicalEnglishName,
      zhHansName: record.zhHansName,
      mappingClass: record.mappingClass,
      sourceProvenance: record.sourceProvenance.sourceId,
    }
  }).sort((left, right) => left.itemId.localeCompare(right.itemId, 'en'))
  if (result.some(record => !record.zhHansName) || new Set(result.map(record => record.itemId)).size !== result.length) throw new Error('ITEM_LOCALIZATION_INCOMPLETE')
  return result
}

export function itemLocalizationCoverage(items: RuntimeItem[], source = loadItemLocalizationSource()): ItemLocalizationCoverage {
  const duplicateStableIds = source.records.length - new Set(source.records.map(record => record.stableId)).size
  const itemIds = new Set(items.map(item => item.itemId))
  const sourceIds = new Set(source.records.map(record => record.stableId))
  const missing = [...itemIds].filter(itemId => !sourceIds.has(itemId)).length
  const danglingReferences = [...sourceIds].filter(itemId => !itemIds.has(itemId)).length
  return {
    activeItems: items.length,
    localizedItems: source.records.filter(record => record.zhHansName.length > 0).length,
    automatic: source.records.filter(record => record.mappingClass === 'automatic').length,
    ownerOverrides: source.records.filter(record => record.mappingClass === 'owner-override').length,
    missing,
    ambiguous: 0,
    duplicateStableIds,
    danglingReferences,
  }
}
