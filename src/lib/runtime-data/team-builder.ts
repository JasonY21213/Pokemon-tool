import { resolveEffectiveLearnsetMoveIds } from './learnsets.ts'
import { calculateDefensiveMatchup } from './type-matchup.ts'
import type { CoreRuntimeData, LearnsetRuntimeData, RuntimeForm, RuntimeMove, RuntimeType } from './types.js'

export type TeamMember = { memberId: string; formId: string; abilityId: string | null; moveIds: string[] }
export type DefensiveTypeSummary = { attackingTypeId: string; weak: number; fourTimesWeak: number; twoTimesWeak: number; neutral: number; resistOrImmune: number }
export type OffensiveTypeCoverage = { defenderTypeId: string; moveTypeIds: string[] }

export function addTeamMember(members: TeamMember[], member: TeamMember, formIds: Set<string>): TeamMember[] {
  if (!formIds.has(member.formId) || members.length >= 6) return members
  return [...members, { ...member, abilityId: null, moveIds: [] }]
}

export function updateMemberAbility(member: TeamMember, abilityId: string | null, form: RuntimeForm): TeamMember {
  if (abilityId !== null && !form.abilities.some(slot => slot.abilityId === abilityId)) throw new Error(`TEAM_MEMBER_ABILITY_NOT_AVAILABLE: ${member.memberId}:${abilityId}`)
  return { ...member, abilityId }
}

export function updateMemberForm(member: TeamMember, form: RuntimeForm): TeamMember {
  return { ...member, formId: form.formId, abilityId: member.abilityId !== null && form.abilities.some(slot => slot.abilityId === member.abilityId) ? member.abilityId : null, moveIds: [] }
}

export function updateMemberMoves(member: TeamMember, moveIds: string[], allowedMoveIds: Set<string>): TeamMember {
  const unique = [...new Set(moveIds)].filter(moveId => allowedMoveIds.has(moveId)).slice(0, 4)
  return { ...member, moveIds: unique }
}

export function removeTeamMember(members: TeamMember[], memberId: string): TeamMember[] {
  return members.filter(member => member.memberId !== memberId)
}

export function formsById(data: Pick<CoreRuntimeData, 'forms'>): Map<string, RuntimeForm> {
  return new Map(data.forms.map(form => [form.formId, form]))
}

export function validateTeamMembers(data: CoreRuntimeData, members: TeamMember[]): void {
  if (members.length > 6 || new Set(members.map(member => member.memberId)).size !== members.length) throw new Error('TEAM_MEMBER_LIMIT_OR_ID')
  const formMap = formsById(data)
  const moveIds = new Set(data.moves.map(move => move.moveId))
  for (const member of members) {
    const form = formMap.get(member.formId)
    if (!form || member.moveIds.length > 4 || new Set(member.moveIds).size !== member.moveIds.length || member.moveIds.some(id => !moveIds.has(id)) || (member.abilityId !== null && !form.abilities.some(slot => slot.abilityId === member.abilityId))) throw new Error(`TEAM_MEMBER_INVALID: ${member.memberId}`)
  }
}

export function validateTeamMemberLearnsets(learnsets: LearnsetRuntimeData, members: TeamMember[]): void {
  for (const member of members) {
    const allowed = new Set(resolveEffectiveLearnsetMoveIds(learnsets, member.formId))
    if (member.moveIds.some(id => !allowed.has(id))) throw new Error(`TEAM_MEMBER_MOVE_NOT_IN_LEARNSET: ${member.memberId}`)
  }
}

export function defensiveSummary(forms: RuntimeForm[], types: RuntimeType[]): DefensiveTypeSummary[] {
  return [...types].sort((left, right) => left.typeId.localeCompare(right.typeId, 'en')).map(attacking => {
    let weak = 0; let fourTimesWeak = 0; let twoTimesWeak = 0; let neutral = 0; let resistOrImmune = 0
    for (const form of forms) {
      const entry = calculateDefensiveMatchup(types, form.types[0], form.types[1]).find(value => value.attackingTypeId === attacking.typeId)
      if (!entry) throw new Error(`TEAM_TYPE_REFERENCE: ${attacking.typeId}`)
      if (entry.multiplier > 1) { weak += 1; if (entry.multiplier === 4) fourTimesWeak += 1; else twoTimesWeak += 1 }
      else if (entry.multiplier < 1) resistOrImmune += 1
      else neutral += 1
    }
    return { attackingTypeId: attacking.typeId, weak, fourTimesWeak, twoTimesWeak, neutral, resistOrImmune }
  })
}

export function offensiveCoverage(members: TeamMember[], moves: RuntimeMove[], types: RuntimeType[]): OffensiveTypeCoverage[] {
  const movesById = new Map(moves.map(move => [move.moveId, move]))
  const selectedTypeIds = [...new Set(members.flatMap(member => member.moveIds.map(moveId => movesById.get(moveId)?.typeId).filter((typeId): typeId is string => typeId !== undefined)))].sort((left, right) => left.localeCompare(right, 'en'))
  return [...types].sort((left, right) => left.typeId.localeCompare(right.typeId, 'en')).flatMap(defender => {
    const moveTypeIds = calculateDefensiveMatchup(types, defender.typeId).filter(entry => entry.multiplier > 1 && selectedTypeIds.includes(entry.attackingTypeId)).map(entry => entry.attackingTypeId).sort((left, right) => left.localeCompare(right, 'en'))
    return moveTypeIds.length ? [{ defenderTypeId: defender.typeId, moveTypeIds }] : []
  })
}
