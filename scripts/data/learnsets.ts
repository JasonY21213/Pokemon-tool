import { z } from 'zod'
import { parsePokedexRecord, type RawPokedexRecord } from './source.ts'

const MoveSourcesSchema = z.array(z.string().regex(/^[1-9][MTLREDSVC].*$/)).min(1)
const RawLearnsetSchema = z.object({
  learnset: z.record(z.string(), MoveSourcesSchema).optional(),
}).passthrough()

type CanonicalRecord = Record<string, unknown>

export type LearnsetAcquisitionKind =
  | 'machine'
  | 'tutor'
  | 'level-up'
  | 'restricted'
  | 'egg'
  | 'dream-world'
  | 'event'
  | 'transfer'
  | 'chain-breeding-helper'

export interface LearnsetAcquisitionEvidence {
  sourceCode: string
  generation: number
  kind: LearnsetAcquisitionKind
  detail: string | null
}

export interface CanonicalLearnsetEntry {
  entityId: string
  moveId: string
  sourceShowdownId: string
  evidence: LearnsetAcquisitionEvidence[]
}

export interface LearnsetInheritance {
  entityId: string
  parentEntityId: string | null
  reason: 'none' | 'base-form' | 'changes-from' | 'battle-only' | 'pre-evolution' | 'base-evolution-root'
  sourceShowdownId: string
  parentShowdownId: string | null
}

export interface LearnsetArtifacts {
  entries: CanonicalLearnsetEntry[]
  inheritance: LearnsetInheritance[]
  unresolved: Array<{ entityId: string; sourceShowdownId: string; moveShowdownId: string; sourceCodes: string[] }>
  quarantined: Array<{ entityId: string; sourceShowdownId: string; moveShowdownId: string; moveId: string; sourceCodes: string[] }>
  report: {
    policy: 'pinned-showdown-known-association-across-generations'
    entityCount: number
    explicitSourceEntityCount: number
    inheritedEntityCount: number
    sourceMovePairCount: number
    sourceAcquisitionRecordCount: number
    resolvedMovePairCount: number
    unresolvedMovePairCount: number
    quarantinedMovePairCount: number
  }
}

const KIND_BY_CODE: Record<string, LearnsetAcquisitionKind> = {
  M: 'machine', T: 'tutor', L: 'level-up', R: 'restricted', E: 'egg',
  D: 'dream-world', S: 'event', V: 'transfer', C: 'chain-breeding-helper',
}

function toId(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '')
    .replaceAll('♀', 'F').replaceAll('♂', 'M').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function stringValue(record: CanonicalRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`LEARNSET_INVALID_${key.toUpperCase()}`)
  return value
}

function ownLearnset(raw: unknown, showdownId: string): Record<string, string[]> | null {
  if (raw === undefined) return null
  const parsed = RawLearnsetSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`LEARNSET_SOURCE_INVALID: ${showdownId}: ${z.prettifyError(parsed.error)}`)
  return parsed.data.learnset ?? null
}

function derivedChangesFrom(raw: RawPokedexRecord): { name: string | null; reason: LearnsetInheritance['reason'] } {
  if (raw.changesFrom) return { name: raw.changesFrom, reason: 'changes-from' }
  const isMegaOrPrimal = raw.forme?.startsWith('Mega') === true || raw.forme === 'Primal'
  const battleOnly = raw.battleOnly ?? (isMegaOrPrimal ? raw.baseSpecies : undefined)
  const firstBattleOnly = Array.isArray(battleOnly) ? battleOnly[0] : battleOnly
  if (firstBattleOnly && firstBattleOnly !== raw.baseSpecies) return { name: firstBattleOnly, reason: 'battle-only' }
  if (firstBattleOnly && raw.baseSpecies) return { name: raw.baseSpecies, reason: 'base-form' }
  return { name: null, reason: 'none' }
}

function rootBaseEvolution(showdownPokedex: Record<string, unknown>, baseSpecies: string): string | null {
  let currentId = toId(baseSpecies)
  const seen = new Set<string>()
  while (!seen.has(currentId)) {
    seen.add(currentId)
    const value = showdownPokedex[currentId]
    if (!value) return null
    const current = parsePokedexRecord(value, currentId)
    if (!current.prevo) return currentId
    currentId = toId(current.prevo)
  }
  throw new Error(`LEARNSET_BASE_EVOLUTION_CYCLE: ${baseSpecies}`)
}

function parentFor(
  showdownId: string,
  raw: RawPokedexRecord,
  hasOwnLearnset: boolean,
  showdownPokedex: Record<string, unknown>,
  showdownLearnsets: Record<string, unknown>,
): { showdownId: string | null; reason: LearnsetInheritance['reason'] } {
  const changes = derivedChangesFrom(raw)
  if (!hasOwnLearnset) {
    const fallback = changes.name ?? raw.baseSpecies ?? null
    if (fallback && toId(fallback) !== showdownId) return { showdownId: toId(fallback), reason: changes.name ? changes.reason : 'base-form' }
    if (raw.isNonstandard) return { showdownId: null, reason: 'none' }
    if (raw.prevo && ownLearnset(showdownLearnsets[toId(raw.prevo)], toId(raw.prevo))) return { showdownId: toId(raw.prevo), reason: 'pre-evolution' }
    return { showdownId: null, reason: 'none' }
  }
  if (raw.prevo) return { showdownId: toId(raw.prevo), reason: 'pre-evolution' }
  if (changes.name && raw.baseSpecies !== 'Kyurem') return { showdownId: toId(changes.name), reason: changes.reason }
  if (raw.baseSpecies) {
    const base = showdownPokedex[toId(raw.baseSpecies)]
    if (base && parsePokedexRecord(base, toId(raw.baseSpecies)).prevo) {
      return { showdownId: rootBaseEvolution(showdownPokedex, raw.baseSpecies), reason: 'base-evolution-root' }
    }
  }
  return { showdownId: null, reason: 'none' }
}

function evidence(sourceCode: string): LearnsetAcquisitionEvidence {
  const kind = KIND_BY_CODE[sourceCode[1]]
  if (!kind) throw new Error(`LEARNSET_SOURCE_CODE_UNKNOWN: ${sourceCode}`)
  return { sourceCode, generation: Number(sourceCode[0]), kind, detail: sourceCode.length > 2 ? sourceCode.slice(2) : null }
}

export function buildLearnsetArtifacts(input: {
  forms: CanonicalRecord[]
  moves: CanonicalRecord[]
  showdownPokedex: Record<string, unknown>
  showdownLearnsets: Record<string, unknown>
}): LearnsetArtifacts {
  const formByShowdownId = new Map(input.forms.map(form => [stringValue(form, 'showdownId'), form]))
  const moveByShowdownId = new Map(input.moves.map(move => [stringValue(move, 'showdownId'), move]))
  const entries: CanonicalLearnsetEntry[] = []
  const inheritance: LearnsetInheritance[] = []
  const unresolved: LearnsetArtifacts['unresolved'] = []
  const quarantined: LearnsetArtifacts['quarantined'] = []
  let sourceMovePairCount = 0
  let sourceAcquisitionRecordCount = 0
  let explicitSourceEntityCount = 0

  for (const form of [...input.forms].sort((left, right) => stringValue(left, 'formId').localeCompare(stringValue(right, 'formId'), 'en'))) {
    const entityId = stringValue(form, 'formId')
    const showdownId = stringValue(form, 'showdownId')
    const rawValue = input.showdownPokedex[showdownId]
    if (!rawValue) throw new Error(`LEARNSET_POKEDEX_ID_MISSING: ${showdownId}`)
    const raw = parsePokedexRecord(rawValue, showdownId)
    const direct = ownLearnset(input.showdownLearnsets[showdownId], showdownId)
    if (direct) {
      explicitSourceEntityCount += 1
      for (const [moveShowdownId, sourceCodes] of Object.entries(direct).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
        sourceMovePairCount += 1
        sourceAcquisitionRecordCount += sourceCodes.length
        const move = moveByShowdownId.get(moveShowdownId)
        if (!move) {
          unresolved.push({ entityId, sourceShowdownId: showdownId, moveShowdownId, sourceCodes: [...sourceCodes] })
          continue
        }
        const moveId = stringValue(move, 'moveId')
        if (move.dataStatus !== 'complete') {
          quarantined.push({ entityId, sourceShowdownId: showdownId, moveShowdownId, moveId, sourceCodes: [...sourceCodes] })
          continue
        }
        entries.push({ entityId, moveId, sourceShowdownId: showdownId, evidence: sourceCodes.map(evidence).sort((left, right) => left.sourceCode.localeCompare(right.sourceCode, 'en')) })
      }
    }
    const parent = parentFor(showdownId, raw, direct !== null, input.showdownPokedex, input.showdownLearnsets)
    const parentForm = parent.showdownId ? formByShowdownId.get(parent.showdownId) : undefined
    if (parent.showdownId && !parentForm) throw new Error(`LEARNSET_PARENT_FORM_UNRESOLVED: ${entityId}:${parent.showdownId}`)
    inheritance.push({ entityId, parentEntityId: parentForm ? stringValue(parentForm, 'formId') : null, reason: parentForm ? parent.reason : 'none', sourceShowdownId: showdownId, parentShowdownId: parent.showdownId })
  }

  entries.sort((left, right) => `${left.entityId}:${left.moveId}`.localeCompare(`${right.entityId}:${right.moveId}`, 'en'))
  unresolved.sort((left, right) => `${left.entityId}:${left.moveShowdownId}`.localeCompare(`${right.entityId}:${right.moveShowdownId}`, 'en'))
  quarantined.sort((left, right) => `${left.entityId}:${left.moveShowdownId}`.localeCompare(`${right.entityId}:${right.moveShowdownId}`, 'en'))
  const parentByEntity = new Map(inheritance.map(edge => [edge.entityId, edge.parentEntityId]))
  for (const edge of inheritance) {
    const seen = new Set<string>()
    let current: string | null = edge.entityId
    while (current) {
      if (seen.has(current)) throw new Error(`LEARNSET_INHERITANCE_CYCLE: ${edge.entityId}`)
      seen.add(current)
      current = parentByEntity.get(current) ?? null
    }
  }
  return {
    entries, inheritance, unresolved, quarantined,
    report: {
      policy: 'pinned-showdown-known-association-across-generations',
      entityCount: input.forms.length,
      explicitSourceEntityCount,
      inheritedEntityCount: inheritance.filter(edge => edge.parentEntityId !== null).length,
      sourceMovePairCount,
      sourceAcquisitionRecordCount,
      resolvedMovePairCount: entries.length,
      unresolvedMovePairCount: unresolved.length,
      quarantinedMovePairCount: quarantined.length,
    },
  }
}
