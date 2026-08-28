import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEffectiveLearnsetMoveIds } from '../../../src/lib/runtime-data/learnsets.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const artifactsPromise = buildFullDryRun()

test('learnset source evidence resolves deterministically through stable Move IDs', async () => {
  const artifacts = await artifactsPromise
  assert.deepEqual(artifacts.learnsetReport, {
    policy: 'pinned-showdown-known-association-across-generations',
    entityCount: 1380,
    explicitSourceEntityCount: 1151,
    inheritedEntityCount: 795,
    sourceMovePairCount: 85544,
    sourceAcquisitionRecordCount: 305276,
    resolvedMovePairCount: 85544,
    unresolvedMovePairCount: 0,
    quarantinedMovePairCount: 0,
  })
  const bulbasaurAcidSpray = artifacts.learnsets.find(entry => entry.entityId === 'form:0001:base' && entry.moveId === 'move:0491')
  assert.deepEqual(bulbasaurAcidSpray?.evidence, [{ sourceCode: '9M', generation: 9, kind: 'machine', detail: null }])
  const pairKeys = artifacts.learnsets.map(entry => `${entry.entityId}:${entry.moveId}`)
  assert.equal(new Set(pairKeys).size, pairKeys.length)
  assert.equal(artifacts.learnsetUnresolved.length, 0)
  assert.equal(artifacts.learnsets.some(entry => entry.moveId === 'move:0920'), false)
})

test('effective learnsets follow pinned Form and pre-evolution inheritance semantics', async () => {
  const runtime = buildRuntimeData(await artifactsPromise)
  const entry = (entityId: string) => runtime.learnsets.entries.find(candidate => candidate.entityId === entityId)
  const effective = (entityId: string) => resolveEffectiveLearnsetMoveIds(runtime.learnsets, entityId)

  assert.equal(entry('form:0001:base')?.parentEntityId, null)
  assert.equal(entry('form:0003:base')?.parentEntityId, 'form:0002:base')
  assert.equal(effective('form:0003:base').includes('move:0033'), true)
  assert.deepEqual(effective('form:0006:mega-x'), effective('form:0006:base'))
  assert.equal(entry('form:0006:mega-x')?.parentEntityId, 'form:0006:base')

  assert.deepEqual(entry('form:0479:heat')?.directMoveIds, ['move:0315'])
  assert.equal(entry('form:0479:heat')?.parentEntityId, 'form:0479:base')
  assert.equal(effective('form:0479:heat').includes('move:0315'), true)

  assert.equal(entry('form:0058:hisui')?.parentEntityId, null)
  assert.notDeepEqual(effective('form:0058:hisui'), effective('form:0058:base'))
  assert.equal(entry('form:0493:bug')?.parentEntityId, 'form:0493:base')
  assert.deepEqual(effective('form:0493:bug'), effective('form:0493:base'))

  assert.equal(entry('form:1017:wellspring')?.parentEntityId, 'form:1017:base')
  assert.equal(entry('form:1017:wellspring-tera')?.parentEntityId, 'form:1017:wellspring')
  assert.deepEqual(effective('form:1017:wellspring-tera'), effective('form:1017:base'))
  assert.equal(entry('form:0133:partner')?.parentEntityId, null)
  assert.equal(effective('form:0133:partner').includes('move:0733'), true)
})

test('runtime learnsets have no dangling entity or usable Move references', async () => {
  const runtime = buildRuntimeData(await artifactsPromise)
  const formIds = new Set(runtime.forms.map(form => form.formId))
  const moveIds = new Set(runtime.moves.map(move => move.moveId))
  assert.equal(runtime.learnsets.entries.every(entry => formIds.has(entry.entityId) && (entry.parentEntityId === null || formIds.has(entry.parentEntityId))), true)
  assert.equal(runtime.learnsets.entries.every(entry => entry.directMoveIds.every(moveId => moveIds.has(moveId))), true)
  assert.equal(runtime.learnsets.entries.some(entry => entry.directMoveIds.includes('move:0920')), false)
})
