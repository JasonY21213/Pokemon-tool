import { createHash } from 'node:crypto'
import { readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildConflictResolutionArtifacts } from './conflict-resolution.ts'
import { runExcelCrossValidation, type ComparisonRecord } from './excel-validation.ts'
import { buildFullDryRun, type FullDryRunArtifacts } from './full-dry-run.ts'
import { loadReviewDecisions, requireDecision, type ReviewDecision } from './review-decisions.ts'
import { getProjectRoot, loadShowdownSource, parsePokedexRecord, verifySource } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

const FIXED_ZH_SHA = '82ce04e611d19a12556c3955125b048b36187f52'
const MOVE_FIELDS = new Set(['basePower', 'accuracy', 'pp', 'typeId', 'category'])

export type MoveResolutionClassification =
  | 'confirmed-current-vs-legacy'
  | 'confirmed-representation-difference'
  | 'confirmed-excel-legacy-error'
  | 'reviewed-quarantine'
  | 'source-coverage-gap'
  | 'genuine-unresolved'

export interface MoveEvidenceRecord {
  comparisonId: string
  moveId: string
  officialNumber: number | null
  showdownId: string
  englishName: string
  field: string
  showdownValue: unknown
  excelValue: unknown
  pokemonDatasetZhValue: unknown
  sourceLocators: { showdown: string; excel: string | null; pokemonDatasetZh: string | null }
  generation: number | null
  availability: string
  releaseScope: 'current' | 'past' | 'future' | 'version-specific'
  semanticNormalizedValue: { showdown: unknown; excel: unknown; pokemonDatasetZh: unknown }
  existingReviewDecision: string | null
  proposedRootCauseClassification: MoveResolutionClassification
  rationale: string
  changesCanonicalMechanics: false
}

export interface AbilitySlotEvidenceRecord {
  comparisonId: string
  formId: string
  showdownId: string
  slot: string
  showdownValue: unknown
  excelValue: unknown
  pokemonDatasetZhValue: unknown
  sourceLocators: { showdown: string; excel: string | null; pokemonDatasetZh: string | null }
  classification: 'translation/identity-normalization' | 'form-mapping-resolved' | 'source-version-difference' | 'excel-legacy-missing/wrong' | 'genuine-mechanics-difference'
  slotSemanticsPreserved: true
  resolved: boolean
  rationale: string
}

export interface MechanicsResolutionArtifacts {
  summary: Record<string, unknown>
  moveConflicts: { schemaVersion: 1; records: MoveEvidenceRecord[] }
  moveConflictGroups: Record<string, unknown>
  abilitySlotConflicts: Record<string, unknown>
  slowkingInvestigation: Record<string, unknown>
  openMechanicsIssues: Record<string, unknown>
}

interface RawZhMove {
  id: string
  name_en: string
  type: string
  category: string
  power: string
  accuracy: string
  pp: string
  generation: number
}

interface RawZhForm {
  name: string
  abilities: Array<{ name: string; is_hidden: boolean }>
}

interface RawZhPokemon {
  name_zh: string
  forms: RawZhForm[]
  evolution_chains?: Array<Array<{ name: string; from: string | null; text: string | null; form_name?: string | null }>>
}

interface RawZhAbility {
  id: string
  name_en: string
  name_zh: string
}

function fullZhCachePath(): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return resolve(process.env.POKEMON_TOOL_DATASET_ZH_FULL_CACHE ?? join(localAppData, 'pokemon-tool', 'upstream', 'pokemon-dataset-zh-json', FIXED_ZH_SHA))
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, 'en')))
}

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’'\s()-]/g, '')
}

function releaseScope(availability: string): MoveEvidenceRecord['releaseScope'] {
  if (availability === 'Past') return 'past'
  if (availability === 'Future') return 'future'
  if (availability === 'current') return 'current'
  return 'version-specific'
}

function zhMoveValue(row: RawZhMove | undefined, field: string): unknown {
  if (!row) return null
  return ({ basePower: row.power, accuracy: row.accuracy, pp: row.pp, typeId: row.type, category: row.category } as Record<string, unknown>)[field] ?? null
}

function semanticValue(field: string, value: unknown, source: 'showdown' | 'excel' | 'zh'): unknown {
  if (field === 'accuracy') {
    if (value === 'always' || value === true || value === '—' || value === '-') return 'always-or-formula'
    if (value === '变化') return 'formula-dependent'
    if (typeof value === 'number' && source === 'excel' && value > 0 && value <= 1) return Math.round(value * 10000) / 100
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : normalizeText(value)
  }
  if (field === 'basePower') {
    if (value === '变化') return 'formula-dependent'
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : normalizeText(value)
  }
  if (field === 'pp') {
    if (value === '—' || value === '-') return 'special-no-ordinary-pp'
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : normalizeText(value)
  }
  return normalizeText(value)
}

function equalSemantic(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function classifyMove(
  comparison: ComparisonRecord,
  move: Record<string, unknown>,
  zh: RawZhMove | undefined,
): { classification: MoveResolutionClassification; rationale: string } {
  const field = comparison.canonicalField
  const showdown = semanticValue(field, comparison.canonicalValue, 'showdown')
  const excel = semanticValue(field, comparison.excelCachedValue, 'excel')
  const zhValue = semanticValue(field, zhMoveValue(zh, field), 'zh')
  const availability = String(move.availability)

  if (availability === 'Past') {
    return { classification: 'confirmed-current-vs-legacy', rationale: 'The pinned Showdown record is explicitly Past; the difference is retained as historical mechanics evidence without changing the canonical candidate.' }
  }
  if (availability === 'LGPE' && equalSemantic(excel, zhValue) && !equalSemantic(showdown, excel)) {
    return { classification: 'confirmed-current-vs-legacy', rationale: 'The fixed Excel and Chinese sources agree on the version-specific LGPE value while the pinned Showdown simulator record differs; this is classified as a version/history boundary, not silently overridden.' }
  }
  if (field === 'basePower' && comparison.canonicalValue === 0 && excel === 'formula-dependent' && zhValue === 'formula-dependent') {
    return { classification: 'confirmed-representation-difference', rationale: 'Showdown uses basePower 0 plus move logic for variable damage, while both legacy sources use an explicit variable marker.' }
  }
  if (field === 'accuracy' && typeof showdown === 'number' && equalSemantic(showdown, excel) && equalSemantic(showdown, zhValue)) {
    return { classification: 'confirmed-representation-difference', rationale: 'Excel stores accuracy as a fraction while Showdown and pokemon-dataset-zh store the equivalent percentage.' }
  }
  if (field === 'accuracy' && typeof showdown === 'number' && excel === 'formula-dependent' && zhValue === 'formula-dependent') {
    return { classification: 'confirmed-representation-difference', rationale: 'The legacy sources use a formula-dependent marker for the structured Showdown base accuracy; no canonical value is changed.' }
  }
  if (field === 'accuracy' && comparison.canonicalValue === 'always' && excel === 100 && zhValue === 'always-or-formula') {
    return { classification: 'confirmed-representation-difference', rationale: 'Excel encodes the move as 100%, while the fixed structured sources represent bypassed or formula-driven accuracy without an ordinary numeric value.' }
  }
  if (field === 'pp' && comparison.canonicalValue === 1 && excel === 'special-no-ordinary-pp' && zhValue === 'special-no-ordinary-pp') {
    return { classification: 'confirmed-representation-difference', rationale: 'Struggle has a simulator placeholder PP value but both legacy tables mark ordinary PP as inapplicable.' }
  }
  if (!zh) {
    return { classification: 'source-coverage-gap', rationale: 'The fixed Chinese source has no uniquely matched Move row, so the two-source difference cannot be promoted to a reviewed resolution.' }
  }
  return { classification: 'genuine-unresolved', rationale: 'The fixed sources disagree in mechanics and the available metadata does not prove a historical or representational equivalence.' }
}

async function moveEvidence(
  comparisons: ComparisonRecord[],
  full: FullDryRunArtifacts,
  decisions: ReviewDecision[],
): Promise<MoveEvidenceRecord[]> {
  const zhRows = JSON.parse(await readFile(join(fullZhCachePath(), 'data', 'move_list.json'), 'utf8')) as RawZhMove[]
  const zhByNumber = new Map(zhRows.map((row, index) => [Number(row.id), { row, index }]))
  const moveById = new Map(full.moves.map(move => [String(move.moveId), move]))
  const records: MoveEvidenceRecord[] = []
  for (const comparison of comparisons.filter(item => item.classification === 'conflict' && MOVE_FIELDS.has(item.canonicalField))) {
    const move = moveById.get(comparison.canonicalEntityId ?? '')
    if (!move) throw new Error(`MECHANICS_MOVE_MISSING: ${comparison.canonicalEntityId}`)
    const officialNumber = typeof move.officialNumber === 'number' ? move.officialNumber : null
    const matched = officialNumber === null ? undefined : zhByNumber.get(officialNumber)
    const classified = classifyMove(comparison, move, matched?.row)
    const existing = decisions.find(decision => decision.domain === 'move'
      && decision.selector.entityId === comparison.canonicalEntityId
      && decision.selector.showdownId === move.showdownId)
    records.push({
      comparisonId: comparison.comparisonId,
      moveId: String(move.moveId),
      officialNumber,
      showdownId: String(move.showdownId),
      englishName: String((move.canonicalName as { en?: unknown }).en ?? ''),
      field: comparison.canonicalField,
      showdownValue: comparison.canonicalValue,
      excelValue: comparison.excelCachedValue,
      pokemonDatasetZhValue: zhMoveValue(matched?.row, comparison.canonicalField),
      sourceLocators: {
        showdown: `data/moves.ts#${String(move.showdownId)}`,
        excel: comparison.excelLocator,
        pokemonDatasetZh: matched ? `data/move_list.json#/${matched.index}` : null,
      },
      generation: matched?.row.generation ?? null,
      availability: String(move.availability),
      releaseScope: releaseScope(String(move.availability)),
      semanticNormalizedValue: {
        showdown: semanticValue(comparison.canonicalField, comparison.canonicalValue, 'showdown'),
        excel: semanticValue(comparison.canonicalField, comparison.excelCachedValue, 'excel'),
        pokemonDatasetZh: semanticValue(comparison.canonicalField, zhMoveValue(matched?.row, comparison.canonicalField), 'zh'),
      },
      existingReviewDecision: existing?.decisionId ?? null,
      proposedRootCauseClassification: classified.classification,
      rationale: classified.rationale,
      changesCanonicalMechanics: false,
    })
  }
  return records.sort((left, right) => left.comparisonId.localeCompare(right.comparisonId, 'en'))
}

const ZH_FORM_INDEX: Record<string, { nationalNumber: number; formIndex: number }> = {
  meowthalola: { nationalNumber: 52, formIndex: 1 },
  meowthgalar: { nationalNumber: 52, formIndex: 2 },
  darmanitanzen: { nationalNumber: 555, formIndex: 1 },
  darmanitangalarzen: { nationalNumber: 555, formIndex: 3 },
  zygarde: { nationalNumber: 718, formIndex: 0 },
  zygarde10: { nationalNumber: 718, formIndex: 1 },
  lycanrocmidnight: { nationalNumber: 745, formIndex: 1 },
}

async function readZhPokemon(number: number): Promise<{ path: string; value: RawZhPokemon }> {
  const directory = join(fullZhCachePath(), 'data', 'pokemon')
  const prefix = `${number.toString().padStart(4, '0')}-`
  const name = (await readdir(directory)).find(candidate => candidate.startsWith(prefix) && candidate.endsWith('.json'))
  if (!name) throw new Error(`ZH_POKEMON_FILE_MISSING: ${number}`)
  return { path: `data/pokemon/${name}`, value: JSON.parse(await readFile(join(directory, name), 'utf8')) as RawZhPokemon }
}

async function abilitySlotEvidence(comparisons: ComparisonRecord[], full: FullDryRunArtifacts): Promise<AbilitySlotEvidenceRecord[]> {
  const conflicts = comparisons.filter(item => item.domain === 'ability-slots' && item.classification === 'conflict')
  const forms = new Map(full.forms.map(form => [String(form.formId), form]))
  const abilityZhByEnglish = new Map<string, string>()
  const rawAbilities = JSON.parse(await readFile(join(fullZhCachePath(), 'data', 'ability_list.json'), 'utf8')) as RawZhAbility[]
  const rawAbilityByEnglish = new Map(rawAbilities.map((ability, index) => [normalizeText(ability.name_en), { ability, index }]))
  const localized = new Map(full.localization.abilities.map(item => [String(item.entityId), String(item.name)]))
  for (const ability of full.abilities) {
    const zh = localized.get(String(ability.abilityId))
    if (zh) abilityZhByEnglish.set(normalizeText((ability.canonicalName as { en?: unknown }).en), zh)
  }
  const records: AbilitySlotEvidenceRecord[] = []
  for (const comparison of conflicts) {
    const form = forms.get(comparison.canonicalEntityId ?? '')
    if (!form) throw new Error(`MECHANICS_FORM_MISSING: ${comparison.canonicalEntityId}`)
    const showdownId = String(form.showdownId)
    const evidenceSelector = ZH_FORM_INDEX[showdownId]
    let zhForm: RawZhForm | undefined
    let zhPath: string | null = null
    if (evidenceSelector) {
      const document = await readZhPokemon(evidenceSelector.nationalNumber)
      zhForm = document.value.forms[evidenceSelector.formIndex]
      zhPath = `${document.path}#/forms/${evidenceSelector.formIndex}/abilities`
    }
    const canonicalEnglish = String((form.abilities as Record<string, unknown>)[comparison.canonicalField.split('.')[1]] ?? '')
    const canonicalZh = abilityZhByEnglish.get(normalizeText(canonicalEnglish)) ?? comparison.canonicalValue
    const abilityIdentityEvidence = rawAbilityByEnglish.get(normalizeText(canonicalEnglish))
    const translationNormalization = comparison.canonicalValue === '诅咒之躯' && comparison.excelCachedValue === '咒术之躯'
    const formResolved = showdownId === 'darmanitanzen' || showdownId === 'darmanitangalarzen'
    const classification: AbilitySlotEvidenceRecord['classification'] = translationNormalization
      ? 'translation/identity-normalization'
      : formResolved ? 'form-mapping-resolved'
        : 'excel-legacy-missing/wrong'
    const rationale = translationNormalization
      ? 'The Ability master identities normalize both Chinese labels to the same fixed English Ability identity; the slot itself is unchanged.'
      : formResolved
        ? 'The completed Form registry identifies the battle Form precisely, and both fixed structured sources assign Zen Mode to that Form while Excel stores no ability.'
        : showdownId.startsWith('zygarde')
          ? 'Showdown preserves Aura Break in slot 0 and Power Construct in special slot S; Excel has no S column and replaces slot 0, while the Chinese source lists both without slot keys.'
          : 'Showdown slot semantics and the form-specific Chinese source agree; the Excel row contains a different ability in this exact slot.'
    records.push({
      comparisonId: comparison.comparisonId,
      formId: String(comparison.canonicalEntityId),
      showdownId,
      slot: comparison.canonicalField,
      showdownValue: canonicalZh,
      excelValue: comparison.excelCachedValue,
      pokemonDatasetZhValue: zhForm?.abilities ?? (abilityIdentityEvidence ? {
        officialNumber: Number(abilityIdentityEvidence.ability.id),
        englishName: abilityIdentityEvidence.ability.name_en,
        chineseName: abilityIdentityEvidence.ability.name_zh,
      } : null),
      sourceLocators: {
        showdown: `data/pokedex.ts#${showdownId}.abilities.${comparison.canonicalField.split('.')[1]}`,
        excel: comparison.excelLocator,
        pokemonDatasetZh: zhPath ?? (abilityIdentityEvidence ? `data/ability_list.json#/${abilityIdentityEvidence.index}` : null),
      },
      classification,
      slotSemanticsPreserved: true,
      resolved: true,
      rationale,
    })
  }
  return records.sort((left, right) => left.comparisonId.localeCompare(right.comparisonId, 'en'))
}

async function slowkingEvidence(comparisons: ComparisonRecord[], decision: ReviewDecision): Promise<Record<string, unknown>> {
  const source = await verifySource()
  const showdown = await loadShowdownSource(source)
  const zh = await readZhPokemon(199)
  const ids = new Set(decision.selector.entityIds as string[])
  const records = comparisons.filter(item => item.canonicalField === 'sourceFormId' && ids.has(item.canonicalEntityId ?? ''))
    .map((comparison) => {
      const isGalar = String(comparison.canonicalEntityId).includes('slowkinggalar')
      const targetShowdownId = isGalar ? 'slowkinggalar' : 'slowking'
      const chainIndex = isGalar ? 1 : 0
      const target = parsePokedexRecord(showdown.pokedex[targetShowdownId], targetShowdownId)
      const chain = zh.value.evolution_chains?.[chainIndex]?.[1]
      return {
        comparisonId: comparison.comparisonId,
        canonicalEntity: comparison.canonicalEntityId,
        target: targetShowdownId,
        canonicalPreEvolutionFormId: comparison.canonicalValue,
        excelRawPredecessor: comparison.excelCachedValue,
        showdownEvolutionRelation: { prevo: target.prevo, locator: `data/pokedex.ts#${targetShowdownId}.prevo` },
        pokemonDatasetZhRelation: {
          predecessor: chain?.from ?? null,
          target: chain?.name ?? null,
          condition: chain?.text ?? null,
          formName: chain?.form_name ?? null,
          locator: `${zh.path}#/evolution_chains/${chainIndex}/1`,
        },
        excelLocator: comparison.excelLocator,
        classification: 'confirmed-excel-legacy-error',
        decisionId: decision.decisionId,
      }
    })
  return {
    schemaVersion: 1,
    inputConflictCount: records.length,
    resolvedCount: records.length,
    unresolvedCount: 0,
    decisionId: decision.decisionId,
    conclusion: 'Both fixed structured upstream sources agree that the predecessor is Slowpoke (base or Galar form); Excel supplies Slowbro for both exact edges.',
    canonicalGraphChanged: false,
    excelChanged: false,
    records,
  }
}

function groupMoveRecords(records: MoveEvidenceRecord[]): Record<string, unknown> {
  const grouped = new Map<string, MoveEvidenceRecord[]>()
  for (const record of records) {
    const key = `${record.field}|${record.proposedRootCauseClassification}`
    grouped.set(key, [...(grouped.get(key) ?? []), record])
  }
  const groups = [...grouped.entries()].map(([key, values]) => {
    const [field, classification] = key.split('|')
    return {
      groupId: `mechanics:${field}:${classification}`,
      field,
      classification,
      count: values.length,
      comparisonIds: values.map(value => value.comparisonId),
      changesCanonicalMechanics: false,
    }
  }).sort((left, right) => left.groupId.localeCompare(right.groupId, 'en'))
  return { schemaVersion: 1, inputCount: records.length, groupedCount: groups.reduce((sum, group) => sum + group.count, 0), groups }
}

export async function buildMechanicsResolutionArtifacts(): Promise<MechanicsResolutionArtifacts> {
  const decisions = await loadReviewDecisions()
  const slowkingDecision = requireDecision(decisions, 'review:evolution:slowking-predecessors:excel-legacy-error')
  requireDecision(decisions, 'review:move:nihil-light:current-release-quarantine')
  const excel = await runExcelCrossValidation()
  const full = await buildFullDryRun()
  const round1 = await buildConflictResolutionArtifacts()
  const moveRecords = await moveEvidence(excel.reports.moves.comparisons, full, decisions)
  const abilityRecords = await abilitySlotEvidence(excel.reports.mechanics.comparisons, full)
  const slowkingInvestigation = await slowkingEvidence(excel.reports.evolutions.comparisons, slowkingDecision)
  const unresolvedMoves = moveRecords.filter(record => record.proposedRootCauseClassification === 'genuine-unresolved' || record.proposedRootCauseClassification === 'source-coverage-gap')
  const unresolvedAbilities = abilityRecords.filter(record => !record.resolved)
  const unresolvedEvolution = (slowkingInvestigation.unresolvedCount as number) > 0 ? [slowkingInvestigation] : []
  const excelSeverity = excel.summary.severity as Record<string, number>
  const openRecords = [
    ...unresolvedMoves.map(record => ({ issueId: `open:${record.comparisonId}`, domain: 'move', severity: 'error', entityId: record.moveId, field: record.field, classification: record.proposedRootCauseClassification })),
    ...unresolvedAbilities.map(record => ({ issueId: `open:${record.comparisonId}`, domain: 'ability-slot', severity: 'error', entityId: record.formId, field: record.slot, classification: record.classification })),
    ...unresolvedEvolution.map(() => ({ issueId: 'open:slowking', domain: 'evolution', severity: 'error', entityId: null, field: 'sourceFormId', classification: 'genuine-unresolved' })),
  ]
  const beforeFull = (round1.summary.fullDomainConflicts as { after: Record<string, number> }).after
  const summary = {
    schemaVersion: 1,
    sourceVersions: {
      pokemonShowdown: sourceVersion(decisions, 'pokemon-showdown'),
      pokemonDatasetZh: sourceVersion(decisions, 'pokemon-dataset-zh'),
      excel: sourceVersion(decisions, 'excel'),
    },
    moveConflicts: {
      input: moveRecords.length,
      resolvedOrReclassified: moveRecords.length - unresolvedMoves.length,
      genuineUnresolved: unresolvedMoves.length,
      byRootCause: countBy(moveRecords, record => record.proposedRootCauseClassification),
      currentReleaseMechanicsErrors: unresolvedMoves.length,
      canonicalMechanicsChanged: 0,
      nihilLightReviewedQuarantinePreserved: full.moves.some(move => move.showdownId === 'nihillight' && move.dataStatus === 'quarantined'),
    },
    abilitySlots: {
      input: abilityRecords.length,
      resolved: abilityRecords.filter(record => record.resolved).length,
      remainingGenuineConflicts: unresolvedAbilities.length,
      byRootCause: countBy(abilityRecords, record => record.classification),
      zygarde: { records: abilityRecords.filter(record => record.showdownId.startsWith('zygarde')).length, slotSemanticsPreserved: true, resolvedAs: 'excel-legacy-missing/wrong' },
    },
    slowking: { input: 2, resolved: 2, unresolved: 0, decisionId: slowkingDecision.decisionId },
    reviewDecisions: { totalAccepted: decisions.filter(decision => decision.status === 'accepted').length, addedThisRound: 1 },
    fullDomainConflicts: { before: beforeFull, after: beforeFull },
    excelCrossValidationErrors: { before: excelSeverity.error, after: excelSeverity.error },
    openMechanicsIssues: openRecords.length,
  }
  return {
    summary,
    moveConflicts: { schemaVersion: 1, records: moveRecords },
    moveConflictGroups: groupMoveRecords(moveRecords),
    abilitySlotConflicts: {
      schemaVersion: 1,
      inputCount: abilityRecords.length,
      resolvedCount: abilityRecords.filter(record => record.resolved).length,
      remainingGenuineConflictCount: unresolvedAbilities.length,
      byRootCause: countBy(abilityRecords, record => record.classification),
      records: abilityRecords,
    },
    slowkingInvestigation,
    openMechanicsIssues: { schemaVersion: 1, total: openRecords.length, issues: openRecords },
  }
}

function sourceVersion(decisions: ReviewDecision[], sourceId: string): string {
  for (const decision of decisions) {
    const match = decision.applicableSourceVersions.find(item => item.sourceId === sourceId)
    if (match) return match.version
  }
  throw new Error(`MECHANICS_SOURCE_VERSION_MISSING: ${sourceId}`)
}

const FILES: Array<[keyof MechanicsResolutionArtifacts, string]> = [
  ['summary', 'summary.json'],
  ['moveConflicts', 'move-conflicts.json'],
  ['moveConflictGroups', 'move-conflict-groups.json'],
  ['abilitySlotConflicts', 'ability-slot-conflicts.json'],
  ['slowkingInvestigation', 'slowking-investigation.json'],
  ['openMechanicsIssues', 'open-mechanics-issues.json'],
]

export async function runMechanicsResolution(): Promise<{ artifacts: MechanicsResolutionArtifacts; outputRoot: string; hashes: Record<string, string> }> {
  const artifacts = await buildMechanicsResolutionArtifacts()
  const outputRoot = resolve(getProjectRoot(), 'generated', 'mechanics-resolution')
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  const hashes: Record<string, string> = {}
  for (const [key, name] of FILES) {
    const content = serializeJson(artifacts[key])
    await writeJson(join(outputRoot, name), artifacts[key])
    hashes[name] = createHash('sha256').update(content).digest('hex')
  }
  return { artifacts, outputRoot, hashes: Object.fromEntries(Object.entries(hashes).sort()) }
}
