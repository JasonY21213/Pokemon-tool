import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFullDryRun, type RegistryProposal } from '../full-dry-run.ts'
import {
  buildRegistryReviewArtifacts,
  classifyRegistryProposal,
  validateRegistryEntities,
} from '../registry-review.ts'
import type { RegistryEntity } from '../source.ts'

const artifactsPromise = buildRegistryReviewArtifacts()
const fullPromise = buildFullDryRun()
const entity = { mappingClass: 'automatic', dataStatus: 'complete' }

function proposal(overrides: Partial<RegistryProposal>): RegistryProposal {
  return {
    entityKind: 'species', proposedProjectId: 'species:0001', immutableAnchors: { nationalDexNumber: 1 },
    showdownId: 'bulbasaur', reason: 'test fixture', status: 'proposed', ...overrides,
  }
}

test('positive National Dex Species follows the bulk acceptance rule', () => {
  assert.equal(classifyRegistryProposal(proposal({}), entity).reviewClassification, 'safe-bulk-accept')
})

test('CAP or negative Species cannot enter the official namespace', () => {
  const cap = proposal({ proposedProjectId: 'species:-001', immutableAnchors: { nationalDexNumber: -1 }, showdownId: 'tomohawk' })
  assert.equal(classifyRegistryProposal(cap, entity).reviewClassification, 'quarantine-reject')
})

test('duplicate National Dex immutable anchors fail closed', async () => {
  const artifacts = await artifactsPromise
  const original = artifacts.registryAfter.entities.find(item => item.kind === 'species' && item.projectId === 'species:0001')
  assert.ok(original)
  const duplicate = { ...original, projectId: 'species:duplicate-test', showdownId: 'duplicatetest' } as RegistryEntity
  assert.throws(() => validateRegistryEntities([...artifacts.registryAfter.entities, duplicate]), /REGISTRY_DUPLICATE_IMMUTABLE_ANCHOR/)
})

test('Ability 0284 identities use the accepted review decision', async () => {
  const accepted = (await artifactsPromise).accepted.filter(item => ['vesselofruin', 'tabletsofruin', 'beadsofruin'].includes(item.showdownId))
  assert.deepEqual(accepted.map(item => item.proposedProjectId), ['ability:0284', 'ability:0286', 'ability:0287'])
  assert.equal(accepted.every(item => item.category === 'reviewed-ability-0284-map'), true)
})

test('Future Ability identity is accepted separately from release readiness', async () => {
  const future = (await artifactsPromise).accepted.filter(item => item.entityKind === 'ability' && item.availability === 'future')
  assert.equal(future.length, 6)
  assert.equal(future.every(item => item.reviewClassification === 'rule-based-accept' && item.mappingClass === 'unresolved'), true)
})

test('numbered Move follows the official-number bulk rule', () => {
  const move = proposal({ entityKind: 'move', proposedProjectId: 'move:0002', immutableAnchors: { officialNumber: 2 }, showdownId: 'karatechop' })
  assert.equal(classifyRegistryProposal(move, entity).reviewClassification, 'safe-bulk-accept')
})

test('unnumbered Move requires a reviewed project token family', () => {
  const gmax = proposal({ entityKind: 'move', proposedProjectId: 'move:special:gmax-cannonade', immutableAnchors: { specialToken: 'gmax-cannonade' }, showdownId: 'gmaxcannonade' })
  const unknown = proposal({ entityKind: 'move', proposedProjectId: 'move:special:array-42', immutableAnchors: { specialToken: 'array-42' }, showdownId: 'unknownspecial' })
  assert.equal(classifyRegistryProposal(gmax, entity).reviewClassification, 'rule-based-accept')
  assert.equal(classifyRegistryProposal(unknown, entity).reviewClassification, 'manual-review-required')
})

test('Nihil Light registry identity coexists with reviewed quarantine', async () => {
  const artifacts = await artifactsPromise; const full = await fullPromise
  assert.ok(artifacts.registryAfter.entities.some(item => item.projectId === 'move:0920' && item.showdownId === 'nihillight'))
  const move = full.moves.find(item => item.moveId === 'move:0920')
  assert.equal(move?.dataStatus, 'quarantined')
  assert.equal(move?.reviewDecisionId, 'review:move:nihil-light:current-release-quarantine')
})

test('Appearance identity cannot be accepted into the Form registry', () => {
  const appearanceAsForm = proposal({ entityKind: 'form', proposedProjectId: 'appearance:0869:test', immutableAnchors: { speciesId: 'species:0869', formToken: 'test' }, showdownId: 'alcremie' })
  assert.equal(classifyRegistryProposal(appearanceAsForm, entity).reviewClassification, 'quarantine-reject')
})

test('existing fixture project IDs remain stable', async () => {
  const artifacts = await artifactsPromise
  const fixtures = ['species:0006', 'form:0006:mega-x', 'form:0479:wash', 'form:0678:female', 'form:0201:base', 'form:0869:gmax', 'form:0133:partner', 'move:special:gmax-wildfire']
  assert.equal(artifacts.summary.existingFixtureIdsStable, true)
  assert.equal(fixtures.every(id => artifacts.registryBefore.entities.some(item => item.projectId === id) && artifacts.registryAfter.entities.some(item => item.projectId === id)), true)
})

test('unresolved Form identity cannot be accepted', () => {
  const unresolved = proposal({ entityKind: 'form', proposedProjectId: 'form:9999:mystery', immutableAnchors: { speciesId: 'species:9999', formToken: 'mystery' }, showdownId: 'mysteryform', status: 'review-required' })
  assert.equal(classifyRegistryProposal(unresolved, { mappingClass: 'unresolved' }).reviewClassification, 'quarantine-reject')
})

test('registry review and output ordering are deterministic', async () => {
  const first = await artifactsPromise; const second = await buildRegistryReviewArtifacts()
  assert.deepEqual(second.reviewPlan, first.reviewPlan)
  assert.deepEqual(second.accepted, first.accepted)
  assert.deepEqual(second.manualReview, first.manualReview)
  assert.deepEqual(second.registryAfter, first.registryAfter)
})
