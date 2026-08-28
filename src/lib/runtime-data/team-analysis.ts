import { calculateDefensiveMatchup } from './type-matchup.ts'
import type { RuntimeForm, RuntimeMove, RuntimeType } from './types.js'
import type { TeamMember } from './team-builder.ts'

export type DefensiveContributor = { memberId: string; formId: string; multiplier: 0 | 0.25 | 0.5 | 1 | 2 | 4 }
export type DefensiveAnalysis = {
  attackingTypeId: string
  weak: number
  neutral: number
  resist: number
  immune: number
  maxWeaknessMultiplier: 0 | 0.25 | 0.5 | 1 | 2 | 4
  hasResistanceOrImmunity: boolean
  weakContributors: DefensiveContributor[]
  resistanceOrImmunityContributors: DefensiveContributor[]
}
export type OffensiveContributor = { memberId: string; formId: string; moveId: string; moveTypeId: string }
export type OffensiveAnalysis = { available: boolean; covered: Array<{ defenderTypeId: string; contributors: OffensiveContributor[] }>; gaps: string[] }

function orderedTypes(types: RuntimeType[]): RuntimeType[] { return [...types].sort((left, right) => left.typeId.localeCompare(right.typeId, 'en')) }

export function analyzeDefensiveTypes(members: TeamMember[], formsById: Map<string, RuntimeForm>, types: RuntimeType[]): DefensiveAnalysis[] {
  return orderedTypes(types).map(attacking => {
    const contributors = members.map(member => {
      const form = formsById.get(member.formId)
      if (!form) throw new Error(`TEAM_ANALYSIS_FORM_MISSING: ${member.formId}`)
      const matchup = calculateDefensiveMatchup(types, form.types[0], form.types[1]).find(entry => entry.attackingTypeId === attacking.typeId)
      if (!matchup) throw new Error(`TEAM_ANALYSIS_TYPE_MISSING: ${attacking.typeId}`)
      return { memberId: member.memberId, formId: member.formId, multiplier: matchup.multiplier }
    })
    const weakContributors = contributors.filter(item => item.multiplier > 1)
    const resistanceOrImmunityContributors = contributors.filter(item => item.multiplier < 1)
    return {
      attackingTypeId: attacking.typeId,
      weak: weakContributors.length,
      neutral: contributors.filter(item => item.multiplier === 1).length,
      resist: contributors.filter(item => item.multiplier > 0 && item.multiplier < 1).length,
      immune: contributors.filter(item => item.multiplier === 0).length,
      maxWeaknessMultiplier: contributors.reduce<DefensiveContributor['multiplier']>((max, item) => item.multiplier > max ? item.multiplier : max, 0),
      hasResistanceOrImmunity: resistanceOrImmunityContributors.length > 0,
      weakContributors,
      resistanceOrImmunityContributors,
    }
  })
}

export function repeatedWeaknesses(analysis: DefensiveAnalysis[]): DefensiveAnalysis[] { return analysis.filter(item => item.weak >= 2) }
export function defensiveGaps(analysis: DefensiveAnalysis[]): DefensiveAnalysis[] { return analysis.filter(item => item.weak > 0 && !item.hasResistanceOrImmunity) }

export function analyzeOffensiveCoverage(members: TeamMember[], moves: RuntimeMove[], types: RuntimeType[]): OffensiveAnalysis {
  const movesById = new Map(moves.map(move => [move.moveId, move]))
  const selected = members.flatMap(member => member.moveIds.map(moveId => {
    const move = movesById.get(moveId)
    if (!move) throw new Error(`TEAM_ANALYSIS_MOVE_MISSING: ${moveId}`)
    return { memberId: member.memberId, formId: member.formId, moveId, moveTypeId: move.typeId }
  }))
  if (!selected.length) return { available: false, covered: [], gaps: [] }
  const covered = orderedTypes(types).flatMap(defender => {
    const effectiveAttackTypes = new Set(calculateDefensiveMatchup(types, defender.typeId).filter(entry => entry.multiplier > 1).map(entry => entry.attackingTypeId))
    const contributors = selected.filter(item => effectiveAttackTypes.has(item.moveTypeId)).sort((left, right) => `${left.memberId}:${left.moveId}`.localeCompare(`${right.memberId}:${right.moveId}`, 'en'))
    return contributors.length ? [{ defenderTypeId: defender.typeId, contributors }] : []
  })
  const coveredIds = new Set(covered.map(item => item.defenderTypeId))
  return { available: true, covered, gaps: orderedTypes(types).map(type => type.typeId).filter(typeId => !coveredIds.has(typeId)) }
}
