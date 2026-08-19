import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildConflictResolutionArtifacts } from '../conflict-resolution.ts'
import { ExcelValidationAdapter, fingerprintExcel } from '../excel-validation.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { decisionApplicability, decisionTargetsMove, loadReviewDecisions, parseReviewDecisions } from '../review-decisions.ts'
import { getProjectRoot, loadShowdownSource, verifySource } from '../source.ts'

const artifactsPromise = buildConflictResolutionArtifacts()
const decisionsPromise = loadReviewDecisions()
const fullPromise = buildFullDryRun()

test('Water attacking Flying is a reviewed Excel legacy error', async () => {
  const artifacts = await artifactsPromise
  assert.deepEqual(artifacts.summary.waterFlying, {
    decisionId: 'review:type-chart:water-vs-flying:excel-legacy-error', canonicalValue: 1, excelValue: 0.5, derivedRecordsLinked: 18,
  })
})

test('canonical TypeChart remains neutral for Water attacking Flying', async () => {
  const source = await loadShowdownSource(await verifySource())
  assert.equal(source.typeChart.flying.damageTaken.Water, 0)
})

test('Excel remains 0.5 and its fingerprint is unchanged', async () => {
  const before = await fingerprintExcel(); const excel = await new ExcelValidationAdapter().read()
  const cell = excel.sheets['属性克制'].cells.find(item => item.locator === '属性克制!L5')
  assert.equal(cell?.cached, 0.5); assert.deepEqual(await fingerprintExcel(), before)
})

test('all 18 derived mismatches link to one root decision', async () => {
  const artifacts = await artifactsPromise
  assert.equal((artifacts.summary.waterFlying as { derivedRecordsLinked: number }).derivedRecordsLinked, 18)
})

test('review decisions reject wildcard suppression', async () => {
  const raw = JSON.parse(await readFile(resolve(getProjectRoot(), 'data-curated/review-decisions.json'), 'utf8')) as { decisions: Array<Record<string, unknown>> }
  raw.decisions[0].selector = { field: '*' }
  assert.throws(() => parseReviewDecisions(raw), /Wildcard or broad conflict suppression/)
})

test('review decision applicability becomes review-required after source SHA change', async () => {
  const decision = (await decisionsPromise)[0]
  assert.equal(decisionApplicability(decision), 'applicable')
  assert.equal(decisionApplicability(decision, { 'pokemon-showdown': '0'.repeat(40), excel: '0'.repeat(64) }), 'review-required')
})

test('Ability 0284 investigation is stable and resolves three distinct identities', async () => {
  const report = (await artifactsPromise).ability0284 as { competingAbilities: string[]; conclusion: { stableIdentityRule: Record<string, string>; guessedNumbers: boolean } }
  assert.deepEqual(report.competingAbilities, ['vesselofruin', 'tabletsofruin', 'beadsofruin'])
  assert.deepEqual(report.conclusion.stableIdentityRule, { vesselofruin: 'ability:0284', tabletsofruin: 'ability:0286', beadsofruin: 'ability:0287' })
  assert.equal(report.conclusion.guessedNumbers, false)
})

test('unresolved Abilities never receive fake numbers', async () => {
  const report = (await artifactsPromise).unresolvedAbilities as { records: Array<{ fakeNumberAssigned: boolean }> }
  assert.equal(report.records.length, 9); assert.equal(report.records.every(item => !item.fakeNumberAssigned), true)
})

test('Nihil Light has a reviewed current-release quarantine', async () => {
  const full = await fullPromise; const move = full.moves.find(item => item.showdownId === 'nihillight')
  assert.equal(move?.dataStatus, 'quarantined')
  assert.equal(move?.reviewDecisionId, 'review:move:nihil-light:current-release-quarantine')
  assert.ok(full.conflicts.some(item => item.entityId === 'move:0920' && item.severity === 'warning'))
})

test('Nihil Light decision does not hide unrelated Future entities', async () => {
  const decision = (await decisionsPromise).find(item => item.decisionId === 'review:move:nihil-light:current-release-quarantine')
  assert.ok(decision)
  assert.equal(decisionTargetsMove(decision, 'move:0920', 'nihillight'), true)
  assert.equal(decisionTargetsMove(decision, 'move:9999', 'unrelatedfuturemove'), false)
  const full = await fullPromise
  assert.equal(full.moves.filter(item => item.showdownId !== 'nihillight').every(item => !item.reviewDecisionId), true)
})

test('Move conflict grouping is complete and deterministic', async () => {
  const first = (await artifactsPromise).moveConflictGroups
  const second = (await buildConflictResolutionArtifacts()).moveConflictGroups
  assert.deepEqual(second, first)
  assert.equal((first as { inputConflictCount: number }).inputConflictCount, 126)
})

test('Ability slot conflict grouping preserves the 24-record baseline deterministically', async () => {
  const first = (await artifactsPromise).abilitySlotConflictGroups
  const second = (await buildConflictResolutionArtifacts()).abilitySlotConflictGroups
  assert.deepEqual(second, first)
  assert.equal((first as { inputConflictCountBeforeDecisions: number }).inputConflictCountBeforeDecisions, 24)
  assert.equal((first as { groupedCount: number }).groupedCount, 24)
})
