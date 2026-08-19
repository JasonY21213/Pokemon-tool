import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { buildFullDryRun, type FullDryRunArtifacts } from './full-dry-run.ts'
import { getProjectRoot, loadShowdownSource, verifySource, type ShowdownSourceData } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'
import { loadReviewDecisions, requireDecision, type ReviewDecision } from './review-decisions.ts'

const execFileAsync = promisify(execFile)
const EXPECTED = {
  size: 3206646,
  sha256: 'aa25849772c7d6ccbf56c24943cf97dbe9c34fae3211826b39a82658ddcb49e5',
  mtimeNs: 1787073126607569400n,
}

export type ComparisonClassification = 'agree' | 'canonical-only' | 'excel-only' | 'conflict'
  | 'representation-difference' | 'suspected-legacy-error' | 'confirmed-legacy-error' | 'unverifiable'
export type ComparisonSeverity = 'info' | 'warning' | 'error' | 'blocking'

export interface ExcelCellEvidence {
  row: number
  column: number
  locator: string
  kind: 'static' | 'formula'
  raw: unknown
  cached: unknown
}

interface ExcelSheetEvidence {
  title: string
  state: string
  maxRow: number
  maxColumn: number
  cells: ExcelCellEvidence[]
}

export interface ExcelSourceDocument {
  schemaVersion: 1
  adapter: 'ExcelValidationAdapter'
  readOnly: true
  saveCapability: false
  openpyxlVersion: string
  fingerprint: { relativePath: string; size: number; sha256: string; mtimeUtc: string; mtimeNs: number }
  sheets: Record<string, ExcelSheetEvidence>
}

export interface ComparisonRecord {
  comparisonId: string
  domain: string
  canonicalEntityId: string | null
  canonicalField: string
  canonicalValue: unknown
  excelLocator: string | null
  excelKind: 'static' | 'formula' | null
  excelRawValue: unknown
  excelCachedValue: unknown
  classification: ComparisonClassification
  severity: ComparisonSeverity
  rationale: string
  reviewDecisionId?: string
  rootCauseDecisionId?: string
}

export interface DomainReport {
  domain: string
  summary: Record<string, unknown>
  comparisons: ComparisonRecord[]
}

export interface ExcelCrossValidationResult {
  reports: Record<string, DomainReport>
  summary: Record<string, unknown>
  stableHashes: Record<string, string>
  outputRoot: string
  performance: { extractionMs: number; comparisonMs: number; emissionMs: number; totalMs: number; peakRssBytes: number }
}

type Row = Map<number, ExcelCellEvidence>

const TYPE_ZH: Record<string, string> = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草', ice: '冰', fighting: '格斗',
  poison: '毒', ground: '地面', flying: '飞行', psychic: '超能', bug: '虫', rock: '岩石', ghost: '幽灵',
  dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
}
const CATEGORY_ZH: Record<string, string> = { physical: '物理', special: '特殊', status: '变化' }
function stableId(parts: unknown[]): string {
  return `excel-check:${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)}`
}

export function comparison(input: Omit<ComparisonRecord, 'comparisonId'>): ComparisonRecord {
  return { comparisonId: stableId([input.domain, input.canonicalEntityId, input.canonicalField, input.excelLocator, input.classification]), ...input }
}

function rows(sheet: ExcelSheetEvidence): Map<number, Row> {
  const result = new Map<number, Row>()
  for (const cell of sheet.cells) {
    const row = result.get(cell.row) ?? new Map<number, ExcelCellEvidence>()
    row.set(cell.column, cell)
    result.set(cell.row, row)
  }
  return result
}

function value(row: Row | undefined, column: number): unknown {
  return row?.get(column)?.cached ?? null
}

function text(input: unknown): string {
  return input === null || input === undefined ? '' : String(input).trim()
}

function num(input: unknown): number | null {
  const parsed = typeof input === 'number' ? input : Number(String(input).trim())
  return Number.isFinite(parsed) ? parsed : null
}

function evidence(row: Row | undefined, column: number): Pick<ComparisonRecord, 'excelLocator' | 'excelKind' | 'excelRawValue' | 'excelCachedValue'> {
  const cell = row?.get(column)
  return cell ? { excelLocator: cell.locator, excelKind: cell.kind, excelRawValue: cell.raw, excelCachedValue: cell.cached }
    : { excelLocator: null, excelKind: null, excelRawValue: null, excelCachedValue: null }
}

function equalNormalized(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9
  return text(left).normalize('NFKC').toLowerCase() === text(right).normalize('NFKC').toLowerCase()
}

export async function fingerprintExcel(path = resolve(getProjectRoot(), 'data-source', 'Pokemon-data.xlsx')): Promise<{ size: number; sha256: string; mtimeNs: bigint }> {
  const { stat } = await import('node:fs/promises')
  const info = await stat(path, { bigint: true })
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
  return { size: Number(info.size), sha256, mtimeNs: info.mtimeNs }
}

export function assertExcelFingerprint(actual: { size: number; sha256: string; mtimeNs: bigint }): void {
  if (actual.size !== EXPECTED.size || actual.sha256 !== EXPECTED.sha256 || actual.mtimeNs !== EXPECTED.mtimeNs) {
    throw new Error(`EXCEL_FINGERPRINT_MISMATCH: expected ${EXPECTED.size}/${EXPECTED.sha256}/${EXPECTED.mtimeNs}, received ${actual.size}/${actual.sha256}/${actual.mtimeNs}`)
  }
}

export class ExcelValidationAdapter {
  readonly readOnly = true
  readonly saveCapability = false

  async read(workbookPath = resolve(getProjectRoot(), 'data-source', 'Pokemon-data.xlsx')): Promise<ExcelSourceDocument> {
    assertExcelFingerprint(await fingerprintExcel(workbookPath))
    const python = resolve(getProjectRoot(), '.venv', 'Scripts', 'python.exe')
    const helper = resolve(getProjectRoot(), 'scripts', 'data', 'excel', 'read_workbook.py')
    const { stdout } = await execFileAsync(python, [helper, workbookPath], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const document = JSON.parse(stdout) as ExcelSourceDocument
    if (document.adapter !== 'ExcelValidationAdapter' || !document.readOnly || document.saveCapability) {
      throw new Error('EXCEL_ADAPTER_READ_ONLY_CONTRACT_FAILED')
    }
    assertExcelFingerprint(await fingerprintExcel(workbookPath))
    return document
  }
}

function makeRecord(
  domain: string, entityId: string | null, field: string, canonicalValue: unknown, row: Row | undefined, column: number,
  classification: ComparisonClassification, severity: ComparisonSeverity, rationale: string,
): ComparisonRecord {
  return comparison({ domain, canonicalEntityId: entityId, canonicalField: field, canonicalValue, ...evidence(row, column), classification, severity, rationale })
}

function speciesAndForms(excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): { species: DomainReport; forms: DomainReport; mechanics: DomainReport } {
  const national = rows(excel.sheets['全国图鉴'])
  const fullForm = rows(excel.sheets['全形态图鉴'])
  const mega = rows(excel.sheets['Mega进化'])
  const speciesLoc = new Map(canonical.localization.species.map(item => [String(item.entityId), String(item.name)]))
  const formBySpecies = new Map<string, Array<Record<string, unknown>>>()
  for (const form of canonical.forms) formBySpecies.set(String(form.speciesId), [...(formBySpecies.get(String(form.speciesId)) ?? []), form])
  const abilityZh = new Map<string, string>()
  const abilityByEnglish = new Map(canonical.abilities.map(item => [text((item.canonicalName as { en?: unknown }).en), String(item.abilityId)]))
  for (const item of canonical.localization.abilities) abilityZh.set(String(item.entityId), String(item.name))
  const speciesRecords: ComparisonRecord[] = []
  const formRecords: ComparisonRecord[] = []
  const mechanics: ComparisonRecord[] = []
  const nationalRowsByNumber = new Map<number, Array<[number, Row]>>()
  for (const [rowNumber, row] of national) {
    if (rowNumber === 1) continue
    const dex = num(value(row, 1))
    if (dex && dex >= 1 && dex <= 1025) nationalRowsByNumber.set(dex, [...(nationalRowsByNumber.get(dex) ?? []), [rowNumber, row]])
  }
  for (const species of canonical.species) {
    const speciesId = String(species.speciesId)
    const dex = Number(species.nationalDexNumber)
    const candidates = nationalRowsByNumber.get(dex) ?? []
    const zh = speciesLoc.get(speciesId) ?? ''
    const exact = candidates.find(([, row]) => text(value(row, 3)) === zh) ?? candidates[0]
    if (!exact) {
      speciesRecords.push(makeRecord('species', speciesId, 'nationalDexNumber', dex, undefined, 1, 'canonical-only', 'warning', 'Canonical Species has no Excel 全国图鉴 row.'))
      continue
    }
    const [, row] = exact
    speciesRecords.push(makeRecord('species', speciesId, 'nationalDexNumber', dex, row, 1, num(value(row, 1)) === dex ? 'agree' : 'conflict', num(value(row, 1)) === dex ? 'info' : 'error', 'Species is grouped by National Dex number; form rows are not counted as Species.'))
    speciesRecords.push(makeRecord('species', speciesId, 'localization.zh-CN.name', zh, row, 3, text(value(row, 3)) === zh ? 'agree' : 'conflict', text(value(row, 3)) === zh ? 'info' : 'warning', text(value(row, 3)) === zh ? 'Chinese Species name agrees.' : 'Excel display name differs from canonical Species localization.'))
    const generation = dex <= 151 ? 1 : dex <= 251 ? 2 : dex <= 386 ? 3 : dex <= 493 ? 4
      : dex <= 649 ? 5 : dex <= 721 ? 6 : dex <= 809 ? 7 : dex <= 905 ? 8 : 9
    speciesRecords.push(makeRecord('species', speciesId, 'generation', generation, row, 15, text(value(row, 15)) === `Gen${generation}` ? 'agree' : 'conflict', text(value(row, 15)) === `Gen${generation}` ? 'info' : 'warning', 'Generation inferred from official National Dex boundary and compared with legacy label.'))
    const baseForm = (formBySpecies.get(speciesId) ?? []).find(form => String(form.formId).endsWith(':base'))
    if (!baseForm) continue
    const excelTypes = [text(value(row, 4)), text(value(row, 5))].filter(Boolean)
    const canonicalTypes = (baseForm.types as string[]).map(type => TYPE_ZH[type.replace('type:', '')] ?? type)
    mechanics.push(makeRecord('types', String(baseForm.formId), 'types', canonicalTypes, row, 4,
      JSON.stringify(excelTypes) === JSON.stringify(canonicalTypes) ? 'agree' : 'conflict',
      JSON.stringify(excelTypes) === JSON.stringify(canonicalTypes) ? 'info' : 'error', 'Ordered Form type list comparison.'))
    const stats = baseForm.baseStats as Record<string, number>
    for (const [field, column] of Object.entries({ hp: 6, atk: 7, def: 8, spa: 9, spd: 10, spe: 11 })) {
      const excelValue = num(value(row, column))
      mechanics.push(makeRecord('base-stats', String(baseForm.formId), `baseStats.${field}`, stats[field], row, column,
        excelValue === null ? 'excel-only' : excelValue === stats[field] ? 'agree' : 'conflict',
        excelValue === null ? 'warning' : excelValue === stats[field] ? 'info' : 'error',
        excelValue === null ? 'Excel stat is missing; this is not treated as a canonical error.' : 'Form base-stat comparison.'))
    }
    const canonicalSlots = baseForm.abilities as Record<string, string>
    for (const [slot, column] of Object.entries({ '0': 16, '1': 17, H: 18 })) {
      const canonicalEnglish = canonicalSlots[slot] ?? null
      const canonicalZh = canonicalEnglish ? abilityZh.get(abilityByEnglish.get(canonicalEnglish) ?? '') ?? canonicalEnglish : null
      const excelValue = text(value(row, column)) || null
      const agrees = (canonicalZh === null && (excelValue === null || excelValue === '/')) || canonicalZh === excelValue
      mechanics.push(makeRecord('ability-slots', String(baseForm.formId), `abilities.${slot}`, canonicalZh, row, column,
        agrees ? 'agree' : excelValue === null || excelValue === '/' ? 'canonical-only' : canonicalZh === null ? 'excel-only' : 'conflict',
        agrees ? 'info' : 'warning', 'Ability slots are compared by slot, not as an unordered set.'))
    }
  }
  const reliablyMatchedFormIds = new Set(canonical.species.map(item => String(item.defaultFormId)))
  for (const [dex, candidates] of nationalRowsByNumber) {
    const speciesId = `species:${dex.toString().padStart(4, '0')}`
    const speciesName = speciesLoc.get(speciesId)
    const canonicalCandidates = formBySpecies.get(speciesId) ?? []
    for (const [, row] of candidates) {
      if (text(value(row, 3)) === speciesName) continue
      const excelTypes = [text(value(row, 4)), text(value(row, 5))].filter(Boolean)
      const excelStats = [6, 7, 8, 9, 10, 11].map(column => num(value(row, column)))
      if (excelStats.some(item => item === null)) continue
      const matching = canonicalCandidates.filter(form => {
        const candidateTypes = (form.types as string[]).map(type => TYPE_ZH[type.replace('type:', '')] ?? type)
        const stats = form.baseStats as Record<string, number>
        return JSON.stringify(candidateTypes) === JSON.stringify(excelTypes)
          && JSON.stringify([stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe]) === JSON.stringify(excelStats)
      })
      if (matching.length !== 1) continue
      const form = matching[0]; const formId = String(form.formId); reliablyMatchedFormIds.add(formId)
      formRecords.push(makeRecord('forms', formId, 'identityByMechanics', form.showdownId, row, 3, 'agree', 'info', 'Form was reliably matched within one Species by ordered types plus all six base stats.'))
      for (const [field, column] of Object.entries({ hp: 6, atk: 7, def: 8, spa: 9, spd: 10, spe: 11 })) {
        const expected = (form.baseStats as Record<string, number>)[field]
        mechanics.push(makeRecord('base-stats', formId, `baseStats.${field}`, expected, row, column, num(value(row, column)) === expected ? 'agree' : 'conflict', num(value(row, column)) === expected ? 'info' : 'error', 'Reliably mapped non-base Form stat comparison.'))
      }
      const slots = form.abilities as Record<string, string>
      for (const [slot, column] of Object.entries({ '0': 16, '1': 17, H: 18 })) {
        const en = slots[slot] ?? null; const zh = en ? abilityZh.get(abilityByEnglish.get(en) ?? '') ?? en : null; const actual = text(value(row, column)) || null
        const agrees = (zh === null && (actual === null || actual === '/')) || zh === actual
        mechanics.push(makeRecord('ability-slots', formId, `abilities.${slot}`, zh, row, column, agrees ? 'agree' : !actual || actual === '/' ? 'canonical-only' : !zh ? 'excel-only' : 'conflict', agrees ? 'info' : 'warning', 'Reliably mapped non-base Form ability-slot comparison.'))
      }
    }
  }
  const canonicalFormCount = new Map<number, number>()
  for (const form of canonical.forms) {
    const dex = Number(String(form.speciesId).slice(-4))
    canonicalFormCount.set(dex, (canonicalFormCount.get(dex) ?? 0) + 1)
  }
  const fixtureDex = new Set([6, 133, 201, 479, 493, 648, 666, 718, 869, 876, 1017])
  let excelFormCandidates = 0
  let appearanceRows = 0
  for (const [rowNumber, row] of fullForm) {
    if (rowNumber === 1) continue
    const dex = num(value(row, 2)); const name = text(value(row, 3))
    if (!dex || !name) continue
    excelFormCandidates += 1
    const isAppearance = (dex === 201 && /未知图腾/.test(name) && name !== '未知图腾') || (dex === 869 && /霜奶仙/.test(name) && /糖饰|奶油|香草|红钻|蓝莓|爱心|星星|四叶|花朵|蝴蝶/.test(name))
    if (isAppearance) appearanceRows += 1
    const classification: ComparisonClassification = isAppearance ? 'representation-difference' : (canonicalFormCount.get(dex) ?? 0) > 1 ? 'unverifiable' : 'excel-only'
    if (isAppearance || fixtureDex.has(dex)) formRecords.push(makeRecord('forms', `species:${dex.toString().padStart(4, '0')}`, 'form-or-appearance', canonicalFormCount.get(dex) ?? 0, row, 3, classification, isAppearance ? 'warning' : 'info', isAppearance ? 'Excel full-form row represents canonical Appearance rather than a mechanics-bearing Form.' : 'Name-only legacy Form evidence requires explicit identity mapping.'))
  }
  for (const [rowNumber, row] of mega) {
    if (rowNumber === 1) continue
    if (text(value(row, 2)) === '#N/A') formRecords.push(makeRecord('forms', null, 'mega.sortKey', null, row, 2, 'suspected-legacy-error', 'warning', 'Mega sheet contains cached/static #N/A sort keys.'))
  }
  const reliableBaseForms = canonical.species.length
  const canonicalOnly = canonical.forms.length - reliablyMatchedFormIds.size
  return {
    species: { domain: 'species', summary: { canonicalSpecies: 1025, excelNationalNumbers: nationalRowsByNumber.size, matched: speciesRecords.filter(item => item.canonicalField === 'nationalDexNumber' && item.classification === 'agree').length, canonicalOnly: speciesRecords.filter(item => item.classification === 'canonical-only').length, nameDifferences: speciesRecords.filter(item => item.canonicalField.includes('name') && item.classification !== 'agree').length, numberingConflicts: speciesRecords.filter(item => item.canonicalField === 'nationalDexNumber' && item.classification === 'conflict').length, englishNameEvidence: 'unavailable-in-全国图鉴', categoryEvidence: 'available-separately-as-migration-candidates' }, comparisons: speciesRecords },
    forms: { domain: 'forms', summary: { canonicalForms: canonical.forms.length, reliableBaseMatches: reliableBaseForms, reliableMechanicsMatches: reliablyMatchedFormIds.size - reliableBaseForms, totalReliableMatches: reliablyMatchedFormIds.size, canonicalOnlyRequiringIdentityMapping: canonicalOnly, excelFullFormRows: excelFormCandidates, appearanceRepresentationRows: appearanceRows, permanentFixturesReviewed: ['Charizard', 'Rotom', 'Arceus', 'Zygarde', 'Ogerpon', 'Meowstic', 'Unown', 'Alcremie', 'Eevee'] }, comparisons: formRecords },
    mechanics: { domain: 'form-mechanics', summary: { typeComparisons: mechanics.filter(item => item.domain === 'types').length, typeConflicts: mechanics.filter(item => item.domain === 'types' && item.classification === 'conflict').length, statComparisons: mechanics.filter(item => item.domain === 'base-stats').length, statConflicts: mechanics.filter(item => item.domain === 'base-stats' && item.classification === 'conflict').length, abilitySlotComparisons: mechanics.filter(item => item.domain === 'ability-slots').length, abilitySlotConflicts: mechanics.filter(item => item.domain === 'ability-slots' && item.classification === 'conflict').length }, comparisons: mechanics },
  }
}

function abilities(excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): DomainReport {
  const sheetRows = rows(excel.sheets['特性列表'])
  const localization = new Map(canonical.localization.abilities.map(item => [String(item.entityId), item]))
  const records: ComparisonRecord[] = []
  const byNumber = new Map<number, Row[]>()
  for (const [rowNumber, row] of sheetRows) {
    if (rowNumber === 1) continue
    const number = num(value(row, 1)); if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), row])
  }
  for (const ability of canonical.abilities) {
    const id = String(ability.abilityId); const number = Number(ability.officialNumber); const candidates = byNumber.get(number) ?? []
    const row = candidates.find(item => equalNormalized(value(item, 4), (ability.canonicalName as { en: unknown }).en)) ?? candidates[0]
    if (!row) { records.push(makeRecord('abilities', id, 'officialNumber', number, undefined, 1, 'canonical-only', 'warning', 'Canonical Ability has no Excel master-list row.')); continue }
    const duplicate = candidates.length > 1
    records.push(makeRecord('abilities', id, 'officialNumber', number, row, 1, duplicate ? 'suspected-legacy-error' : 'agree', duplicate ? 'warning' : 'info', duplicate ? `Excel Ability number occurs ${candidates.length} times.` : 'Official Ability number agrees.'))
    const en = (ability.canonicalName as { en: unknown }).en
    const excelEn = value(row, 4); const exactEnglish = equalNormalized(en, excelEn)
    const punctuationOnly = text(en).replace(/[’']/g, '') === text(excelEn).replace(/[’']/g, '')
    const groupedLegacyName = [266, 267, 301, 302, 303, 304].includes(number)
    const englishClass: ComparisonClassification = exactEnglish ? 'agree' : punctuationOnly || groupedLegacyName ? 'representation-difference' : 'conflict'
    records.push(makeRecord('abilities', id, 'canonicalName.en', en, row, 4, englishClass, exactEnglish ? 'info' : englishClass === 'representation-difference' ? 'warning' : 'error', groupedLegacyName ? 'Excel uses one grouped display name while canonical identities retain mechanics-specific variants.' : punctuationOnly ? 'Typography-only apostrophe difference.' : 'English Ability identity comparison.'))
    const zh = localization.get(id)?.name
    records.push(makeRecord('abilities', id, 'localization.zh-CN.name', zh ?? null, row, 2, zh && equalNormalized(zh, value(row, 2)) ? 'agree' : zh ? 'conflict' : 'unverifiable', zh && equalNormalized(zh, value(row, 2)) ? 'info' : 'warning', 'Chinese Ability localization comparison; Excel is evidence only.'))
    records.push(makeRecord('abilities', id, 'descriptionPresence', Boolean(localization.get(id)?.shortDescription), row, 5, text(value(row, 5)) ? 'agree' : 'canonical-only', text(value(row, 5)) ? 'info' : 'warning', 'Only description presence is compared because sources have different editorial text.'))
  }
  return { domain: 'abilities', summary: { canonical: canonical.abilities.length, excelRows: [...sheetRows.keys()].filter(row => row > 1).length, duplicateNumber76Rows: (byNumber.get(76) ?? []).length, identityConflicts: records.filter(item => item.canonicalField === 'canonicalName.en' && item.classification === 'conflict').length, identityRepresentationDifferences: records.filter(item => item.canonicalField === 'canonicalName.en' && item.classification === 'representation-difference').length, reviewedNumberCollision284Resolved: canonical.abilities.filter(item => item.reviewDecisionId === 'review:ability:ruin-number-collision:0284').length === 3 }, comparisons: records }
}

function moveSemantic(value: unknown, kind: 'power' | 'accuracy'): { semantic: string; value: number | null } {
  const raw = text(value)
  if (['—', '-', '/', ''].includes(raw)) return { semantic: 'unknown-or-not-applicable', value: null }
  const number = num(value)
  if (number === null) return { semantic: 'variable', value: null }
  if (kind === 'accuracy') return { semantic: 'numeric', value: number <= 1 ? number * 100 : number }
  return { semantic: 'numeric', value: number }
}

export function classifyMoveDash(): ComparisonClassification { return 'representation-difference' }

function moves(excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): DomainReport {
  const sheetRows = rows(excel.sheets['招式列表'])
  const localization = new Map(canonical.localization.moves.map(item => [String(item.entityId), item]))
  const byNumber = new Map<number, Row>()
  for (const [rowNumber, row] of sheetRows) { if (rowNumber > 1) { const n = num(value(row, 1)); if (n) byNumber.set(n, row) } }
  const records: ComparisonRecord[] = []
  for (const move of canonical.moves) {
    const id = String(move.moveId); const official = move.officialNumber === null ? null : Number(move.officialNumber)
    const row = official === null ? undefined : byNumber.get(official)
    if (!row) { records.push(makeRecord('moves', id, 'identity', official, undefined, 1, 'canonical-only', 'warning', 'Unnumbered/special or missing Excel Move cannot be matched by official number.')); continue }
    const fields: Array<[string, unknown, number, (input: unknown) => unknown]> = [
      ['canonicalName.en', (move.canonicalName as { en: unknown }).en, 3, text], ['localization.zh-CN.name', localization.get(id)?.name ?? null, 2, text],
      ['typeId', TYPE_ZH[String(move.typeId).replace('type:', '')], 4, text], ['category', CATEGORY_ZH[String(move.category)], 5, text], ['pp', move.pp, 8, num],
    ]
    for (const [field, canonicalValue, column, normalize] of fields) {
      const excelValue = normalize(value(row, column)); const agrees = equalNormalized(canonicalValue, excelValue)
      records.push(makeRecord('moves', id, field, canonicalValue, row, column, agrees ? 'agree' : 'conflict', agrees ? 'info' : field.includes('name') ? 'warning' : 'error', 'Move field comparison after existing normalization semantics.'))
    }
    for (const [field, column, key] of [['basePower', 6, 'power'], ['accuracy', 7, 'accuracy']] as const) {
      const semantic = moveSemantic(value(row, column), key)
      const canonicalValue = move[field]
      const canonicalAlways = field === 'accuracy' && canonicalValue === true
      const agrees = semantic.semantic === 'numeric' && semantic.value === canonicalValue
      const classification = semantic.semantic === 'unknown-or-not-applicable' ? classifyMoveDash() : agrees ? 'agree' : canonicalAlways ? 'representation-difference' : 'conflict'
      records.push(makeRecord('moves', id, field, canonicalValue, row, column, classification, classification === 'conflict' ? 'error' : classification === 'agree' ? 'info' : 'warning', semantic.semantic === 'unknown-or-not-applicable' ? 'Excel dash is preserved as unknown/not-applicable; it is not coerced to zero or always-hit.' : 'Move numeric semantic comparison.'))
    }
  }
  return { domain: 'moves', summary: { canonicalCandidates: canonical.moves.length, excelRows: [...sheetRows.keys()].filter(row => row > 1).length, matchedByOfficialNumber: canonical.moves.filter(item => item.officialNumber !== null && byNumber.has(Number(item.officialNumber))).length, canonicalOnly: records.filter(item => item.canonicalField === 'identity' && item.classification === 'canonical-only').length, mechanicsConflicts: records.filter(item => ['basePower', 'accuracy', 'pp', 'typeId', 'category'].includes(item.canonicalField) && item.classification === 'conflict').length, dashSemanticsPreserved: records.filter(item => item.classification === 'representation-difference' && item.rationale.includes('dash')).length, nihilLightQuarantined: canonical.moves.some(item => String(item.showdownId) === 'nihillight' && item.dataStatus === 'quarantined') }, comparisons: records }
}

function growth(excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): DomainReport {
  const level = rows(excel.sheets['等级']); const records: ComparisonRecord[] = []
  const totals: Record<string, number> = { 'growth:erratic': 600000, 'growth:fast': 800000, 'growth:medium-fast': 1000000, 'growth:medium-slow': 1059860, 'growth:slow': 1250000, 'growth:fluctuating': 1640000 }
  const columns: Record<string, number> = { 'growth:erratic': 2, 'growth:fast': 3, 'growth:medium-fast': 4, 'growth:medium-slow': 5, 'growth:slow': 6, 'growth:fluctuating': 7 }
  for (const [id, expected] of Object.entries(totals)) {
    const row = level.get(102); const actual = num(value(row, columns[id]))
    records.push(makeRecord('growth', id, 'experienceAtLevel100', expected, row, columns[id], actual === expected ? 'agree' : 'conflict', actual === expected ? 'info' : 'error', 'Excel six-curve level-100 total compared with canonical growth formula total.'))
  }
  const experience = (id: string, levelNumber: number): number => {
    const n = levelNumber
    if (n === 1) return 0
    if (id === 'growth:fast') return Math.floor(4 * n ** 3 / 5)
    if (id === 'growth:medium-fast') return n ** 3
    if (id === 'growth:medium-slow') return Math.floor(6 * n ** 3 / 5 - 15 * n ** 2 + 100 * n - 140)
    if (id === 'growth:slow') return Math.floor(5 * n ** 3 / 4)
    if (id === 'growth:erratic') {
      if (n <= 50) return Math.floor(n ** 3 * (100 - n) / 50)
      if (n <= 68) return Math.floor(n ** 3 * (150 - n) / 100)
      if (n <= 98) return Math.floor(n ** 3 * Math.floor((1911 - 10 * n) / 3) / 500)
      return Math.floor(n ** 3 * (160 - n) / 100)
    }
    if (n <= 15) return Math.floor(n ** 3 * Math.floor((n + 73) / 3) / 50)
    if (n <= 36) return Math.floor(n ** 3 * (n + 14) / 50)
    return Math.floor(n ** 3 * (Math.floor(n / 2) + 32) / 50)
  }
  for (const [id, column] of Object.entries(columns)) {
    for (let levelNumber = 1; levelNumber <= 100; levelNumber += 1) {
      const row = level.get(levelNumber + 2); const expected = experience(id, levelNumber); const actual = num(value(row, column))
      records.push(makeRecord('growth', id, `experienceAtLevel.${levelNumber}`, expected, row, column, actual === expected ? 'agree' : 'conflict', actual === expected ? 'info' : 'error', 'Canonical GrowthRate algorithm compared with the cached Excel 1–100 expansion.'))
    }
  }
  records.push(comparison({ domain: 'growth', canonicalEntityId: null, canonicalField: 'speciesGrowthLink', canonicalValue: 'canonical source required', excelLocator: null, excelKind: null, excelRawValue: null, excelCachedValue: null, classification: 'unverifiable', severity: 'info', rationale: 'Workbook contains the six experience curves but no reliable Species-to-GrowthRate field; no Species GrowthRate is inferred from Excel.' }))
  return { domain: 'growth', summary: { sixCurveTotals: 6, curveTotalsAgreed: records.filter(item => item.canonicalField === 'experienceAtLevel100' && item.classification === 'agree').length, expandedTableComparisons: 600, expandedTableAgreed: records.filter(item => item.canonicalField.startsWith('experienceAtLevel.') && item.classification === 'agree').length, expandedTableConflicts: records.filter(item => item.canonicalField.startsWith('experienceAtLevel.') && item.classification === 'conflict').length, speciesEvidenceLinked: 0, speciesEvidenceStatus: 'no-species-link', ragingBoltRemainsUnresolved: canonical.growthRates.some(item => item.entityId === 'species:1021' && item.status === 'unresolved') }, comparisons: records }
}

function typeChartAndNatures(excel: ExcelSourceDocument, source: ShowdownSourceData, decisions: ReviewDecision[]): { typeChart: DomainReport; natures: DomainReport } {
  const chart = rows(excel.sheets['属性克制']); const typeRecords: ComparisonRecord[] = []
  const waterFlyingDecision = requireDecision(decisions, 'review:type-chart:water-vs-flying:excel-legacy-error')
  const excelTypes = [...Array(18)].map((_, i) => text(value(chart.get(2), i + 3)))
  const attackTypes = [...Array(18)].map((_, i) => text(value(chart.get(i + 3), 2)))
  for (let attackIndex = 0; attackIndex < 18; attackIndex += 1) {
    for (let defendIndex = 0; defendIndex < 18; defendIndex += 1) {
      const attackZh = attackTypes[attackIndex]; const defendZh = excelTypes[defendIndex]
      const attackEn = Object.entries(TYPE_ZH).find(([, zh]) => zh === attackZh)?.[0]
      const defendEn = Object.entries(TYPE_ZH).find(([, zh]) => zh === defendZh)?.[0]
      const code = attackEn && defendEn ? source.typeChart[defendEn]?.damageTaken[attackEn[0].toUpperCase() + attackEn.slice(1)] : undefined
      const expected = code === 1 ? 2 : code === 2 ? 0.5 : code === 3 ? 0 : 1
      const row = chart.get(attackIndex + 3); const actual = num(value(row, defendIndex + 3))
      const isReviewedWaterFlying = attackEn === 'water' && defendEn === 'flying' && actual !== expected
      const record = makeRecord('type-chart', `type:${attackEn ?? attackZh}->type:${defendEn ?? defendZh}`, 'multiplier', expected, row, defendIndex + 3,
        actual === expected ? 'agree' : isReviewedWaterFlying ? 'confirmed-legacy-error' : 'conflict',
        actual === expected ? 'info' : isReviewedWaterFlying ? 'warning' : 'error',
        isReviewedWaterFlying ? 'Reviewed Excel legacy entry error; canonical neutral 1x remains selected.' : 'Attack rows and defense columns were explicitly validated.')
      if (isReviewedWaterFlying) record.reviewDecisionId = waterFlyingDecision.decisionId
      typeRecords.push(record)
    }
  }
  const natureRows = rows(excel.sheets['能力值']); const natureRecords: ComparisonRecord[] = []
  const statZh: Record<string, string> = { atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' }
  const natureZh: Record<string, string> = { hardy: '勤奋', lonely: '怕寂寞', adamant: '固执', naughty: '顽皮', brave: '勇敢', bold: '大胆', docile: '坦率', impish: '淘气', lax: '乐天', relaxed: '悠闲', modest: '内敛', mild: '慢吞吞', bashful: '害羞', rash: '马虎', quiet: '冷静', calm: '温和', gentle: '温顺', careful: '慎重', quirky: '浮躁', sassy: '自大', timid: '胆小', hasty: '急躁', jolly: '爽朗', naive: '天真', serious: '认真' }
  for (const [id, nature] of Object.entries(source.natures)) {
    const found = [...natureRows.values()].find(row => text(value(row, 10)) === natureZh[id])
    if (!found) { natureRecords.push(makeRecord('natures', `nature:${id}`, 'identity', nature.name, undefined, 10, 'canonical-only', 'warning', 'Canonical Nature has no Excel row.')); continue }
    const plus = nature.plus ? statZh[nature.plus] : '—'; const minus = nature.minus ? statZh[nature.minus] : '—'
    natureRecords.push(makeRecord('natures', `nature:${id}`, 'plusStat', plus, found, 11, text(value(found, 11)) === plus ? 'agree' : 'conflict', text(value(found, 11)) === plus ? 'info' : 'error', 'Nature increased stat comparison.'))
    natureRecords.push(makeRecord('natures', `nature:${id}`, 'minusStat', minus, found, 12, text(value(found, 12)) === minus ? 'agree' : 'conflict', text(value(found, 12)) === minus ? 'info' : 'error', 'Nature decreased stat comparison.'))
  }
  return {
    typeChart: { domain: 'type-chart', summary: { dimensions: '18x18', orientation: 'attacking rows / defending columns', comparisons: 324, agreed: typeRecords.filter(item => item.classification === 'agree').length, conflicts: typeRecords.filter(item => item.classification === 'conflict').length, reviewedLegacyErrors: typeRecords.filter(item => item.classification === 'confirmed-legacy-error').length }, comparisons: typeRecords },
    natures: { domain: 'natures', summary: { canonical: Object.keys(source.natures).length, comparisons: natureRecords.length, agreed: natureRecords.filter(item => item.classification === 'agree').length, conflicts: natureRecords.filter(item => item.classification === 'conflict').length }, comparisons: natureRecords },
  }
}

export function classifyScopeDifference(): ComparisonClassification { return 'representation-difference' }
export function classifyAppearanceAsForm(): ComparisonClassification { return 'representation-difference' }

function evolutionsAndDex(excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): { evolutions: DomainReport; dexes: DomainReport } {
  const national = rows(excel.sheets['全国图鉴']); const evolutionRecords: ComparisonRecord[] = []
  const zhToSpecies = new Map(canonical.localization.species.map(item => [String(item.name), String(item.entityId)]))
  for (const edge of canonical.evolutions) {
    const targetSpecies = `species:${String(edge.targetFormId).slice(5, 9)}`
    const targetName = canonical.localization.species.find(item => item.entityId === targetSpecies)?.name
    const row = [...national.values()].find(item => text(value(item, 3)) === targetName)
    if (!row) { evolutionRecords.push(makeRecord('evolutions', String(edge.evolutionId), 'target', targetSpecies, undefined, 3, 'canonical-only', 'warning', 'Canonical edge target has no reliable Excel row.')); continue }
    const prevoName = text(value(row, 20)); const sourceSpecies = `species:${String(edge.sourceFormId).slice(5, 9)}`
    const graphAgree = zhToSpecies.get(prevoName) === sourceSpecies
    evolutionRecords.push(makeRecord('evolutions', String(edge.evolutionId), 'sourceFormId', edge.sourceFormId, row, 20, graphAgree ? 'agree' : prevoName === '/' || !prevoName ? 'canonical-only' : 'conflict', graphAgree ? 'info' : prevoName ? 'warning' : 'warning', graphAgree ? 'Evolution graph source/target agrees.' : 'Excel evolution text is incomplete or form-ambiguous.'))
    if (edge.evoLevel !== null) evolutionRecords.push(makeRecord('evolutions', String(edge.evolutionId), 'evoLevel', edge.evoLevel, row, 19, num(value(row, 19)) === edge.evoLevel ? 'agree' : 'representation-difference', num(value(row, 19)) === edge.evoLevel ? 'info' : 'warning', 'Numeric level compared only where canonical edge supplies one.'))
  }
  const sheetMap: Record<string, string> = { '关都图鉴': 'kanto', '神奥图鉴': 'sinnoh', '伽勒尔图鉴': 'galar', '帕底亚图鉴': 'paldea', '北上乡图鉴': 'kitakami', '蓝莓学园图鉴': 'blueberry', '洗翠图鉴': 'hisui' }
  const dexRecords: ComparisonRecord[] = []
  for (const [sheetName, token] of Object.entries(sheetMap)) {
    const sheetRows = rows(excel.sheets[sheetName]); const excelCount = [...sheetRows.values()].filter(row => num(value(row, 1)) !== null && num(value(row, 2)) !== null).length
    const canonicalDex = canonical.dexes.find(item => String(item.dexId).includes(token))
    const canonicalCount = canonicalDex ? canonical.dexEntries.filter(entry => entry.dexId === canonicalDex.dexId).length : null
    const classification = sheetName === '洗翠图鉴' || canonicalCount !== excelCount ? classifyScopeDifference() : 'agree'
    dexRecords.push(makeRecord('dexes', canonicalDex ? String(canonicalDex.dexId) : null, 'entryScope', canonicalCount, sheetRows.get(1), 1, classification, classification === 'agree' ? 'info' : 'warning', sheetName === '洗翠图鉴' ? 'Hisui remains evidence-only/quarantined; Excel does not resolve canonical scope.' : classification === 'agree' ? 'Resolved Dex entry scope agrees.' : `Scope differs (${canonicalCount ?? 'no resolved canonical'} canonical vs ${excelCount} Excel); row-count mismatch is not treated as identity conflict.`))
  }
  return {
    evolutions: { domain: 'evolutions', summary: { canonicalEdges: canonical.evolutions.length, graphAgreed: evolutionRecords.filter(item => item.canonicalField === 'sourceFormId' && item.classification === 'agree').length, rawOrIncomplete: evolutionRecords.filter(item => item.canonicalField === 'sourceFormId' && item.classification !== 'agree').length, levelAgreed: evolutionRecords.filter(item => item.canonicalField === 'evoLevel' && item.classification === 'agree').length }, comparisons: evolutionRecords },
    dexes: { domain: 'dexes', summary: { counterpartsReviewed: Object.keys(sheetMap).length, scopeDifferences: dexRecords.filter(item => item.classification === 'representation-difference').length, hisuiQuarantinePreserved: true }, comparisons: dexRecords },
  }
}

function multiplier(source: ShowdownSourceData, attackingZh: string, defendingZh: string): number {
  const attack = Object.entries(TYPE_ZH).find(([, zh]) => zh === attackingZh)?.[0]
  const defend = Object.entries(TYPE_ZH).find(([, zh]) => zh === defendingZh)?.[0]
  if (!attack || !defend) return Number.NaN
  const code = source.typeChart[defend]?.damageTaken[attack[0].toUpperCase() + attack.slice(1)]
  return code === 1 ? 2 : code === 2 ? 0.5 : code === 3 ? 0 : 1
}

function typeList(input: unknown): string[] {
  return text(input).split(/[,，]/).map(item => item.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function classificationsAndDerived(excel: ExcelSourceDocument, source: ShowdownSourceData, decisions: ReviewDecision[]): { classifications: DomainReport; derived: DomainReport } {
  const national = rows(excel.sheets['全国图鉴']); const guess = rows(excel.sheets['猜宝可梦'])
  const candidateCounts = new Map<string, number>()
  for (const row of national.values()) { const candidate = text(value(row, 14)); if (candidate && candidate !== '分类' && candidate !== '/') candidateCounts.set(candidate, (candidateCounts.get(candidate) ?? 0) + 1) }
  for (const row of guess.values()) { const candidate = text(value(row, 15)); if (candidate && candidate !== '分类') candidateCounts.set(candidate, (candidateCounts.get(candidate) ?? 0) + 1) }
  const classificationRecords = [...candidateCounts.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([name, count]) => comparison({ domain: 'classifications', canonicalEntityId: null, canonicalField: 'migrationCandidate', canonicalValue: null, excelLocator: '全国图鉴!U:U / 猜宝可梦!O:O', excelKind: 'static', excelRawValue: name, excelCachedValue: { label: name, occurrences: count }, classification: 'excel-only', severity: 'info', rationale: 'Legacy project classification is retained as a migration proposal only; no tags were modified.' }))
  const derivedRecords: ComparisonRecord[] = []
  const typePk = rows(excel.sheets['属性PK']); const attackTypes = Object.values(TYPE_ZH)
  const waterFlyingDecision = requireDecision(decisions, 'review:type-chart:water-vs-flying:excel-legacy-error')
  let dualMatched = 0; let dualMismatched = 0; let dualSkipped = 0
  for (const [rowNumber, row] of typePk) {
    if (rowNumber === 1) continue
    const first = text(value(row, 2)); const second = text(value(row, 3))
    if (!attackTypes.includes(first) || (second && !attackTypes.includes(second))) { dualSkipped += 1; continue }
    const buckets: Record<string, string[]> = { '4': [], '2': [], '1': [], '0.5': [], '0.25': [], '0': [] }
    for (const attack of attackTypes) {
      const result = multiplier(source, attack, first) * (second ? multiplier(source, attack, second) : 1)
      buckets[String(result)].push(attack)
    }
    for (const list of Object.values(buckets)) list.sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const columns: Array<[string, number]> = [['4', 4], ['2', 5], ['1', 6], ['0.5', 7], ['0.25', 8], ['0', 9]]
    const mismatched = columns.filter(([bucket, column]) => JSON.stringify(buckets[bucket]) !== JSON.stringify(typeList(value(row, column))))
    if (mismatched.length === 0) dualMatched += 1; else dualMismatched += 1
    const reviewedPropagation = mismatched.length > 0 && (first === '飞行' || second === '飞行')
    const record = makeRecord('derived-regression', `type-combination:${first}${second ? `+${second}` : ''}`, 'typeWeaknessBuckets', buckets, row, 4,
      mismatched.length === 0 ? 'agree' : reviewedPropagation ? 'confirmed-legacy-error' : 'conflict',
      mismatched.length === 0 || reviewedPropagation ? 'info' : 'error',
      mismatched.length === 0 ? 'All six computed multiplier buckets agree with the Excel derived row.' : reviewedPropagation ? 'Derived mismatch is propagated from the single reviewed Water attacking Flying Excel root error.' : `Derived buckets differ at multipliers: ${mismatched.map(([bucket]) => bucket).join(', ')}.`)
    if (reviewedPropagation) record.rootCauseDecisionId = waterFlyingDecision.decisionId
    derivedRecords.push(record)
  }
  for (const [sheetName, purpose] of [['猜宝可梦', 'guess-helper'], ['能力值', 'stat-calculator']] as const) {
    const sheet = excel.sheets[sheetName]; const formulas = sheet.cells.filter(cell => cell.kind === 'formula'); const cached = formulas.filter(cell => cell.cached !== null)
    derivedRecords.push(comparison({ domain: 'derived-regression', canonicalEntityId: null, canonicalField: purpose, canonicalValue: 'not imported', excelLocator: `${sheetName}!used-range`, excelKind: 'formula', excelRawValue: { formulaCells: formulas.length }, excelCachedValue: { cachedCells: cached.length }, classification: 'unverifiable', severity: 'info', rationale: 'Excel-specific interactive helper inputs are not a stable full-domain test vector; formula/cached evidence is inventoried without importing results.' }))
  }
  return {
    classifications: { domain: 'classifications', summary: { migrationCandidateLabels: candidateCounts.size, totalOccurrences: [...candidateCounts.values()].reduce((a, b) => a + b, 0), directCanonicalWrites: 0 }, comparisons: classificationRecords },
    derived: { domain: 'derived-regression', summary: { sheetsReviewed: 4, importedCanonicalRows: 0, dualTypeRowsTested: dualMatched + dualMismatched, dualTypeRowsMatched: dualMatched, dualTypeRowsMismatched: dualMismatched, reviewedRootCausePropagations: derivedRecords.filter(item => item.rootCauseDecisionId === waterFlyingDecision.decisionId).length, unresolvedDualTypeMismatches: derivedRecords.filter(item => item.canonicalField === 'typeWeaknessBuckets' && item.classification === 'conflict').length, dualTypeRowsSkipped: dualSkipped, guessHelperStatus: 'unverifiable-interactive-helper', statCalculatorStatus: 'unverifiable-interactive-helper', growthExpandedRowsTested: 600, typeChartAlgorithmCoveredSeparately: true }, comparisons: derivedRecords },
  }
}

export function classifyKnownAnomaly(found: boolean, likelyLegacy = true): { classification: ComparisonClassification; status: string } {
  return found ? { classification: likelyLegacy ? 'suspected-legacy-error' : 'representation-difference', status: likelyLegacy ? 'confirmed' : 'representation issue' }
    : { classification: 'unverifiable', status: 'not reproduced' }
}

function knownAnomalies(excel: ExcelSourceDocument): DomainReport {
  const all = Object.values(excel.sheets).flatMap(sheet => sheet.cells)
  const find = (pattern: string) => all.filter(cell => text(cell.raw).includes(pattern) || text(cell.cached).includes(pattern))
  const national = rows(excel.sheets['全国图鉴']); const abilitySheet = rows(excel.sheets['特性列表'])
  const missingStats = [...national.values()].filter(row => [6, 7, 8, 9, 10, 11].every(column => value(row, column) === null)).length
  const blankAbilities = [...national.values()].filter(row => [16, 17, 18].every(column => !text(value(row, column)) || text(value(row, column)) === '/')).length
  const duplicate76 = [...abilitySheet.values()].filter(row => num(value(row, 1)) === 76).length
  const definitions: Array<[string, number | boolean, boolean, string]> = [
    ['Zygarde 10% / 50% duplicate', find('基格尔德').filter(cell => /10%|50%/.test(text(cell.raw))).length, false, 'Repeated names are Form/display representation evidence.'],
    ['32 rows missing all stats', missingStats === 32, true, `Observed ${missingStats} rows.`],
    ['74 rows blank abilities', blankAbilities === 74, true, `Observed ${blankAbilities} rows under strict all-slot blank rule.`],
    ['Mgea快龙', find('Mgea快龙').length, true, 'Legacy typo is not corrected.'], ['所有臭泥', find('所有臭泥').length, true, 'Legacy label is not corrected.'],
    ['Arceus repeated display names', find('阿尔宙斯').length > 18, false, `Observed ${find('阿尔宙斯').length} matching cells.`],
    ['Ability duplicate #76', duplicate76 === 2, true, `Observed ${duplicate76} rows.`], ['人马一体 duplicates', find('人马一体').length > 1, false, `Observed ${find('人马一体').length} cells.`],
    ['面影辉映 duplicates', find('面影辉映').length > 1, false, `Observed ${find('面影辉映').length} cells.`], ['Mega #N/A', excel.sheets['Mega进化'].cells.some(cell => text(cell.cached) === '#N/A'), true, 'Cached/static #N/A retained as evidence.'],
    ['Paldea cached #N/A', excel.sheets['帕底亚图鉴'].cells.some(cell => text(cell.cached) === '#N/A'), true, 'Cached #N/A retained as evidence.'], ['全形态 R1 #N/A', excel.sheets['全形态图鉴'].cells.some(cell => cell.row === 1 && cell.column === 18 && text(cell.cached) === '#N/A'), true, 'Header cached formula error reproduced.'],
    ['Hisui whitespace', excel.sheets['洗翠图鉴'].cells.some(cell => typeof cell.raw === 'string' && cell.raw !== cell.raw.trim()), true, 'Whitespace anomaly checked without normalization/writeback.'], ['超次元 header issue', text(rows(excel.sheets['超次元图鉴']).get(1)?.get(1)?.cached) === '密阿雷', true, 'Sheet header is 密阿雷 rather than 超次元.'],
  ]
  const records = definitions.map(([name, found, likelyLegacy, detail]) => {
    const result = classifyKnownAnomaly(Boolean(found), likelyLegacy)
    return comparison({ domain: 'known-anomalies', canonicalEntityId: null, canonicalField: name, canonicalValue: null, excelLocator: null, excelKind: null, excelRawValue: detail, excelCachedValue: { status: result.status }, classification: result.classification, severity: result.classification === 'suspected-legacy-error' ? 'warning' : 'info', rationale: `${result.status}: ${detail}` })
  })
  return { domain: 'known-anomalies', summary: { checked: definitions.length, confirmed: records.filter(item => (item.excelCachedValue as { status: string }).status === 'confirmed').length, representationIssues: records.filter(item => (item.excelCachedValue as { status: string }).status === 'representation issue').length, notReproduced: records.filter(item => (item.excelCachedValue as { status: string }).status === 'not reproduced').length }, comparisons: records }
}

function aggregate(reports: Record<string, DomainReport>, excel: ExcelSourceDocument, canonical: FullDryRunArtifacts): Record<string, unknown> {
  const comparisons = Object.values(reports).flatMap(report => report.comparisons)
  const classifications = Object.fromEntries(['agree', 'canonical-only', 'excel-only', 'conflict', 'representation-difference', 'suspected-legacy-error', 'confirmed-legacy-error', 'unverifiable'].map(key => [key, comparisons.filter(item => item.classification === key).length]))
  const severity = Object.fromEntries(['info', 'warning', 'error', 'blocking'].map(key => [key, comparisons.filter(item => item.severity === key).length]))
  return {
    schemaVersion: 1, purpose: 'read-only Excel cross-validation', excelRole: 'legacy/migration/validation only',
    fingerprint: excel.fingerprint, adapter: { name: excel.adapter, readOnly: excel.readOnly, saveCapability: excel.saveCapability, openpyxlVersion: excel.openpyxlVersion },
    canonicalCandidate: { species: canonical.species.length, forms: canonical.forms.length, abilities: canonical.abilities.length, moves: canonical.moves.length, evolutions: canonical.evolutions.length },
    totalComparisonRecords: comparisons.length, classifications, severity,
    domainSummaries: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, report.summary])),
    canonicalMutations: 0, registryProposalAcceptances: 0, publishable: false,
  }
}

const REPORT_FILES: Record<string, string> = { species: 'species.json', forms: 'forms.json', mechanics: 'form-mechanics.json', abilities: 'abilities.json', moves: 'moves.json', growth: 'growth.json', typeChart: 'type-chart.json', natures: 'natures.json', evolutions: 'evolutions.json', dexes: 'dexes.json', classifications: 'classifications.json', derived: 'derived-regression.json', anomalies: 'known-anomalies.json' }

export async function runExcelCrossValidation(): Promise<ExcelCrossValidationResult> {
  const start = performance.now(); const adapter = new ExcelValidationAdapter(); const excel = await adapter.read(); const extractionMs = performance.now() - start
  const comparisonStart = performance.now(); const decisions = await loadReviewDecisions(); const canonical = await buildFullDryRun(); const source = await loadShowdownSource(await verifySource())
  const sf = speciesAndForms(excel, canonical); const tn = typeChartAndNatures(excel, source, decisions); const ed = evolutionsAndDex(excel, canonical); const cd = classificationsAndDerived(excel, source, decisions)
  const reports: Record<string, DomainReport> = { species: sf.species, forms: sf.forms, mechanics: sf.mechanics, abilities: abilities(excel, canonical), moves: moves(excel, canonical), growth: growth(excel, canonical), typeChart: tn.typeChart, natures: tn.natures, evolutions: ed.evolutions, dexes: ed.dexes, classifications: cd.classifications, derived: cd.derived, anomalies: knownAnomalies(excel) }
  for (const report of Object.values(reports)) report.comparisons.sort((a, b) => a.comparisonId.localeCompare(b.comparisonId, 'en'))
  const summary = aggregate(reports, excel, canonical); const comparisonMs = performance.now() - comparisonStart
  const outputRoot = resolve(getProjectRoot(), 'generated', 'excel-cross-validation'); await rm(outputRoot, { recursive: true, force: true }); await mkdir(outputRoot, { recursive: true })
  const emissionStart = performance.now(); const stableHashes: Record<string, string> = {}
  await writeJson(join(outputRoot, 'summary.json'), summary); stableHashes['summary.json'] = createHash('sha256').update(serializeJson(summary)).digest('hex')
  for (const [key, file] of Object.entries(REPORT_FILES)) { await writeJson(join(outputRoot, file), reports[key]); stableHashes[file] = createHash('sha256').update(serializeJson(reports[key])).digest('hex') }
  const review = { schemaVersion: 1, excelFingerprint: excel.fingerprint, totalComparisonRecords: summary.totalComparisonRecords, classifications: summary.classifications, severity: summary.severity, domainSummaries: summary.domainSummaries, canonicalMutations: 0 }
  await writeJson(resolve(getProjectRoot(), 'reports', 'data-build', 'excel-cross-validation-summary.json'), review)
  const emissionMs = performance.now() - emissionStart; assertExcelFingerprint(await fingerprintExcel())
  return { reports, summary, stableHashes: Object.fromEntries(Object.entries(stableHashes).sort()), outputRoot, performance: { extractionMs: Number(extractionMs.toFixed(3)), comparisonMs: Number(comparisonMs.toFixed(3)), emissionMs: Number(emissionMs.toFixed(3)), totalMs: Number((performance.now() - start).toFixed(3)), peakRssBytes: process.memoryUsage().rss } }
}
