import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { ExcelValidationAdapter, fingerprintExcel } from '../excel-validation.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { serializeJson } from '../serialization.ts'
import { getProjectRoot, sha256 } from '../source.ts'
import { buildTagArtifacts, buildTagsFromExcel, loadCuratedTags, validateTags } from '../tags.ts'

const artifacts = await buildFullDryRun()
const curated = await loadCuratedTags()
const expectedByTag = {
  'tag:starter': 83,
  'tag:major-legendary': 27,
  'tag:minor-legendary': 44,
  'tag:mythical': 23,
  'tag:pseudo-legendary': 30,
  'tag:fossil': 25,
  'tag:ultra-beast': 11,
  'tag:paradox': 20,
  'tag:mega': 90,
  'tag:primal': 2,
}

test('migrates all ten definitions and the audited 355 stable assignments', () => {
  assert.equal(curated.definitions.length, 10)
  assert.equal(curated.assignments.length, 355)
  assert.deepEqual(Object.fromEntries(curated.definitions.map(definition => [definition.tagId, curated.assignments.filter(item => item.tagId === definition.tagId).length])), expectedByTag)
  assert.equal(curated.assignments.filter(item => item.entityId.startsWith('species:')).length, 263)
  assert.equal(curated.assignments.filter(item => item.entityId.startsWith('form:') && item.tagId === 'tag:mega').length, 90)
  assert.equal(curated.assignments.filter(item => item.entityId.startsWith('form:') && item.tagId === 'tag:primal').length, 2)
})

test('keeps representative tags on their intended stable entity level', () => {
  const has = (entityId: string, tagId: string) => curated.assignments.some(item => item.entityId === entityId && item.tagId === tagId)
  assert.equal(has('species:0001', 'tag:starter'), true)
  assert.equal(has('species:0150', 'tag:major-legendary'), true)
  assert.equal(has('species:0144', 'tag:minor-legendary'), true)
  assert.equal(has('species:0151', 'tag:mythical'), true)
  assert.equal(has('species:0149', 'tag:pseudo-legendary'), true)
  assert.equal(has('species:0138', 'tag:fossil'), true)
  assert.equal(has('species:0793', 'tag:ultra-beast'), true)
  assert.equal(has('species:0984', 'tag:paradox'), true)
  assert.equal(has('form:0006:mega-x', 'tag:mega'), true)
  assert.equal(has('form:0382:primal', 'tag:primal'), true)
  assert.equal(has('species:0006', 'tag:mega'), false)
  assert.equal(has('species:0382', 'tag:primal'), false)
})

test('preserves all three ambiguous Mega source rows without a base-Species fallback', () => {
  assert.deepEqual(curated.unresolved.map(row => ({ dex: row.nationalDexNumber, candidates: row.candidateEntityIds })), [
    { dex: 678, candidates: ['form:0678:f-mega', 'form:0678:m-mega'] },
    { dex: 801, candidates: ['form:0801:mega', 'form:0801:original-mega'] },
    { dex: 978, candidates: ['form:0978:curly-mega', 'form:0978:droopy-mega', 'form:0978:stretchy-mega'] },
  ])
  assert.equal(curated.unresolved.every(row => row.status === 'unresolved' && row.tagId === 'tag:mega' && row.reason === 'non-unique-form-match'), true)
})

test('validates stable targets and rejects duplicate, orphan, and wrong-level assignments', () => {
  validateTags(curated, artifacts)
  const duplicate = structuredClone(curated)
  duplicate.assignments.push(structuredClone(duplicate.assignments[0]))
  assert.throws(() => validateTags(duplicate, artifacts), /TAG_DUPLICATE_ASSIGNMENT_ID/)
  const orphan = structuredClone(curated)
  const orphanAssignment = orphan.assignments.find(item => item.entityId.startsWith('species:'))!
  orphanAssignment.entityId = 'species:9999'
  orphanAssignment.assignmentId = `tag-assignment:${orphanAssignment.tagId.slice(4)}:species:9999`
  assert.throws(() => validateTags(orphan, artifacts), /TAG_ORPHAN_ENTITY/)
  const wrongLevel = structuredClone(curated)
  const wrongLevelAssignment = wrongLevel.assignments.find(item => item.entityId.startsWith('species:'))!
  wrongLevelAssignment.entityId = 'form:0006:mega-x'
  wrongLevelAssignment.assignmentId = `tag-assignment:${wrongLevelAssignment.tagId.slice(4)}:form:0006:mega-x`
  assert.throws(() => validateTags(wrongLevel, artifacts), /TAG_ENTITY_KIND/)
})

test('keeps canonical tag output lightweight and provenance separate', () => {
  const tags = buildTagArtifacts(curated, artifacts)
  assert.equal(tags.canonical.assignments.length, 355)
  assert.equal(tags.canonical.assignments.every(item => Object.keys(item).join(',') === 'entityId,tagId'), true)
  assert.equal(tags.provenance.assignments.every(item => item.sourceEvidence.sourceId === 'excel'), true)
  assert.equal((tags.report.finalAssignments as { total: number }).total, 355)
})

test('rebuilds the curated tags deterministically from the read-only workbook', async () => {
  const before = await fingerprintExcel()
  const excel = await new ExcelValidationAdapter().read()
  const rebuilt = buildTagsFromExcel(excel, artifacts)
  assert.equal(serializeJson(rebuilt), serializeJson(curated))
  assert.deepEqual(await fingerprintExcel(), before)
})

test('does not mutate the stable registry or pre-existing canonical data', async () => {
  assert.equal(sha256(await readFile(resolve(getProjectRoot(), 'data-curated', 'id-registry.json'))), '1fe332dcb200e7d5b92d958d3890c10ed95c2ca2023abf6682caf558c3cfe138')
  assert.equal(sha256(serializeJson(artifacts.species)), '98e7f84f75ad8acda35414cbfa5b336ae20b6eaf886ccfea0ed73dc0a5506ac3')
  assert.equal(sha256(serializeJson(artifacts.forms)), 'd6e79eb7897f9e71f66c8716b725d5516b013bacc300d54cbd8a34d0dbebc201')
  assert.equal(sha256(serializeJson(artifacts.abilities)), '342261a8096f9c720b30233136b3092379c7867f657bd03f182c211f1b64a090')
  assert.equal(sha256(serializeJson(artifacts.moves)), 'a7b8f7ebd41a1de3de773bdc01c60bb030ce4ce4cd7d869eccc20db0012b54e2')
  assert.equal(sha256(serializeJson(artifacts.localization)), '098d9df8c32ee1ce659fdabe90679802e21ccd1466def81c99ae1c4e718a44fc')
})
