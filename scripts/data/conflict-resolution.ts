import { createHash } from 'node:crypto'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildFullDryRun, type FullDryRunArtifacts } from './full-dry-run.ts'
import { ExcelValidationAdapter, runExcelCrossValidation, type ComparisonRecord, type ExcelSourceDocument } from './excel-validation.ts'
import { loadReviewDecisions, requireDecision } from './review-decisions.ts'
import { getProjectRoot, loadShowdownSource, parseAbilityRecord, verifySource } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

interface ConflictResolutionArtifacts {
  ability0284: Record<string, unknown>
  unresolvedAbilities: Record<string, unknown>
  moveConflictGroups: Record<string, unknown>
  abilitySlotConflictGroups: Record<string, unknown>
  evolutionConflicts: Record<string, unknown>
  summary: Record<string, unknown>
}

function rows(document: ExcelSourceDocument, sheetName: string): Map<number, Map<number, unknown>> {
  const result = new Map<number, Map<number, unknown>>()
  for (const cell of document.sheets[sheetName].cells) {
    const row = result.get(cell.row) ?? new Map<number, unknown>()
    row.set(cell.column, cell.cached)
    result.set(cell.row, row)
  }
  return result
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’'\s()-]/g, '')
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) result.set(key(value), [...(result.get(key(value)) ?? []), value])
  return result
}

async function ability0284Report(excel: ExcelSourceDocument, full: FullDryRunArtifacts): Promise<Record<string, unknown>> {
  const source = await verifySource(); const showdown = await loadShowdownSource(source)
  const abilityText = await readFile(join(source.cachePath, 'data', 'abilities.ts'), 'utf8')
  const zhRows = JSON.parse(await readFile(join(source.localization.cachePath, 'data', 'ability_list.json'), 'utf8')) as Array<Record<string, unknown>>
  const keys = ['vesselofruin', 'tabletsofruin', 'beadsofruin']
  const zhByEnglish = new Map(zhRows.map(row => [normalized(row.name_en), row]))
  const excelRows = [...rows(excel, '特性列表').entries()].filter(([, row]) => keys.includes(normalized(row.get(4))))
  const projectByShowdown = new Map(full.abilities.map(item => [String(item.showdownId), item]))
  const showdownRecords = keys.map(key => {
    const raw = parseAbilityRecord(showdown.abilities[key], key)
    const start = abilityText.indexOf(`\t${key}: {`); const snippet = start >= 0 ? abilityText.slice(start, start + 900) : ''
    const mechanic = snippet.match(/onAnyModify([A-Za-z]+)/)?.[1] ?? 'distinct-callback-not-parsed'
    const zh = zhByEnglish.get(normalized(raw.name))
    return {
      source: 'pokemon-showdown', upstreamKey: key, officialNumber: raw.num, englishName: raw.name,
      chineseName: zh?.name_zh ?? null, showdownId: key, generation: zh?.generation ?? raw.gen ?? null,
      mechanicsIdentity: `distinct:${mechanic}`, sourceLocator: `data/abilities.ts#${key}`,
      currentProjectProposal: projectByShowdown.get(key)?.abilityId ?? null,
      collisionReason: 'Pinned Showdown repeats num 284 across three distinct keys and mechanics implementations.',
    }
  })
  const zhRecords = keys.map(key => {
    const row = zhByEnglish.get(normalized((projectByShowdown.get(key)?.canonicalName as { en?: unknown })?.en))
    return {
      source: 'pokemon-dataset-zh', upstreamKey: row?.id ?? null, officialNumber: Number(row?.id),
      englishName: row?.name_en ?? null, chineseName: row?.name_zh ?? null, showdownId: key,
      generation: row?.generation ?? null, mechanicsIdentity: 'description-evidence-only',
      sourceLocator: 'data/ability_list.json', currentProjectProposal: projectByShowdown.get(key)?.abilityId ?? null,
      collisionReason: null,
    }
  })
  const excelRecords = excelRows.map(([rowNumber, row]) => {
    const key = keys.find(candidate => normalized(row.get(4)) === candidate) ?? null
    return {
      source: 'excel', upstreamKey: `特性列表!A${rowNumber}`, officialNumber: Number(row.get(1)),
      englishName: row.get(4), chineseName: row.get(2), showdownId: key, generation: 9,
      mechanicsIdentity: 'localized-description-evidence-only', sourceLocator: `特性列表!A${rowNumber}:E${rowNumber}`,
      currentProjectProposal: key ? projectByShowdown.get(key)?.abilityId ?? null : null, collisionReason: null,
    }
  })
  return {
    schemaVersion: 1,
    decisionId: 'review:ability:ruin-number-collision:0284',
    competingAbilities: keys,
    records: [...showdownRecords, ...zhRecords, ...excelRecords],
    conclusion: {
      collisionType: 'pokemon-showdown-source-number-collision',
      identityModelAssessment: 'Official number remains usable after a reviewed per-key source correction; the three identities must not be merged.',
      stableIdentityRule: { vesselofruin: 'ability:0284', tabletsofruin: 'ability:0286', beadsofruin: 'ability:0287' },
      evidenceStrength: 'two independent fixed legacy/localization sources agree, while Showdown supplies distinct keys and mechanics',
      guessedNumbers: false,
      blockingAfterDecision: false,
    },
  }
}

function unresolvedAbilityReport(full: FullDryRunArtifacts): Record<string, unknown> {
  const original = [
    ['vesselofruin', 284], ['tabletsofruin', 284], ['beadsofruin', 284],
    ['piercingdrill', 311], ['dragonize', 312], ['eelevate', 313], ['megasol', 315], ['firemane', 316], ['spicyspray', 318],
  ] as const
  const current = new Map(full.abilities.map(item => [String(item.showdownId), item]))
  const records = original.map(([showdownId, originalNumber]) => {
    const item = current.get(showdownId)
    const collisionRelated = originalNumber === 284
    return {
      showdownId, originalOfficialNumber: originalNumber, currentAbilityId: item?.abilityId ?? null,
      categories: collisionRelated ? ['number-collision-related'] : ['missing-localization-only', 'non-current/future', 'source-coverage-gap'],
      resolution: collisionRelated ? 'resolved-by-reviewed-fixed-source-number-map' : 'remains-unresolved-and-quarantined-for-current-scope',
      blocksRegistryIdentityAcceptance: collisionRelated ? false : false,
      blocksCurrentReleaseCompleteness: !collisionRelated,
      fakeNumberAssigned: false,
    }
  })
  return {
    schemaVersion: 1, originalUnresolvedCount: 9,
    groups: {
      'number-collision-related': records.filter(item => item.categories.includes('number-collision-related')).length,
      'missing-localization-only': records.filter(item => item.categories.includes('missing-localization-only')).length,
      'identity-ambiguous': 0, 'non-current/future': records.filter(item => item.categories.includes('non-current/future')).length,
      'source-coverage-gap': records.filter(item => item.categories.includes('source-coverage-gap')).length, other: 0,
    },
    records,
  }
}

function moveConflictGroupReport(comparisons: ComparisonRecord[], full: FullDryRunArtifacts): Record<string, unknown> {
  const mechanicsFields = new Set(['basePower', 'pp', 'category', 'accuracy', 'typeId'])
  const conflicts = comparisons.filter(item => item.classification === 'conflict' && mechanicsFields.has(item.canonicalField))
  const moveById = new Map(full.moves.map(move => [String(move.moveId), move]))
  const classify = (record: ComparisonRecord): string => {
    const move = moveById.get(record.canonicalEntityId ?? '')
    const name = String((move?.canonicalName as { en?: unknown })?.en ?? '')
    if (move?.availability === 'Past') return 'current-vs-legacy-mechanics'
    if (move?.availability === 'Future') return 'source-version-difference'
    if (/^(Max |G-Max )/.test(name) || String(move?.showdownId).startsWith('max') || String(move?.showdownId).startsWith('gmax')) return 'max-z-special-semantic-representation'
    if (['—', '-', '/'].includes(String(record.excelCachedValue ?? '').trim())) return 'excel-placeholder-ambiguity'
    return 'genuine-unresolved-mechanics-conflict'
  }
  const grouped = groupBy(conflicts, item => `${item.canonicalField}|${classify(item)}`)
  const groups = [...grouped.entries()].map(([key, records]) => {
    const [field, rootCause] = key.split('|')
    const confidence = rootCause === 'genuine-unresolved-mechanics-conflict' ? 'low' : rootCause === 'source-version-difference' ? 'medium' : 'high'
    return {
      groupId: `move-conflict:${field}:${rootCause}`, field, rootCause, count: records.length,
      representativeMoves: records.slice(0, 5).map(record => ({ entityId: record.canonicalEntityId, canonicalValue: record.canonicalValue, excelValue: record.excelCachedValue, locator: record.excelLocator })),
      sourceComparison: 'current pinned Showdown canonical candidate vs read-only legacy Excel',
      proposedClassification: rootCause === 'genuine-unresolved-mechanics-conflict' ? 'genuine-unresolved-mechanics-conflict' : rootCause,
      confidence, manualReviewStillNeeded: confidence !== 'high',
    }
  }).sort((a, b) => a.groupId.localeCompare(b.groupId, 'en'))
  return { schemaVersion: 1, inputConflictCount: conflicts.length, groupedCount: groups.reduce((sum, group) => sum + group.count, 0), groups, automaticOverridesApplied: 0 }
}

function abilitySlotGroupReport(comparisons: ComparisonRecord[], full: FullDryRunArtifacts, excel: ExcelSourceDocument): Record<string, unknown> {
  const slotRecords = comparisons.filter(item => item.domain === 'ability-slots')
  const conflicts = slotRecords.filter(item => item.classification === 'conflict')
  const abilityEnglishByZh = new Map<string, string>()
  const localization = new Map(full.localization.abilities.map(item => [String(item.entityId), String(item.name)]))
  for (const ability of full.abilities) {
    const zh = localization.get(String(ability.abilityId)); if (zh) abilityEnglishByZh.set(zh, normalized((ability.canonicalName as { en?: unknown }).en))
  }
  const excelEnglishByZh = new Map<string, string>()
  for (const row of rows(excel, '特性列表').values()) if (row.get(2) && row.get(4)) excelEnglishByZh.set(String(row.get(2)), normalized(row.get(4)))
  const byEntity = groupBy(slotRecords, item => item.canonicalEntityId ?? '')
  const classify = (record: ComparisonRecord): string => {
    const entityRows = byEntity.get(record.canonicalEntityId ?? '') ?? []
    const canonicalSet = new Set(entityRows.map(item => String(item.canonicalValue ?? '')).filter(Boolean))
    const excelSet = new Set(entityRows.map(item => String(item.excelCachedValue ?? '')).filter(value => value && value !== '/'))
    if (canonicalSet.size === excelSet.size && [...canonicalSet].every(value => excelSet.has(value))) return 'same-set-different-slot'
    const canonicalEnglish = abilityEnglishByZh.get(String(record.canonicalValue))
    const excelEnglish = excelEnglishByZh.get(String(record.excelCachedValue))
    if (canonicalEnglish && excelEnglish && canonicalEnglish === excelEnglish) return 'translation-identity-normalization'
    if (!record.excelCachedValue || record.excelCachedValue === '/') return 'excel-missing-slot'
    if (String(record.canonicalEntityId).startsWith('form:0718:')) return 'form-mismatch'
    return 'true-mechanics-difference'
  }
  const grouped = groupBy(conflicts, classify)
  const categories = ['translation-identity-normalization', 'excel-missing-slot', 'same-set-different-slot', 'form-mismatch', 'true-mechanics-difference']
  const reviewResolved = new Set(full.abilities
    .filter(item => item.reviewDecisionId === 'review:ability:ruin-number-collision:0284')
    .map(item => String(item.abilityId))).size
  const groups = categories.map(category => {
    const records = grouped.get(category) ?? []
    const resolvedEvidence = category === 'translation-identity-normalization' ? reviewResolved : 0
    return { groupId: `ability-slot:${category}`, category, count: records.length + resolvedEvidence, postDecisionOpenCount: records.length, reviewDecisionResolvedCount: resolvedEvidence, representativeRecords: records.slice(0, 6).map(record => ({ entityId: record.canonicalEntityId, slot: record.canonicalField, canonicalValue: record.canonicalValue, excelValue: record.excelCachedValue, locator: record.excelLocator })), reviewResolvedEvidence: resolvedEvidence ? [{ decisionId: 'review:ability:ruin-number-collision:0284', affectedAbilityIds: ['ability:0284', 'ability:0286', 'ability:0287'] }] : [], manualReviewStillNeeded: ['form-mismatch', 'true-mechanics-difference'].includes(category) }
  })
  return { schemaVersion: 1, inputConflictCountBeforeDecisions: conflicts.length + reviewResolved, inputConflictCountAfterDecisions: conflicts.length, groupedCount: groups.reduce((sum, group) => sum + group.count, 0), zygardeReviewed: conflicts.filter(item => String(item.canonicalEntityId).startsWith('form:0718:')).length, groups }
}

function evolutionConflictReport(comparisons: ComparisonRecord[]): Record<string, unknown> {
  const relevant = comparisons.filter(item => item.classification !== 'agree')
  const classify = (record: ComparisonRecord): string => {
    if (record.classification === 'canonical-only') return 'excel-weak-structure'
    if (record.canonicalField === 'evoLevel') return 'version-alternative'
    if (record.classification === 'representation-difference') return 'raw-text-only'
    const raw = String(record.excelCachedValue ?? '')
    if (raw.startsWith('所有')) return 'excel-weak-structure'
    if (raw.includes('（') || normalized(raw) === '多边兽2型') return 'raw-text-only'
    return 'actual-graph-conflict'
  }
  const grouped = groupBy(relevant, classify)
  const categories = ['excel-weak-structure', 'raw-text-only', 'version-alternative', 'actual-graph-conflict']
  const groups = categories.map(category => {
    const records = grouped.get(category) ?? []
    return { groupId: `evolution:${category}`, category, count: records.length, representativeRecords: records.slice(0, 8).map(record => ({ entityId: record.canonicalEntityId, field: record.canonicalField, canonicalValue: record.canonicalValue, excelValue: record.excelCachedValue, locator: record.excelLocator })), manualReviewStillNeeded: category === 'actual-graph-conflict' }
  })
  return { schemaVersion: 1, nonAgreementRecordCount: relevant.length, groups, milceryCompletenessRequiredFromExcel: false, automaticCanonicalChanges: 0 }
}

export async function buildConflictResolutionArtifacts(): Promise<ConflictResolutionArtifacts> {
  const decisions = await loadReviewDecisions()
  requireDecision(decisions, 'review:type-chart:water-vs-flying:excel-legacy-error')
  requireDecision(decisions, 'review:ability:ruin-number-collision:0284')
  requireDecision(decisions, 'review:move:nihil-light:current-release-quarantine')
  const excelDocument = await new ExcelValidationAdapter().read()
  const excel = await runExcelCrossValidation()
  const full = await buildFullDryRun()
  const ability0284 = await ability0284Report(excelDocument, full)
  const unresolvedAbilities = unresolvedAbilityReport(full)
  const moveConflictGroups = moveConflictGroupReport(excel.reports.moves.comparisons, full)
  const abilitySlotConflictGroups = abilitySlotGroupReport(excel.reports.mechanics.comparisons, full, excelDocument)
  const evolutionConflicts = evolutionConflictReport(excel.reports.evolutions.comparisons)
  const afterFull = (full.summary.conflicts as { bySeverity: Record<string, number> }).bySeverity
  const summary = {
    schemaVersion: 1, acceptedReviewDecisionCount: decisions.filter(item => item.status === 'accepted').length,
    fullDomainConflicts: { before: { info: 0, warning: 64, error: 2, blocking: 3 }, after: afterFull },
    excelCrossValidation: { before: { info: 23471, warning: 2035, error: 154, blocking: 0 }, after: excel.summary.severity },
    waterFlying: { decisionId: 'review:type-chart:water-vs-flying:excel-legacy-error', canonicalValue: 1, excelValue: 0.5, derivedRecordsLinked: excel.reports.derived.summary.reviewedRootCausePropagations },
    ability0284BlockingResolved: true, nihilLightCurrentReleaseQuarantineReviewed: true,
    remainingBlockers: full.conflicts.filter(item => item.severity === 'blocking').map(item => item.conflictId),
  }
  return { ability0284, unresolvedAbilities, moveConflictGroups, abilitySlotConflictGroups, evolutionConflicts, summary }
}

const FILES: Array<[keyof ConflictResolutionArtifacts, string]> = [
  ['ability0284', 'ability-0284.json'], ['unresolvedAbilities', 'unresolved-abilities.json'],
  ['moveConflictGroups', 'move-conflict-groups.json'], ['abilitySlotConflictGroups', 'ability-slot-conflict-groups.json'],
  ['evolutionConflicts', 'evolution-conflicts.json'], ['summary', 'summary.json'],
]

export async function runConflictResolution(): Promise<{ artifacts: ConflictResolutionArtifacts; outputRoot: string; hashes: Record<string, string> }> {
  const artifacts = await buildConflictResolutionArtifacts()
  const outputRoot = resolve(getProjectRoot(), 'generated', 'conflict-resolution')
  await rm(outputRoot, { recursive: true, force: true }); await mkdir(outputRoot, { recursive: true })
  const hashes: Record<string, string> = {}
  for (const [key, name] of FILES) {
    const content = serializeJson(artifacts[key]); await writeJson(join(outputRoot, name), artifacts[key])
    hashes[name] = createHash('sha256').update(content).digest('hex')
  }
  return { artifacts, outputRoot, hashes: Object.fromEntries(Object.entries(hashes).sort()) }
}
