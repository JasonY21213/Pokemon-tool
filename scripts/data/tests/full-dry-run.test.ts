import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'

const artifacts = await buildFullDryRun()

describe('full-domain dry run', () => {
  test('covers exactly the 1025 official National Dex Species', () => {
    assert.equal(artifacts.species.length, 1025)
    assert.deepEqual(
      artifacts.species.map(species => species.nationalDexNumber),
      Array.from({ length: 1025 }, (_, index) => index + 1),
    )
  })

  test('keeps CAP and other non-official records out of the Species namespace', () => {
    assert.equal(artifacts.species.some(species => Number(species.nationalDexNumber) <= 0), false)
    assert.equal(artifacts.extraShowdownRecords.some(record => Number(record.num) <= 0), true)
  })

  test('resolves all Form references to a generated Species', () => {
    const speciesIds = new Set(artifacts.species.map(species => species.speciesId))
    assert.equal(artifacts.forms.every(form => speciesIds.has(form.speciesId)), true)
  })

  test('provides required zh-CN localization for every Species', () => {
    const localized = new Set(artifacts.localization.species.map(entry => entry.entityId))
    assert.equal(localized.size, 1025)
    assert.equal(artifacts.species.every(species => localized.has(species.speciesId)), true)
  })

  test('keeps registry proposals unique and review-only', () => {
    const ids = artifacts.registryProposals.map(proposal => proposal.proposedProjectId)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(artifacts.registryProposals.every(proposal => proposal.status === 'proposed' || proposal.status === 'review-required'), true)
  })

  test('records every selected input with a real SHA-256 and byte length', () => {
    assert.equal(artifacts.sourceManifest.selectedFileCount, 1059)
    assert.equal(artifacts.sourceManifest.files.length, 1059)
    assert.equal(artifacts.sourceManifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.byteLength > 0), true)
  })

  test('preserves expected quarantine evidence instead of silently accepting it', () => {
    assert.equal(artifacts.conflicts.filter(item => item.code === 'DEX_SCOPE_QUARANTINED').length, 1)
    assert.equal(artifacts.conflicts.some(item => item.entityId === 'species:1021' && item.domain === 'growth'), true)
    assert.equal(artifacts.moves.some(move => move.showdownId === 'nihillight' && move.dataStatus === 'quarantined'), true)
  })

  test('keeps all generated cross-domain references resolvable', () => {
    const speciesIds = new Set(artifacts.species.map(species => species.speciesId))
    const formIds = new Set(artifacts.forms.map(form => form.formId))
    assert.equal(artifacts.dexEntries.every(entry => speciesIds.has(entry.speciesId)), true)
    assert.equal(artifacts.evolutions.every(edge =>
      (!edge.sourceFormId || formIds.has(edge.sourceFormId))
      && (!edge.targetFormId || formIds.has(edge.targetFormId))), true)
  })
})
