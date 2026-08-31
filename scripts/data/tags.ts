import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  CanonicalTagsDataSchema,
  TagsDataSchema,
  type TagAssignment,
  type CanonicalTagsData,
  type TagDefinition,
  type TagId,
  type TagsData,
} from '../../src/lib/data-model/tag-schema.ts'
import type { ExcelCellEvidence, ExcelSourceDocument } from './excel-validation.ts'
import { getProjectRoot } from './source.ts'

const WORKBOOK_SHA256 = '7efe9af08bc11b5f6f28e006da3cc34db9ec637b11732934f71988ad6d553156'
const WORKBOOK_SIZE = 3_206_663
const WORKBOOK_MTIME_UTC = '2026-08-31T14:38:24.5628820Z'

const DEFINITIONS: TagDefinition[] = [
  ['tag:starter', 'Starter', 'species'],
  ['tag:major-legendary', 'Major Legendary', 'species'],
  ['tag:minor-legendary', 'Minor Legendary', 'species'],
  ['tag:mythical', 'Mythical', 'species'],
  ['tag:pseudo-legendary', 'Pseudo-Legendary', 'species'],
  ['tag:fossil', 'Fossil', 'species'],
  ['tag:ultra-beast', 'Ultra Beast', 'species'],
  ['tag:paradox', 'Paradox', 'species'],
  ['tag:mega', 'Mega', 'form'],
  ['tag:primal', 'Primal', 'form'],
].map(([tagId, name, appliesTo]) => ({
  tagId: tagId as TagId,
  canonicalName: { en: name },
  appliesTo: appliesTo as 'species' | 'form',
  descriptionKey: `tag-description:${String(tagId).slice(4)}`,
}))

const SOURCE_LABELS = new Map<string, { tagId: TagId; zhName: string }>([
  ['御三家', { tagId: 'tag:starter', zhName: '御三家' }],
  ['一级神', { tagId: 'tag:major-legendary', zhName: '一级神' }],
  ['二级神', { tagId: 'tag:minor-legendary', zhName: '二级神' }],
  ['幻兽', { tagId: 'tag:mythical', zhName: '幻兽' }],
  ['准神', { tagId: 'tag:pseudo-legendary', zhName: '准神' }],
  ['化石复原', { tagId: 'tag:fossil', zhName: '化石' }],
  ['究极异兽', { tagId: 'tag:ultra-beast', zhName: '究极异兽' }],
  ['悖谬种', { tagId: 'tag:paradox', zhName: '悖谬种' }],
  ['超级进化', { tagId: 'tag:mega', zhName: 'Mega' }],
  ['原始回归', { tagId: 'tag:primal', zhName: '原始回归' }],
])

type Row = Map<number, ExcelCellEvidence>

export interface TagCanonicalInput {
  species: Array<Record<string, unknown>>
  forms: Array<Record<string, unknown>>
}

function rows(sheet: ExcelSourceDocument['sheets'][string]): Map<number, Row> {
  const result = new Map<number, Row>()
  for (const cell of sheet.cells) {
    const row = result.get(cell.row) ?? new Map<number, ExcelCellEvidence>()
    row.set(cell.column, cell)
    result.set(cell.row, row)
  }
  return result
}

function raw(row: Row, column: number): unknown {
  return row.get(column)?.cached ?? null
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

const TYPE_ID_BY_ZH: Readonly<Record<string, string>> = {
  '一般': 'type:normal', '格斗': 'type:fighting', '飞行': 'type:flying', '毒': 'type:poison',
  '地面': 'type:ground', '岩石': 'type:rock', '虫': 'type:bug', '幽灵': 'type:ghost',
  '钢': 'type:steel', '火': 'type:fire', '水': 'type:water', '草': 'type:grass',
  '电': 'type:electric', '超能力': 'type:psychic', '超能': 'type:psychic', '冰': 'type:ice',
  '龙': 'type:dragon', '恶': 'type:dark', '妖精': 'type:fairy',
}

function matchForm(row: Row, forms: Array<Record<string, unknown>>): string[] {
  const dex = number(raw(row, 1))
  if (!dex || dex < 1 || dex > 1025) return []
  const types = [text(raw(row, 4)), text(raw(row, 5))].filter(Boolean).map(type => TYPE_ID_BY_ZH[type] ?? `unknown:${type}`)
  const stats = [6, 7, 8, 9, 10, 11].map(column => number(raw(row, column)))
  if (stats.some(value => value === null)) return []
  return forms.filter(form => {
    if (Number(String(form.speciesId).slice(8)) !== dex) return false
    const baseStats = form.baseStats as Record<string, number>
    return JSON.stringify(form.types) === JSON.stringify(types)
      && JSON.stringify([baseStats.hp, baseStats.atk, baseStats.def, baseStats.spa, baseStats.spd, baseStats.spe]) === JSON.stringify(stats)
  }).map(form => String(form.formId)).sort()
}

function emptyCountRecord(): Record<TagId, number> {
  return Object.fromEntries(DEFINITIONS.map(definition => [definition.tagId, 0])) as Record<TagId, number>
}

function assignment(
  entityId: string,
  tagId: TagId,
  locators: string[],
): TagAssignment {
  const formLevel = tagId === 'tag:mega' || tagId === 'tag:primal'
  return {
    assignmentId: `tag-assignment:${tagId.slice(4)}:${entityId}`,
    entityId,
    tagId,
    status: 'accepted',
    mappingClass: formLevel ? 'rule-based' : 'automatic',
    rationale: formLevel
      ? 'Excel classification matched one stable Form within its Species by ordered types and all six base stats.'
      : 'Excel primary classification row mapped by National Dex number to one stable Species ID.',
    sourceEvidence: { sourceId: 'excel', workbookSha256: WORKBOOK_SHA256, locators: [...new Set(locators)].sort() },
    review: { status: 'accepted-for-tags-migration', basis: 'Fixed-workbook audit and deterministic stable-identity evidence.' },
  }
}

export function buildTagsFromExcel(excel: ExcelSourceDocument, canonical: TagCanonicalInput): TagsData {
  const fixedWorkbook = excel.fingerprint.size === WORKBOOK_SIZE && excel.fingerprint.sha256 === WORKBOOK_SHA256 && excel.fingerprint.mtimeUtc === WORKBOOK_MTIME_UTC
  if (!fixedWorkbook || !excel.readOnly || excel.saveCapability) {
    throw new Error('TAG_EXCEL_SOURCE_CONTRACT_FAILED')
  }
  const national = rows(excel.sheets['全国图鉴'])
  const guess = rows(excel.sheets['猜宝可梦'])
  const megaSheet = rows(excel.sheets['Mega进化'])
  const speciesIds = new Set(canonical.species.map(species => String(species.speciesId)))
  const assignmentLocators = new Map<string, string[]>()
  const sourceRowCounts = emptyCountRecord()
  const duplicateSourceRows = emptyCountRecord()
  const unresolvedByKey = new Map<string, TagsData['unresolved'][number]>()
  const speciesTags = new Map<string, Set<TagId>>()

  for (const [rowNumber, row] of national) {
    if (rowNumber === 1) continue
    const source = SOURCE_LABELS.get(text(raw(row, 14)))
    if (!source) continue
    sourceRowCounts[source.tagId] += 1
    const dex = number(raw(row, 1))
    if (!dex || dex < 1 || dex > 1025) continue
    if (source.tagId === 'tag:mega' || source.tagId === 'tag:primal') {
      const candidates = matchForm(row, canonical.forms)
      if (candidates.length === 1) {
        const key = `${candidates[0]}|${source.tagId}`
        assignmentLocators.set(key, [...(assignmentLocators.get(key) ?? []), `全国图鉴!N${rowNumber}`])
      } else {
        const key = `${source.tagId}|${dex}|${text(raw(row, 3))}`
        unresolvedByKey.set(key, {
          unresolvedId: `tag-unresolved:${source.tagId.slice(4)}:${dex.toString().padStart(4, '0')}:national-${rowNumber}`,
          tagId: source.tagId,
          sourceLabel: text(raw(row, 14)),
          nationalDexNumber: dex,
          sourceName: text(raw(row, 3)),
          sourceLocators: [`全国图鉴!N${rowNumber}`],
          candidateEntityIds: candidates,
          reason: 'non-unique-form-match',
          status: 'unresolved',
          rationale: 'Multiple stable Forms share the source Species, ordered types, and six base stats; the source row has no trustworthy discriminator.',
          review: { status: 'quarantined-for-tags-migration', basis: 'Ambiguous Form identity is preserved explicitly and is not collapsed to the base Species.' },
        })
      }
      continue
    }
    const entityId = `species:${dex.toString().padStart(4, '0')}`
    if (!speciesIds.has(entityId)) continue
    const key = `${entityId}|${source.tagId}`
    const existing = assignmentLocators.get(key) ?? []
    if (existing.length > 0) duplicateSourceRows[source.tagId] += 1
    assignmentLocators.set(key, [...existing, `全国图鉴!N${rowNumber}`])
    const tags = speciesTags.get(entityId) ?? new Set<TagId>()
    tags.add(source.tagId)
    speciesTags.set(entityId, tags)
  }

  for (const [rowNumber, row] of megaSheet) {
    if (rowNumber === 1) continue
    const candidates = matchForm(row, canonical.forms)
    if (candidates.length === 1) {
      const key = `${candidates[0]}|tag:mega`
      const existing = assignmentLocators.get(key)
      if (existing) assignmentLocators.set(key, [...existing, `Mega进化!C${rowNumber}`])
    } else {
      const dex = number(raw(row, 1))
      if (!dex) continue
      const key = `tag:mega|${dex}|${text(raw(row, 3))}`
      const existing = unresolvedByKey.get(key)
      if (existing) existing.sourceLocators.push(`Mega进化!C${rowNumber}`)
    }
  }

  // 猜宝可梦 is a derived copy. It is audited for counts, but never creates assignments.
  const derivedCounts = emptyCountRecord()
  for (const [rowNumber, row] of guess) {
    if (rowNumber === 1) continue
    const source = SOURCE_LABELS.get(text(raw(row, 15)))
    if (source) derivedCounts[source.tagId] += 1
  }

  const assignments = [...assignmentLocators.entries()].map(([key, locators]) => {
    const separator = key.lastIndexOf('|')
    return assignment(key.slice(0, separator), key.slice(separator + 1) as TagId, locators)
  }).sort((left, right) => `${left.entityId}|${left.tagId}`.localeCompare(`${right.entityId}|${right.tagId}`, 'en'))
  const contradictions = [...speciesTags.entries()]
    .filter(([, tags]) => tags.size > 1)
    .map(([entityId, tags]) => ({ entityId, tagIds: [...tags].sort() }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId, 'en'))
  const localization = DEFINITIONS.map(definition => {
    const source = [...SOURCE_LABELS.values()].find(candidate => candidate.tagId === definition.tagId)
    if (!source) throw new Error(`TAG_LOCALIZATION_MISSING: ${definition.tagId}`)
    return { tagId: definition.tagId, name: source.zhName }
  })
  const result = TagsDataSchema.parse({
    schemaVersion: 1,
    definitions: DEFINITIONS,
    localization: { locale: 'zh-CN', entries: localization },
    assignments,
    unresolved: [...unresolvedByKey.values()].map(item => ({ ...item, sourceLocators: [...new Set(item.sourceLocators)].sort() }))
      .sort((left, right) => `${left.tagId}|${left.nationalDexNumber}|${left.sourceName}`.localeCompare(`${right.tagId}|${right.nationalDexNumber}|${right.sourceName}`, 'en')),
    audit: {
      sourceSheets: [
        { sheet: '全国图鉴', column: 'N', role: 'primary' },
        { sheet: '猜宝可梦', column: 'O', role: 'derived-copy' },
        { sheet: 'Mega进化', column: 'C', role: 'implicit-cross-check' },
      ],
      sourceRowCounts,
      duplicateSourceRows,
      derivedCopyRowCounts: derivedCounts,
      contradictions,
    },
  })
  for (const definition of DEFINITIONS) {
    if (definition.tagId !== 'tag:mega' && derivedCounts[definition.tagId] !== sourceRowCounts[definition.tagId]) {
      throw new Error(`TAG_DERIVED_COUNT_MISMATCH: ${definition.tagId}`)
    }
  }
  if (derivedCounts['tag:mega'] > sourceRowCounts['tag:mega']) throw new Error('TAG_DERIVED_MEGA_COUNT_INVALID')
  return result
}

export async function loadCuratedTags(path = resolve(getProjectRoot(), 'data-curated', 'tags.json')): Promise<TagsData> {
  return TagsDataSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

export function validateTags(tags: TagsData, canonical: TagCanonicalInput): void {
  const definitions = new Map(tags.definitions.map(definition => [definition.tagId, definition]))
  if (definitions.size !== DEFINITIONS.length) throw new Error(`TAG_DEFINITION_COUNT: expected ${DEFINITIONS.length}, received ${definitions.size}`)
  if (DEFINITIONS.some(definition => !definitions.has(definition.tagId))) throw new Error('TAG_DEFINITION_COVERAGE')
  const localizationIds = tags.localization.entries.map(entry => entry.tagId)
  if (new Set(localizationIds).size !== DEFINITIONS.length || DEFINITIONS.some(definition => !localizationIds.includes(definition.tagId))) {
    throw new Error('TAG_LOCALIZATION_COVERAGE')
  }
  const speciesIds = new Set(canonical.species.map(species => String(species.speciesId)))
  const formIds = new Set(canonical.forms.map(form => String(form.formId)))
  const pairs = new Set<string>()
  const assignmentIds = new Set<string>()
  for (const item of tags.assignments) {
    if (assignmentIds.has(item.assignmentId)) throw new Error(`TAG_DUPLICATE_ASSIGNMENT_ID: ${item.assignmentId}`)
    assignmentIds.add(item.assignmentId)
    if (item.assignmentId !== `tag-assignment:${item.tagId.slice(4)}:${item.entityId}`) throw new Error(`TAG_ASSIGNMENT_ID_MISMATCH: ${item.assignmentId}`)
    const definition = definitions.get(item.tagId)
    if (!definition) throw new Error(`TAG_UNKNOWN_ID: ${item.tagId}`)
    const expectedPrefix = definition.appliesTo === 'species' ? 'species:' : 'form:'
    if (!item.entityId.startsWith(expectedPrefix)) throw new Error(`TAG_ENTITY_KIND: ${item.tagId} cannot reference ${item.entityId}`)
    if (!(definition.appliesTo === 'species' ? speciesIds : formIds).has(item.entityId)) throw new Error(`TAG_ORPHAN_ENTITY: ${item.entityId}`)
    if (item.sourceEvidence.workbookSha256 !== WORKBOOK_SHA256) throw new Error(`TAG_SOURCE_HASH: ${item.assignmentId}`)
    const pair = `${item.entityId}|${item.tagId}`
    if (pairs.has(pair)) throw new Error(`TAG_DUPLICATE_ASSIGNMENT: ${pair}`)
    pairs.add(pair)
  }
  for (const item of tags.unresolved) {
    if (item.tagId !== 'tag:mega') throw new Error(`TAG_UNEXPECTED_UNRESOLVED: ${item.tagId}`)
    if (item.candidateEntityIds.some(candidate => !formIds.has(candidate))) throw new Error(`TAG_UNRESOLVED_ORPHAN: ${item.sourceName}`)
  }
  const sortedPairs = [...pairs].sort()
  if (JSON.stringify([...pairs]) !== JSON.stringify(sortedPairs)) throw new Error('TAG_ASSIGNMENT_ORDER')
}

export interface TagArtifacts {
  canonical: CanonicalTagsData
  provenance: { schemaVersion: 1; assignments: TagAssignment[]; unresolved: TagsData['unresolved'] }
  report: Record<string, unknown>
}

export function buildTagArtifacts(tags: TagsData, canonical: TagCanonicalInput): TagArtifacts {
  validateTags(tags, canonical)
  const lightweight = CanonicalTagsDataSchema.parse({
    schemaVersion: 1,
    definitions: tags.definitions,
    localization: tags.localization,
    assignments: tags.assignments.map(item => ({ entityId: item.entityId, tagId: item.tagId })),
  })
  const byTag = emptyCountRecord()
  for (const item of lightweight.assignments) byTag[item.tagId] += 1
  return {
    canonical: lightweight,
    provenance: { schemaVersion: 1, assignments: tags.assignments, unresolved: tags.unresolved },
    report: {
      schemaVersion: 1,
      migration: 'excel-classifications-to-stable-entity-tags',
      source: { relativePath: 'data-source/Pokemon-data.xlsx', size: WORKBOOK_SIZE, sha256: WORKBOOK_SHA256, mtimeUtc: WORKBOOK_MTIME_UTC, readOnly: true },
      sourceAudit: tags.audit,
      finalAssignments: {
        total: lightweight.assignments.length,
        species: lightweight.assignments.filter(item => item.entityId.startsWith('species:')).length,
        forms: lightweight.assignments.filter(item => item.entityId.startsWith('form:')).length,
        byTag,
      },
      unresolved: { total: tags.unresolved.length, byReason: { 'non-unique-form-match': tags.unresolved.length }, rows: tags.unresolved },
      invariants: { registryEntityIdsAdded: 0, stableIdentityMutations: 0, canonicalMechanicsMutations: 0, localizationMutations: 0 },
    },
  }
}

export function emptyTagArtifacts(): TagArtifacts {
  return {
    canonical: CanonicalTagsDataSchema.parse({ schemaVersion: 1, definitions: [], localization: { locale: 'zh-CN', entries: [] }, assignments: [] }),
    provenance: { schemaVersion: 1, assignments: [], unresolved: [] },
    report: { schemaVersion: 1, migration: 'excel-classifications-to-stable-entity-tags', skipped: true },
  }
}

export function emptyTags(): TagsData {
  return TagsDataSchema.parse({
    schemaVersion: 1,
    definitions: [],
    localization: { locale: 'zh-CN', entries: [] },
    assignments: [],
    unresolved: [],
    audit: { sourceSheets: [], sourceRowCounts: emptyCountRecord(), duplicateSourceRows: emptyCountRecord(), derivedCopyRowCounts: emptyCountRecord(), contradictions: [] },
  })
}
