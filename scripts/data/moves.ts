import {
  AccuracySemanticSchema,
  IdentityMatchSchema,
  MoveSchema,
  NumericSemanticSchema,
  ValueProvenanceSchema,
  type AccuracySemantic,
  type IdentityMatch,
  type Move,
  type NumericSemantic,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import type { PokemonDatasetZhAdapterOutput, ZhMoveCandidate } from './pokemon-dataset-zh.ts'
import { parseMoveRecord, type RegistryEntity, type ShowdownSourceData, type VerifiedSource } from './source.ts'

export const MOVE_FIXTURE_IDS = [
  'pound', 'swordsdance', 'swift', 'triattack', 'triplekick',
  '10000000voltthunderbolt', 'maxflare', 'gmaxwildfire',
  'ivycudgel', 'terastarstorm', 'malignantchain', 'nihillight',
] as const

const ZH_TYPE_IDS = new Map([
  ['一般', 'type:normal'], ['格斗', 'type:fighting'], ['飞行', 'type:flying'], ['毒', 'type:poison'],
  ['地面', 'type:ground'], ['岩石', 'type:rock'], ['虫', 'type:bug'], ['幽灵', 'type:ghost'],
  ['钢', 'type:steel'], ['火', 'type:fire'], ['水', 'type:water'], ['草', 'type:grass'],
  ['电', 'type:electric'], ['超能力', 'type:psychic'], ['冰', 'type:ice'], ['龙', 'type:dragon'],
  ['恶', 'type:dark'], ['妖精', 'type:fairy'],
])
const ZH_CATEGORIES = new Map([['物理', 'physical'], ['特殊', 'special'], ['变化', 'status']])

export interface MoveConflict {
  code: string
  moveId: string
  field: string
  showdownValue: unknown
  pokemonDatasetZhValue: unknown
  severity: 'warning' | 'error'
  sourceReferenceId: string
  sourcePointer: string
}

export interface QuarantinedMove {
  move: Move
  reason: string
  conflicts: MoveConflict[]
}

export interface MoveBuildResult {
  stableMoves: Move[]
  quarantinedMoves: QuarantinedMove[]
  localizationEntries: Array<{ entityId: Move['moveId']; name: string }>
  identityMatches: IdentityMatch[]
  valueProvenance: ValueProvenance[]
  conflicts: MoveConflict[]
  mappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
}

function normalizedEnglish(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function registryMove(source: VerifiedSource, showdownId: string): RegistryEntity {
  const matches = source.registry.filter(entity => entity.kind === 'move' && entity.showdownId === showdownId)
  if (matches.length !== 1) throw new Error(`MOVE_REGISTRY_CONFLICT: ${showdownId} matched ${matches.length} entries`)
  return matches[0]
}

function sourceReferenceId(source: VerifiedSource, path: string): string {
  const reference = source.sourceReferenceByPath.get(path)
  if (!reference) throw new Error(`Missing Showdown SourceReference for ${path}`)
  return reference.sourceReferenceId
}

function availability(isNonstandard?: string): Move['availability'] {
  if (isNonstandard === 'Past') return { lifecycle: 'past', obtainability: 'unknown' }
  if (isNonstandard === 'Future') return { lifecycle: 'future', obtainability: 'unobtainable' }
  if (isNonstandard === 'Unobtainable') return { lifecycle: 'current', obtainability: 'unobtainable' }
  if (isNonstandard) return { lifecycle: 'unknown', obtainability: 'unknown' }
  return { lifecycle: 'current', obtainability: 'obtainable' }
}

// Mirrors the fixed snapshot's sim/dex-moves.ts generation rules.
export function deriveMoveGeneration(num: number, isMax: boolean): number {
  if (num >= 827 && !isMax) return 9
  if (num >= 743) return 8
  if (num >= 622) return 7
  if (num >= 560) return 6
  if (num >= 468) return 5
  if (num >= 355) return 4
  if (num >= 252) return 3
  if (num >= 166) return 2
  if (num >= 1) return 1
  throw new Error(`INVALID_MOVE_NUMBER: ${num}`)
}

export function parseChineseAccuracy(raw: string): AccuracySemantic {
  if (raw === '—') return AccuracySemanticSchema.parse({ kind: 'unknown' })
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value <= 100
    ? AccuracySemanticSchema.parse({ kind: 'percent', value })
    : AccuracySemanticSchema.parse({ kind: 'unknown' })
}

export function parseChineseNumeric(raw: string): NumericSemantic {
  if (raw === '—') return NumericSemanticSchema.parse({ kind: 'unknown' })
  if (raw === '变化') return NumericSemanticSchema.parse({ kind: 'variable' })
  const value = Number(raw)
  return Number.isFinite(value) && value > 0
    ? NumericSemanticSchema.parse({ kind: 'numeric', value })
    : NumericSemanticSchema.parse({ kind: 'unknown' })
}

function normalizeBasePower(raw: ReturnType<typeof parseMoveRecord>): NumericSemantic {
  if (raw.isMax) return { kind: 'variable' }
  if (raw.category === 'Status' || raw.basePower === 0) return { kind: 'not-applicable' }
  return { kind: 'numeric', value: raw.basePower }
}

function normalizePp(raw: ReturnType<typeof parseMoveRecord>): NumericSemantic {
  if (raw.isMax || raw.isZ) return { kind: 'not-applicable' }
  return raw.pp > 0 ? { kind: 'numeric', value: raw.pp } : { kind: 'unknown' }
}

function officialNumberFor(showdownId: string, num: number): number | null {
  return showdownId === 'gmaxwildfire' ? null : num
}

function mappingClassFor(showdownId: string): IdentityMatch['mappingClass'] {
  return showdownId === 'gmaxwildfire' ? 'rule-based' : 'automatic'
}

export function assertUniqueMoveNumbers(moves: Move[]): void {
  const seen = new Set<number>()
  for (const move of moves) {
    if (move.officialNumber === null) continue
    if (seen.has(move.officialNumber)) throw new Error(`DUPLICATE_MOVE_NUMBER: ${move.officialNumber}`)
    seen.add(move.officialNumber)
  }
}

export function requireZhMoveCandidate(move: Move, candidates: ZhMoveCandidate[]): ZhMoveCandidate {
  const matches = move.officialNumber === null
    ? candidates.filter(candidate => candidate.officialNumberRaw === '—'
      && normalizedEnglish(candidate.englishName) === move.showdownId
      && candidate.categoryRaw === '超极巨')
    : candidates.filter(candidate => Number(candidate.officialNumberRaw) === move.officialNumber)
  if (matches.length !== 1) throw new Error(`ZH_MOVE_IDENTITY_CONFLICT: ${move.moveId} matched ${matches.length} rows`)
  const candidate = matches[0]
  if (normalizedEnglish(candidate.englishName) !== move.showdownId) {
    throw new Error(`ZH_MOVE_ENGLISH_CONFLICT: ${move.moveId} expected ${move.canonicalName.en}, received ${candidate.englishName}`)
  }
  return candidate
}

function compareCandidate(move: Move, candidate: ZhMoveCandidate): MoveConflict[] {
  const conflicts: MoveConflict[] = []
  const add = (code: string, field: string, showdownValue: unknown, pokemonDatasetZhValue: unknown, severity: 'warning' | 'error' = 'warning') => {
    conflicts.push({ code, moveId: move.moveId, field, showdownValue, pokemonDatasetZhValue, severity, sourceReferenceId: candidate.sourceReferenceId, sourcePointer: `${candidate.sourcePointer}/${field}` })
  }
  const zhType = ZH_TYPE_IDS.get(candidate.typeRaw)
  if (zhType && zhType !== move.typeId) add('MOVE_TYPE_CONFLICT', 'type', move.typeId, zhType)
  const zhCategory = ZH_CATEGORIES.get(candidate.categoryRaw)
  if (zhCategory && zhCategory !== move.category) add('MOVE_CATEGORY_CONFLICT', 'category', move.category, zhCategory)
  const power = parseChineseNumeric(candidate.powerRaw)
  if (power.kind === 'numeric' && move.basePower.kind === 'numeric' && power.value !== move.basePower.value) {
    add('MOVE_BASE_POWER_CONFLICT', 'power', move.basePower, power, move.showdownId === 'nihillight' ? 'error' : 'warning')
  }
  const accuracy = parseChineseAccuracy(candidate.accuracyRaw)
  if (accuracy.kind === 'percent' && move.accuracy.kind === 'percent' && accuracy.value !== move.accuracy.value) {
    add('MOVE_ACCURACY_CONFLICT', 'accuracy', move.accuracy, accuracy)
  }
  const pp = parseChineseNumeric(candidate.ppRaw)
  if (pp.kind === 'numeric' && move.pp.kind === 'numeric' && pp.value !== move.pp.value) add('MOVE_PP_CONFLICT', 'pp', move.pp, pp)
  if (candidate.generation !== move.generation) add('MOVE_GENERATION_CONFLICT', 'generation', move.generation, candidate.generation)
  return conflicts
}

export function buildMoves(data: ShowdownSourceData, source: VerifiedSource, zh: PokemonDatasetZhAdapterOutput): MoveBuildResult {
  const movesReference = sourceReferenceId(source, 'data/moves.ts')
  const dexMovesReference = sourceReferenceId(source, 'sim/dex-moves.ts')
  const allMoves: Move[] = []
  const identities: IdentityMatch[] = []
  const provenance: ValueProvenance[] = []
  const localizations: Array<{ entityId: Move['moveId']; name: string }> = []
  const conflicts: MoveConflict[] = []
  const quarantined: QuarantinedMove[] = []

  for (const showdownId of MOVE_FIXTURE_IDS) {
    const value = data.moves[showdownId]
    if (value === undefined) throw new Error(`Missing Showdown Move record: ${showdownId}`)
    const raw = parseMoveRecord(value, showdownId)
    const registry = registryMove(source, showdownId)
    const mappingClass = mappingClassFor(showdownId)
    const officialNumber = officialNumberFor(showdownId, raw.num)
    if (showdownId === 'gmaxwildfire' && typeof raw.isMax !== 'string') {
      throw new Error('GMAX_MOVE_CATEGORY_CONFLICT: G-Max Wildfire must be a named Showdown Max Move')
    }
    const move = MoveSchema.parse({
      moveId: registry.projectId,
      officialNumber,
      showdownId,
      canonicalName: { en: raw.name },
      typeId: `type:${raw.type.toLowerCase()}`,
      category: raw.category.toLowerCase(),
      basePower: normalizeBasePower(raw),
      accuracy: raw.accuracy === true ? { kind: 'always' } : { kind: 'percent', value: raw.accuracy },
      pp: normalizePp(raw),
      priority: raw.priority,
      target: raw.target,
      generation: deriveMoveGeneration(raw.num, Boolean(raw.isMax)),
      availability: availability(raw.isNonstandard),
      dataStatus: 'complete',
    })
    const expectedProjectId = officialNumber === null ? 'move:special:gmax-wildfire' : `move:${officialNumber.toString().padStart(4, '0')}`
    if (move.moveId !== expectedProjectId) throw new Error(`MOVE_REGISTRY_ID_CONFLICT: ${showdownId}`)
    allMoves.push(move)
    identities.push(IdentityMatchSchema.parse({ entityId: move.moveId, entityKind: 'move', showdownId, mappingClass, sourceReferenceId: movesReference }))

    const add = (fieldPath: string, reference: string, method: ValueProvenance['method'], selected = true, sourcePointer?: string) => provenance.push(ValueProvenanceSchema.parse({
      entityId: move.moveId, fieldPath, sourceReferenceId: reference, method, mappingClass, selected, ...(sourcePointer ? { sourcePointer } : {}),
    }))
    add('/moveId', movesReference, officialNumber === null ? 'curated-exception' : 'project-normalization', true, `/${showdownId}`)
    add('/officialNumber', movesReference, officialNumber === null ? 'curated-exception' : 'source-literal', true, `/${showdownId}/num`)
    add('/showdownId', movesReference, 'source-literal', true, `/${showdownId}`)
    add('/canonicalName/en', movesReference, 'source-literal', true, `/${showdownId}/name`)
    for (const [field, pointer] of [['/typeId', 'type'], ['/category', 'category'], ['/basePower', 'basePower'], ['/accuracy', 'accuracy'], ['/pp', 'pp'], ['/priority', 'priority'], ['/target', 'target']] as const) {
      add(field, movesReference, field === '/typeId' || field === '/basePower' || field === '/accuracy' || field === '/pp' ? 'project-normalization' : 'source-literal', true, `/${showdownId}/${pointer}`)
    }
    add('/generation', dexMovesReference, 'showdown-dex-rule', true, '/Move/constructor/generation')
    add('/availability', movesReference, 'project-normalization', true, `/${showdownId}/isNonstandard`)

    const candidate = requireZhMoveCandidate(move, zh.moves)
    const candidateConflicts = compareCandidate(move, candidate)
    conflicts.push(...candidateConflicts)
    const isQuarantined = move.availability.lifecycle === 'future' || candidateConflicts.some(conflict => conflict.severity === 'error')
    if (isQuarantined) {
      quarantined.push({ move, reason: 'Future lifecycle and conflicting upstream mechanics require review before stable emission.', conflicts: candidateConflicts })
      for (const conflict of candidateConflicts) {
        add(`/conflictCandidates/pokemon-dataset-zh/${conflict.field}`, conflict.sourceReferenceId, 'source-literal', false, `${candidate.sourcePointer}/${conflict.field}`)
      }
    } else {
      localizations.push({ entityId: move.moveId, name: candidate.chineseName })
      provenance.push(ValueProvenanceSchema.parse({
        entityId: move.moveId,
        fieldPath: '/localization/zh-CN/name',
        sourceReferenceId: candidate.sourceReferenceId,
        method: 'source-literal',
        mappingClass,
        selected: true,
        sourcePointer: `${candidate.sourcePointer}/name_zh`,
      }))
    }
  }
  assertUniqueMoveNumbers(allMoves)
  const stableMoves = allMoves.filter(move => !quarantined.some(entry => entry.move.moveId === move.moveId))
  return {
    stableMoves,
    quarantinedMoves: quarantined,
    localizationEntries: localizations.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en')),
    identityMatches: identities.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en')),
    valueProvenance: provenance.sort((a, b) => `${a.entityId}${a.fieldPath}${a.selected}`.localeCompare(`${b.entityId}${b.fieldPath}${b.selected}`, 'en')),
    conflicts,
    mappingCounts: { automatic: 11, ruleBased: 1, manualException: 0, unresolved: 0 },
  }
}
