import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { decodeShareTeamState, encodeShareTeamState, normalizeTeamState, parseSerializedTeamState, revalidateTeamLearnsets, resolveStartupTeamState, serializeTeamState } from '../../../src/lib/runtime-data/team-persistence.ts'
import { resolveEffectiveLearnsetMoveIds } from '../../../src/lib/runtime-data/learnsets.ts'

const dataPromise = buildFullDryRun().then(buildRuntimeData)
const validTeam = [{ memberId: 'team-member-1', formId: 'form:0006:base', abilityId: 'ability:0066', natureId: 'nature:adamant', itemId: null, moveIds: ['move:0053', 'move:0014'] }]

test('team persistence round-trips deterministically through storage and URL representations', async () => {
  const data = await dataPromise
  const once = serializeTeamState(validTeam)
  assert.equal(serializeTeamState(validTeam), once)
  assert.deepEqual(parseSerializedTeamState(once, data)?.team, validTeam)
  assert.deepEqual(decodeShareTeamState(encodeShareTeamState(validTeam), data)?.team, validTeam)
})

test('team persistence rejects malformed or future serialized states and gives valid URL precedence', async () => {
  const data = await dataPromise
  assert.equal(parseSerializedTeamState('{', data), null)
  assert.equal(normalizeTeamState({ version: 2, team: validTeam }, data), null)
  const stored = serializeTeamState(validTeam)
  const shared = encodeShareTeamState([{ ...validTeam[0], memberId: 'team-member-2' }])
  assert.equal(resolveStartupTeamState(shared, stored, data).source, 'url')
  assert.deepEqual(resolveStartupTeamState('%', stored, data), { members: validTeam, source: 'storage' })
})

test('team persistence partially recovers valid records while discarding invalid references and normalizing limits', async () => {
  const data = await dataPromise
  const state = normalizeTeamState({ version: 1, team: [
    { ...validTeam[0], moveIds: ['move:0053', 'move:0053', 'move:9999', 'move:0014', 'move:0015', 'move:0017'] },
    { memberId: 'team-member-2', formId: 'form:9999:base', abilityId: null, moveIds: [] },
    { memberId: 'team-member-3', formId: 'form:0006:base', abilityId: 'ability:9999', moveIds: ['move:9999'] },
    ...Array.from({ length: 7 }, (_, index) => ({ memberId: `team-member-extra-${index}`, formId: 'form:0006:base', abilityId: null, moveIds: [] })),
  ] }, data)
  assert.equal(state?.team.length, 6)
  assert.deepEqual(state?.team[0].moveIds, ['move:0053', 'move:0014', 'move:0015', 'move:0017'])
  assert.equal(state?.team[1].abilityId, null)
  assert.equal(state?.team[1].natureId, null)
  assert.equal(state?.team[1].itemId, null)
  assert.deepEqual(state?.team[1].moveIds, [])
})

test('persisted Form Ability and Move IDs restore before learnsets load, then only invalid memberships are removed', async () => {
  const data = await dataPromise
  const allowed = new Set(resolveEffectiveLearnsetMoveIds(data.learnsets, validTeam[0].formId))
  const invalidForForm = data.moves.find(move => !allowed.has(move.moveId))!.moveId
  const serialized = serializeTeamState([{ ...validTeam[0], moveIds: ['move:0053', invalidForForm] }])
  const core = { forms: data.forms, moves: data.moves, natures: data.natures, items: data.items }
  const restored = parseSerializedTeamState(serialized, core)
  assert.deepEqual(restored?.team, [{ ...validTeam[0], moveIds: ['move:0053', invalidForForm] }])
  assert.equal(restored?.team[0].abilityId, 'ability:0066')
  assert.deepEqual(revalidateTeamLearnsets(restored!.team, data.learnsets), validTeam.map(member => ({ ...member, moveIds: ['move:0053'] })))
})
