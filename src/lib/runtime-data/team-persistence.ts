import { resolveEffectiveLearnsetMoveIds } from './learnsets.ts'
import type { TeamMember } from './team-builder.ts'
import type { PokemonRuntimeData } from './types.js'

export const TEAM_STORAGE_KEY = 'pokemon-tool.team-state'
export const TEAM_STATE_VERSION = 1

export type PersistedTeamState = {
  version: 1
  team: TeamMember[]
}

export type StartupTeamState = {
  members: TeamMember[]
  source: 'url' | 'storage' | 'empty'
}

type PersistenceData = Pick<PokemonRuntimeData, 'forms' | 'moves' | 'learnsets'>
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const formIdPattern = /^form:(?:\d{4}|[a-z0-9-]+):[a-z0-9-]+$/
const moveIdPattern = /^move:(?:\d{4}|[a-z0-9-]+)$/
const abilityIdPattern = /^ability:(?:\d{4}|[a-z0-9-]+)$/
const memberIdPattern = /^team-member-[a-z0-9-]{1,32}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStableId(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}

function parsedState(value: unknown): PersistedTeamState | null {
  if (!isRecord(value) || value.version !== TEAM_STATE_VERSION || !Array.isArray(value.team)) return null
  return { version: TEAM_STATE_VERSION, team: value.team as TeamMember[] }
}

function nextMemberId(index: number, used: Set<string>): string {
  let candidate = `team-member-${index + 1}`
  let suffix = 2
  while (used.has(candidate)) candidate = `team-member-${index + 1}-${suffix++}`
  return candidate
}

export function normalizeTeamState(value: unknown, data: PersistenceData): PersistedTeamState | null {
  const state = parsedState(value)
  if (!state) return null
  const forms = new Map(data.forms.map(form => [form.formId, form]))
  const moveIds = new Set(data.moves.map(move => move.moveId))
  const usedMemberIds = new Set<string>()
  const team: TeamMember[] = []
  for (const [index, rawMember] of state.team.entries()) {
    if (team.length >= 6 || !isRecord(rawMember) || !isStableId(rawMember.formId, formIdPattern)) continue
    const form = forms.get(rawMember.formId)
    if (!form) continue
    const memberId = isStableId(rawMember.memberId, memberIdPattern) && !usedMemberIds.has(rawMember.memberId) ? rawMember.memberId : nextMemberId(index, usedMemberIds)
    usedMemberIds.add(memberId)
    const abilityId = isStableId(rawMember.abilityId, abilityIdPattern) && form.abilities.some(slot => slot.abilityId === rawMember.abilityId) ? rawMember.abilityId : null
    const allowedMoveIds = new Set(resolveEffectiveLearnsetMoveIds(data.learnsets, form.formId))
    const moveIdsForMember = Array.isArray(rawMember.moveIds) ? rawMember.moveIds.filter((moveId): moveId is string => isStableId(moveId, moveIdPattern) && moveIds.has(moveId) && allowedMoveIds.has(moveId)) : []
    team.push({ memberId, formId: form.formId, abilityId, moveIds: [...new Set(moveIdsForMember)].slice(0, 4) })
  }
  return { version: TEAM_STATE_VERSION, team }
}

export function serializeTeamState(members: TeamMember[]): string {
  return JSON.stringify({ version: TEAM_STATE_VERSION, team: members.map(member => ({ memberId: member.memberId, formId: member.formId, abilityId: member.abilityId, moveIds: [...member.moveIds] })) satisfies TeamMember[] })
}

export function parseSerializedTeamState(serialized: string, data: PersistenceData): PersistedTeamState | null {
  try { return normalizeTeamState(JSON.parse(serialized), data) } catch { return null }
}

export function loadStoredTeamState(storage: StorageLike, data: PersistenceData): PersistedTeamState | null {
  try { const serialized = storage.getItem(TEAM_STORAGE_KEY); return serialized === null ? null : parseSerializedTeamState(serialized, data) } catch { return null }
}

export function saveStoredTeamState(storage: StorageLike, members: TeamMember[]): boolean {
  try { storage.setItem(TEAM_STORAGE_KEY, serializeTeamState(members)); return true } catch { return false }
}

export function clearStoredTeamState(storage: StorageLike): boolean {
  try { storage.removeItem(TEAM_STORAGE_KEY); return true } catch { return false }
}

export function encodeShareTeamState(members: TeamMember[]): string {
  return encodeURIComponent(serializeTeamState(members))
}

export function decodeShareTeamState(encoded: string | null, data: PersistenceData): PersistedTeamState | null {
  if (!encoded || encoded.length > 4000) return null
  try { return parseSerializedTeamState(decodeURIComponent(encoded), data) } catch { return null }
}

export function resolveStartupTeamState(shared: string | null, stored: string | null, data: PersistenceData): StartupTeamState {
  const fromUrl = decodeShareTeamState(shared, data)
  if (fromUrl) return { members: fromUrl.team, source: 'url' }
  const fromStorage = stored === null ? null : parseSerializedTeamState(stored, data)
  return fromStorage ? { members: fromStorage.team, source: 'storage' } : { members: [], source: 'empty' }
}
