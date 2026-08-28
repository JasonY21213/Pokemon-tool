import type { RuntimeMoveDamageSupport } from '../../src/lib/runtime-data/types.ts'

type CanonicalRecord = Record<string, unknown>

export interface DamageSupportRecord {
  moveId: string
  showdownId: string
  support: RuntimeMoveDamageSupport
}

export interface DamageSupportArtifacts {
  records: DamageSupportRecord[]
  report: {
    supported: number
    nonDamaging: number
    unsupported: number
    incomplete: number
    unsupportedByReason: Record<string, number>
  }
}

const SPREAD_TARGETS = new Set(['all', 'allAdjacent', 'allAdjacentFoes'])

function stringValue(record: CanonicalRecord, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`DAMAGE_SUPPORT_INVALID_${key.toUpperCase()}`)
  return value
}

function classify(raw: CanonicalRecord, move: CanonicalRecord): RuntimeMoveDamageSupport {
  if (move.dataStatus !== 'complete') return { status: 'incomplete', reason: 'unknown-or-incomplete-mechanics' }
  if (move.category === 'status') return { status: 'non-damaging' }
  if (raw.isMax || raw.isZ) return { status: 'unsupported', reason: 'max-or-z-move' }
  if (raw.ohko) return { status: 'unsupported', reason: 'ohko' }
  if ('damageCallback' in raw || 'damage' in raw) return { status: 'unsupported', reason: 'fixed-or-counter-damage' }
  if ('basePowerCallback' in raw || 'onBasePower' in raw) return { status: 'unsupported', reason: 'variable-base-power' }
  if (!Number.isInteger(move.basePower) || Number(move.basePower) <= 0) return { status: 'unsupported', reason: 'non-numeric-base-power' }
  if ('multihit' in raw) return { status: 'unsupported', reason: 'multi-hit' }
  if (SPREAD_TARGETS.has(String(raw.target))) return { status: 'unsupported', reason: 'spread-target' }
  if ('overrideOffensivePokemon' in raw || 'overrideDefensivePokemon' in raw || 'overrideOffensiveStat' in raw || 'overrideDefensiveStat' in raw) return { status: 'unsupported', reason: 'nonstandard-stat-selection' }
  if ('onEffectiveness' in raw || 'ignoreImmunity' in raw) return { status: 'unsupported', reason: 'nonstandard-type-effectiveness' }
  if ('onModifyType' in raw) return { status: 'unsupported', reason: 'dynamic-move-type' }
  if ('onModifyMove' in raw) return { status: 'unsupported', reason: 'dynamic-move-mechanics' }
  if (raw.willCrit) return { status: 'unsupported', reason: 'forced-critical-hit' }
  if ('onDamage' in raw) return { status: 'unsupported', reason: 'damage-cap' }
  if ('onTryImmunity' in raw) return { status: 'unsupported', reason: 'conditional-immunity' }
  if ('onTryHit' in raw) return { status: 'unsupported', reason: 'conditional-hit-mechanics' }
  return { status: 'supported' }
}

export function buildDamageSupportArtifacts(moves: CanonicalRecord[], showdownMoves: Record<string, unknown>): DamageSupportArtifacts {
  const records = moves.map(move => {
    const moveId = stringValue(move, 'moveId')
    const showdownId = stringValue(move, 'showdownId')
    const raw = showdownMoves[showdownId]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`DAMAGE_SUPPORT_SOURCE_MISSING: ${showdownId}`)
    return { moveId, showdownId, support: classify(raw as CanonicalRecord, move) }
  }).sort((left, right) => left.moveId.localeCompare(right.moveId, 'en'))
  const unsupportedByReason: Record<string, number> = {}
  for (const record of records) {
    if (record.support.status !== 'unsupported') continue
    unsupportedByReason[record.support.reason] = (unsupportedByReason[record.support.reason] ?? 0) + 1
  }
  return {
    records,
    report: {
      supported: records.filter(record => record.support.status === 'supported').length,
      nonDamaging: records.filter(record => record.support.status === 'non-damaging').length,
      unsupported: records.filter(record => record.support.status === 'unsupported').length,
      incomplete: records.filter(record => record.support.status === 'incomplete').length,
      unsupportedByReason: Object.fromEntries(Object.entries(unsupportedByReason).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    },
  }
}
