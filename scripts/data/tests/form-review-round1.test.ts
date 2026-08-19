import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFormReviewRound1Artifacts } from '../form-review-round1.ts'
import { validateRegistryEntities } from '../registry-review.ts'

const artifactsPromise = buildFormReviewRound1Artifacts()

function record(id: string) {
  return artifactsPromise.then(artifacts => {
    const value = artifacts.safeAccept.find(item => item.proposedFormId === id)
    assert.ok(value, `missing safe Form ${id}`)
    return value
  })
}

test('Arceus type token rule accepts all 17 type Forms', async () => {
  const artifacts = await artifactsPromise
  const forms = artifacts.safeAccept.filter(item => item.ruleId === 'form-family:arceus-type-item')
  assert.equal(forms.length, 17)
  assert.equal(forms.every(item => item.forme?.toLowerCase() === item.proposedFormId.split(':').at(-1)), true)
})

test('Arceus home images do not participate in identity', async () => {
  const fire = await record('form:0493:fire')
  assert.equal(Object.keys(fire).includes('homeImages'), false)
  assert.equal(fire.ruleId, 'form-family:arceus-type-item')
})

test('Ogerpon mask rule accepts the three item-bound masks', async () => {
  const artifacts = await artifactsPromise
  const masks = artifacts.safeAccept.filter(item => item.ruleId === 'form-family:ogerpon-mask')
  assert.equal(masks.length, 3)
  assert.equal(masks.every(item => item.requiredItem !== null && item.requiredTeraType !== null && !item.battleOnly), true)
})

test('Ogerpon Tera derivative rule accepts only battle derivatives', async () => {
  const artifacts = await artifactsPromise
  const forms = artifacts.safeAccept.filter(item => item.ruleId === 'form-family:ogerpon-tera-derivative')
  assert.equal(forms.length, 4)
  assert.equal(forms.every(item => item.proposedFormId.endsWith('-tera') && item.battleOnly && item.requiredTeraType !== null), true)
})

test('battle-only Form can be registered without becoming an Evolution', async () => {
  const complete = await record('form:0718:complete')
  assert.equal(complete.ruleId, 'form-general:battle-transition')
  assert.equal(complete.formKind, 'battle')
  assert.equal(complete.proposedFormId.startsWith('evolution:'), false)
})

test('Appearance cannot enter the Form acceptance set', async () => {
  const artifacts = await artifactsPromise
  assert.equal(artifacts.safeAccept.some(item => item.proposedFormId.startsWith('appearance:')), false)
  assert.equal(artifacts.safeAccept.some(item => item.showdownId.startsWith('unown')), false)
})

test('structured token normalization has no accepted collisions', async () => {
  const artifacts = await artifactsPromise
  const keys = artifacts.safeAccept.map(item => `${item.speciesId}:${item.proposedFormId.split(':').at(-1)}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('canonical display-name changes do not change a persisted Form ID', async () => {
  const before = await record('form:0741:pa-u')
  const renamed = { ...before, canonicalEnglishName: 'Renamed display text' }
  assert.equal(renamed.proposedFormId, before.proposedFormId)
  assert.equal(renamed.showdownId, before.showdownId)
})

test('accepted Form external IDs are unique', async () => {
  const artifacts = await artifactsPromise
  const ids = artifacts.safeAccept.map(item => item.showdownId)
  assert.equal(new Set(ids).size, ids.length)
})

test('safe group is repeatable and registry validation succeeds', async () => {
  const first = await artifactsPromise
  const second = await buildFormReviewRound1Artifacts()
  assert.deepEqual(second.safeAccept, first.safeAccept)
  validateRegistryEntities(first.registryAfter.entities)
})

test('manual remainder is never written to the registry', async () => {
  const artifacts = await artifactsPromise
  const active = new Set(artifacts.registryAfter.entities.map(item => item.projectId))
  assert.equal(artifacts.manualRemainder.every(item => !active.has(item.proposedFormId)), true)
})

test('form-review reports remain deterministic', async () => {
  const first = await artifactsPromise
  const second = await buildFormReviewRound1Artifacts()
  assert.deepEqual(second.summary, first.summary)
  assert.deepEqual(second.safeAccept, first.safeAccept)
  assert.deepEqual(second.manualRemainder, first.manualRemainder)
})
