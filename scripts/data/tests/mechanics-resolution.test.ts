import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprintExcel } from '../excel-validation.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildMechanicsResolutionArtifacts } from '../mechanics-resolution.ts'
import { decisionApplicability, loadReviewDecisions } from '../review-decisions.ts'

const artifactsPromise = buildMechanicsResolutionArtifacts()

test('historical Move differences are classified without changing canonical mechanics', async () => {
  const artifacts = await artifactsPromise
  const record = artifacts.moveConflicts.records.find(item => item.moveId === 'move:0320' && item.field === 'accuracy')
  assert.equal(record?.proposedRootCauseClassification, 'confirmed-current-vs-legacy')
  assert.equal(record?.changesCanonicalMechanics, false)
})

test('Move representation differences preserve canonical mechanics', async () => {
  const artifacts = await artifactsPromise
  const variable = artifacts.moveConflicts.records.find(item => item.moveId === 'move:0877' && item.field === 'basePower')
  assert.equal(variable?.proposedRootCauseClassification, 'confirmed-representation-difference')
  assert.deepEqual(variable?.semanticNormalizedValue, { showdown: 0, excel: 'formula-dependent', pokemonDatasetZh: 'formula-dependent' })
  assert.equal(variable?.changesCanonicalMechanics, false)
})

test('unresolved Move mechanics are never silently cleared', async () => {
  const artifacts = await artifactsPromise
  const unresolved = artifacts.moveConflicts.records.filter(item => item.proposedRootCauseClassification === 'genuine-unresolved')
  assert.deepEqual(unresolved.map(item => `${item.moveId}:${item.field}`).sort(), ['move:0597:accuracy', 'move:0850:pp'])
  assert.equal((artifacts.openMechanicsIssues as { total: number }).total, 2)
})

test('Nihil Light reviewed quarantine remains effective', async () => {
  const full = await buildFullDryRun()
  const nihil = full.moves.find(move => move.showdownId === 'nihillight')
  assert.equal(nihil?.dataStatus, 'quarantined')
  assert.equal(nihil?.reviewDecisionId, 'review:move:nihil-light:current-release-quarantine')
})

test('Ability evidence retains exact slot semantics', async () => {
  const artifacts = await artifactsPromise
  const report = artifacts.abilitySlotConflicts as { records: Array<{ slot: string; slotSemanticsPreserved: boolean }> }
  assert.equal(report.records.every(item => /^abilities\.(0|1|H|S)$/.test(item.slot)), true)
  assert.equal(report.records.every(item => item.slotSemanticsPreserved), true)
})

test('completed Form registry resolves Zen Form ability evidence', async () => {
  const artifacts = await artifactsPromise
  const report = artifacts.abilitySlotConflicts as { records: Array<{ showdownId: string; classification: string; resolved: boolean }> }
  const zen = report.records.filter(item => ['darmanitanzen', 'darmanitangalarzen'].includes(item.showdownId))
  assert.equal(zen.length, 2)
  assert.equal(zen.every(item => item.classification === 'form-mapping-resolved' && item.resolved), true)
})

test('Zygarde slot 0 and special slot S semantics remain distinct', async () => {
  const full = await buildFullDryRun()
  for (const showdownId of ['zygarde', 'zygarde10']) {
    const form = full.forms.find(item => item.showdownId === showdownId)
    assert.deepEqual(form?.abilities, { 0: 'Aura Break', S: 'Power Construct' })
  }
  const artifacts = await artifactsPromise
  const report = artifacts.abilitySlotConflicts as { records: Array<{ showdownId: string; classification: string }> }
  const records = report.records.filter(item => item.showdownId.startsWith('zygarde'))
  assert.equal(records.length, 2)
  assert.equal(records.every(item => item.classification === 'excel-legacy-missing/wrong'), true)
})

test('Slowking decisions are precise and resolve only the two reviewed edges', async () => {
  const artifacts = await artifactsPromise
  const report = artifacts.slowkingInvestigation as { inputConflictCount: number; resolvedCount: number; unresolvedCount: number; records: Array<{ classification: string }> }
  assert.equal(report.inputConflictCount, 2)
  assert.equal(report.resolvedCount, 2)
  assert.equal(report.unresolvedCount, 0)
  assert.equal(report.records.every(item => item.classification === 'confirmed-excel-legacy-error'), true)
})

test('Slowking review decision is SHA and fingerprint applicable', async () => {
  const decision = (await loadReviewDecisions()).find(item => item.decisionId === 'review:evolution:slowking-predecessors:excel-legacy-error')
  assert.ok(decision)
  assert.equal(decisionApplicability(decision), 'applicable')
  assert.equal(decisionApplicability(decision, {
    'pokemon-showdown': '0'.repeat(40),
    'pokemon-dataset-zh': '0'.repeat(40),
    excel: '0'.repeat(64),
  }), 'review-required')
})

test('Move conflict accounting covers all 126 records', async () => {
  const artifacts = await artifactsPromise
  const counts = artifacts.summary.moveConflicts as { input: number; resolvedOrReclassified: number; genuineUnresolved: number; byRootCause: Record<string, number> }
  assert.equal(counts.input, 126)
  assert.equal(counts.resolvedOrReclassified, 124)
  assert.equal(counts.genuineUnresolved, 2)
  assert.deepEqual(counts.byRootCause, {
    'confirmed-current-vs-legacy': 88,
    'confirmed-representation-difference': 36,
    'genuine-unresolved': 2,
  })
})

test('Ability slot accounting resolves all 21 records without unordered sets', async () => {
  const artifacts = await artifactsPromise
  const report = artifacts.abilitySlotConflicts as { inputCount: number; resolvedCount: number; remainingGenuineConflictCount: number; byRootCause: Record<string, number> }
  assert.equal(report.inputCount, 21)
  assert.equal(report.resolvedCount, 21)
  assert.equal(report.remainingGenuineConflictCount, 0)
  assert.deepEqual(report.byRootCause, {
    'excel-legacy-missing/wrong': 7,
    'form-mapping-resolved': 2,
    'translation/identity-normalization': 12,
  })
})

test('mechanics reports are deterministic and Excel stays read-only', async () => {
  const before = await fingerprintExcel()
  const first = await artifactsPromise
  const second = await buildMechanicsResolutionArtifacts()
  assert.deepEqual(second, first)
  assert.deepEqual(await fingerprintExcel(), before)
})
