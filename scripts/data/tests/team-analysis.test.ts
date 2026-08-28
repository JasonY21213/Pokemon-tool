import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { analyzeDefensiveTypes, analyzeOffensiveCoverage, defensiveGaps, repeatedWeaknesses } from '../../../src/lib/runtime-data/team-analysis.ts'
import { formsById, type TeamMember } from '../../../src/lib/runtime-data/team-builder.ts'

const dataPromise = buildFullDryRun().then(buildRuntimeData)
const charizard: TeamMember = { memberId: 'charizard', formId: 'form:0006:base', moveIds: ['move:0053'] }
const megaCharizardX: TeamMember = { memberId: 'mega-x', formId: 'form:0006:mega-x', moveIds: [] }
const gastrodon: TeamMember = { memberId: 'gastrodon', formId: 'form:0423:base', moveIds: [] }

test('Team Analysis uses actual Forms and exposes repeat weaknesses and maximum multipliers', async () => {
  const data = await dataPromise
  const analysis = analyzeDefensiveTypes([charizard, megaCharizardX], formsById(data), data.types)
  const rock = analysis.find(item => item.attackingTypeId === 'type:rock')!
  assert.equal(rock.weak, 2)
  assert.equal(rock.maxWeaknessMultiplier, 4)
  assert.deepEqual(rock.weakContributors, [
    { memberId: 'charizard', formId: 'form:0006:base', multiplier: 4 },
    { memberId: 'mega-x', formId: 'form:0006:mega-x', multiplier: 2 },
  ])
  assert.equal(repeatedWeaknesses(analysis).some(item => item.attackingTypeId === 'type:rock'), true)
})

test('Team Analysis defensive gaps require a weakness with no resistance or immunity', async () => {
  const data = await dataPromise
  const formMap = formsById(data)
  const withResist = analyzeDefensiveTypes([charizard, gastrodon], formMap, data.types)
  const rock = withResist.find(item => item.attackingTypeId === 'type:rock')!
  assert.equal(rock.weak, 1)
  assert.equal(rock.resist, 1)
  assert.equal(defensiveGaps(withResist).some(item => item.attackingTypeId === 'type:rock'), false)

  const electric = withResist.find(item => item.attackingTypeId === 'type:electric')!
  assert.equal(electric.weak, 1)
  assert.equal(electric.immune, 1)
  assert.equal(defensiveGaps(withResist).some(item => item.attackingTypeId === 'type:electric'), false)

  const noResist = analyzeDefensiveTypes([charizard, megaCharizardX], formMap, data.types)
  assert.equal(defensiveGaps(noResist).some(item => item.attackingTypeId === 'type:rock'), true)
})

test('Team Analysis selected-Move coverage is deterministic and reports unavailable without Moves', async () => {
  const data = await dataPromise
  const coverage = analyzeOffensiveCoverage([charizard], data.moves, data.types)
  const grass = coverage.covered.find(item => item.defenderTypeId === 'type:grass')!
  assert.deepEqual(grass.contributors, [{ memberId: 'charizard', formId: 'form:0006:base', moveId: 'move:0053', moveTypeId: 'type:fire' }])
  assert.equal(coverage.gaps.includes('type:water'), true)
  assert.deepEqual(coverage.covered, [...coverage.covered].sort((left, right) => left.defenderTypeId.localeCompare(right.defenderTypeId, 'en')))
  assert.deepEqual(analyzeOffensiveCoverage([megaCharizardX], data.moves, data.types), { available: false, covered: [], gaps: [] })
})
