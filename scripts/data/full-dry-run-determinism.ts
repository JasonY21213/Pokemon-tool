import assert from 'node:assert/strict'
import { runFullDryRun } from './full-dry-run.ts'

const first = await runFullDryRun()
const second = await runFullDryRun()
assert.deepEqual(second.deterministicHashes, first.deterministicHashes)
console.log(JSON.stringify({
  status: 'passed',
  runsCompared: 2,
  sourceTreeHash: second.artifacts.sourceManifest.selectedTreeHash,
  conflictCounts: (second.artifacts.summary.conflicts as { bySeverity: unknown }).bySeverity,
  files: second.deterministicHashes,
}, null, 2))
