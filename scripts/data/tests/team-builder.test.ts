import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { addPreparedTeamMember, addTeamMember, defensiveSummary, offensiveCoverage, updateMemberAbility, updateMemberForm, updateMemberMoves, updateMemberNature, type TeamMember } from '../../../src/lib/runtime-data/team-builder.ts'

const dataPromise = buildFullDryRun().then(buildRuntimeData)

test('Team Builder caps members at six and normalizes each member to four unique allowed Moves', async () => {
  const data = await dataPromise
  const formIds = new Set(data.forms.map(form => form.formId))
  let members: TeamMember[] = []
  for (let index = 0; index < 7; index += 1) members = addTeamMember(members, { memberId: `member-${index}`, formId: 'form:0006:base', abilityId: null, natureId: null, itemId: null, moveIds: ['move:0053'] }, formIds)
  assert.equal(members.length, 6)
  const normalized = updateMemberMoves(members[0], ['move:0053', 'move:0053', 'move:0001', 'move:0014', 'move:0129', 'move:0068'], new Set(['move:0053', 'move:0001', 'move:0014', 'move:0129', 'move:0068']))
  assert.deepEqual(normalized.moveIds, ['move:0053', 'move:0001', 'move:0014', 'move:0129'])
})

test('Team defensive summary uses each Form type, including Charizard Rock 4x weakness and Water/Ground Electric immunity', async () => {
  const data = await dataPromise
  const charizard = data.forms.find(form => form.formId === 'form:0006:base')!
  const megaX = data.forms.find(form => form.formId === 'form:0006:mega-x')!
  const gastrodon = data.forms.find(form => form.formId === 'form:0423:base')!
  const baseRock = defensiveSummary([charizard], data.types).find(entry => entry.attackingTypeId === 'type:rock')!
  const megaXRock = defensiveSummary([megaX], data.types).find(entry => entry.attackingTypeId === 'type:rock')!
  const electric = defensiveSummary([gastrodon], data.types).find(entry => entry.attackingTypeId === 'type:electric')!
  assert.deepEqual(baseRock, { attackingTypeId: 'type:rock', weak: 1, fourTimesWeak: 1, twoTimesWeak: 0, neutral: 0, resistOrImmune: 0 })
  assert.deepEqual(megaXRock, { attackingTypeId: 'type:rock', weak: 1, fourTimesWeak: 0, twoTimesWeak: 1, neutral: 0, resistOrImmune: 0 })
  assert.deepEqual(electric, { attackingTypeId: 'type:electric', weak: 0, fourTimesWeak: 0, twoTimesWeak: 0, neutral: 0, resistOrImmune: 1 })
  const aggregate = defensiveSummary([charizard, gastrodon], data.types).find(entry => entry.attackingTypeId === 'type:rock')!
  assert.equal(aggregate.weak + aggregate.neutral + aggregate.resistOrImmune, 2)
})

test('simple offensive coverage is deterministic and only reflects selected Move types against single defender types', async () => {
  const data = await dataPromise
  const coverage = offensiveCoverage([{ memberId: 'member-1', formId: 'form:0006:base', abilityId: null, natureId: null, itemId: null, moveIds: ['move:0053'] }, { memberId: 'member-2', formId: 'form:0423:base', abilityId: null, natureId: null, itemId: null, moveIds: ['move:0001'] }], data.moves, data.types)
  assert.deepEqual(coverage.find(entry => entry.defenderTypeId === 'type:grass'), { defenderTypeId: 'type:grass', moveTypeIds: ['type:fire'] })
  assert.equal(coverage.some(entry => entry.defenderTypeId === 'type:fire' && entry.moveTypeIds.includes('type:normal')), false)
  assert.deepEqual(coverage, [...coverage].sort((left, right) => left.defenderTypeId.localeCompare(right.defenderTypeId, 'en')))
})

test('Team member Ability selection is explicit, Form-bound, and cleared by an incompatible Form change', async () => {
  const data = await dataPromise
  const raichu = data.forms.find(form => form.formId === 'form:0026:base')!
  const alolanRaichu = data.forms.find(form => form.formId === 'form:0026:alola')!
  const member: TeamMember = { memberId: 'raichu', formId: raichu.formId, abilityId: null, natureId: null, itemId: null, moveIds: [] }
  const selected = updateMemberAbility(member, 'ability:0009', raichu)
  assert.equal(selected.abilityId, 'ability:0009')
  assert.equal(updateMemberForm(selected, alolanRaichu).abilityId, null)
  assert.throws(() => updateMemberAbility(member, 'ability:0026', raichu), /TEAM_MEMBER_ABILITY_NOT_AVAILABLE/)
})

test('prepared query selections preserve valid temporary Moves and Team nature selection uses stable IDs', async () => {
  const data = await dataPromise
  const form = data.forms.find(candidate => candidate.formId === 'form:0479:base')!
  const member: TeamMember = { memberId: 'rotom', formId: form.formId, abilityId: 'ability:0026', natureId: null, itemId: null, moveIds: ['move:0085', 'move:0085', 'move:0247', 'move:9999'] }
  const added = addPreparedTeamMember([], member, form, new Set(['move:0085', 'move:0247']))
  assert.deepEqual(added[0].moveIds, ['move:0085', 'move:0247'])
  assert.equal(added[0].abilityId, 'ability:0026')
  const nature = updateMemberNature(added[0], 'nature:timid', new Set(data.natures.map(candidate => candidate.natureId)))
  assert.equal(nature.natureId, 'nature:timid')
  assert.throws(() => updateMemberNature(nature, 'nature:missing', new Set(data.natures.map(candidate => candidate.natureId))), /TEAM_MEMBER_NATURE_MISSING/)
})

test('prepared query selections keep Moves unverified until learnsets are available', async () => {
  const data = await dataPromise
  const form = data.forms.find(candidate => candidate.formId === 'form:0479:base')!
  const member: TeamMember = { memberId: 'rotom-unverified', formId: form.formId, abilityId: 'ability:0026', natureId: null, itemId: null, moveIds: ['move:0085', 'move:0247'] }
  assert.deepEqual(addPreparedTeamMember([], member, form, null)[0].moveIds, member.moveIds)
  assert.deepEqual(addPreparedTeamMember([], member, form, new Set(['move:0085']))[0].moveIds, ['move:0085'])
})
