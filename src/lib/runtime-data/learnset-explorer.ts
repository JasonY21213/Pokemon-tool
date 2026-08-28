import type { RuntimeMove } from './types.js'

export type LearnsetCategoryFilter = 'all' | 'damaging' | 'status'
export type LearnsetSupportFilter = 'all' | 'supported'
export type LearnsetSort = 'name' | 'type' | 'category' | 'power-desc' | 'pp'

export type LearnsetFilters = {
  query: string
  typeId: string
  category: LearnsetCategoryFilter
  minimumPower: number
  support: LearnsetSupportFilter
}

export function filterLearnsetMoves(moves: RuntimeMove[], filters: LearnsetFilters): RuntimeMove[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return moves.filter(move =>
    (!query || (move.zhName?.includes(filters.query.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(query))
    && (!filters.typeId || move.typeId === filters.typeId)
    && (filters.category === 'all' ? true : filters.category === 'damaging' ? move.category !== 'status' : move.category === 'status')
    && (filters.minimumPower <= 0 || (move.power.kind === 'numeric' && move.power.value >= filters.minimumPower))
    && (filters.support === 'all' || move.damageSupport.status === 'supported'),
  )
}

function numericValue(value: RuntimeMove['power'] | RuntimeMove['pp']): number | null {
  return value.kind === 'numeric' ? value.value : null
}

function powerRank(value: RuntimeMove['power']): number {
  return value.kind === 'numeric' ? 2 : value.kind === 'unknown' ? 1 : 0
}

export function sortLearnsetMoves(moves: RuntimeMove[], sort: LearnsetSort): RuntimeMove[] {
  return [...moves].sort((left, right) => {
    if (sort === 'power-desc') {
      const difference = (numericValue(right.power) ?? -1) - (numericValue(left.power) ?? -1)
      if (difference) return difference
      const rankDifference = powerRank(right.power) - powerRank(left.power)
      if (rankDifference) return rankDifference
    } else if (sort === 'pp') {
      const difference = (numericValue(left.pp) ?? Number.POSITIVE_INFINITY) - (numericValue(right.pp) ?? Number.POSITIVE_INFINITY)
      if (difference) return difference
    } else if (sort === 'type') {
      const difference = left.typeId.localeCompare(right.typeId, 'en')
      if (difference) return difference
    } else if (sort === 'category') {
      const order = { physical: 0, special: 1, status: 2 }
      const difference = order[left.category] - order[right.category]
      if (difference) return difference
    }
    return (left.zhName ?? left.canonicalName).localeCompare(right.zhName ?? right.canonicalName, 'zh-CN') || left.moveId.localeCompare(right.moveId, 'en')
  })
}

export function addMoveToMoveset(selectedMoveIds: string[], moveId: string, allowedMoveIds: Set<string>): string[] {
  if (!allowedMoveIds.has(moveId) || selectedMoveIds.includes(moveId) || selectedMoveIds.length >= 4) return selectedMoveIds
  return [...selectedMoveIds, moveId]
}

export function removeMoveFromMoveset(selectedMoveIds: string[], moveId: string): string[] {
  return selectedMoveIds.filter(id => id !== moveId)
}

export function revalidateMoveset(selectedMoveIds: string[], allowedMoveIds: Set<string>): string[] {
  return selectedMoveIds.filter(id => allowedMoveIds.has(id)).slice(0, 4)
}
