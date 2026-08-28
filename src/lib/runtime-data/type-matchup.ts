import type { RuntimeType } from './types.js'

export type DefensiveMatchup = {
  attackingTypeId: string
  multiplier: 0 | 0.25 | 0.5 | 1 | 2 | 4
}

export type DefensiveMatchupGroup = {
  multiplier: DefensiveMatchup['multiplier']
  entries: DefensiveMatchup[]
}

function finalMultiplier(value: number): DefensiveMatchup['multiplier'] {
  if (value === 0 || value === 0.25 || value === 0.5 || value === 1 || value === 2 || value === 4) return value
  throw new Error(`TYPE_MATCHUP_UNEXPECTED_MULTIPLIER: ${value}`)
}

export function calculateDefensiveMatchup(types: RuntimeType[], primaryTypeId: string, secondaryTypeId?: string): DefensiveMatchup[] {
  if (secondaryTypeId === primaryTypeId) throw new Error('TYPE_MATCHUP_DUPLICATE_TYPE')
  const byId = new Map(types.map(type => [type.typeId, type]))
  const defenders = [byId.get(primaryTypeId), ...(secondaryTypeId ? [byId.get(secondaryTypeId)] : [])]
  if (defenders.some(type => !type)) throw new Error('TYPE_MATCHUP_UNKNOWN_TYPE')
  return types.map(attacking => {
    const multiplier = defenders.reduce((product, defender) => {
      const relationship = defender?.damageTaken.find(entry => entry.attackingTypeId === attacking.typeId)
      if (!relationship) throw new Error(`TYPE_MATCHUP_MISSING_RELATIONSHIP: ${attacking.typeId}`)
      return product * relationship.multiplier
    }, 1)
    return { attackingTypeId: attacking.typeId, multiplier: finalMultiplier(multiplier) }
  })
}

export function groupDefensiveMatchup(matchup: DefensiveMatchup[]): DefensiveMatchupGroup[] {
  const order: DefensiveMatchup['multiplier'][] = [4, 2, 1, 0.5, 0.25, 0]
  return order.map(multiplier => ({ multiplier, entries: matchup.filter(entry => entry.multiplier === multiplier) })).filter(group => group.entries.length > 0)
}
