import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { expProgress, levelToTotalExp, resolveEffectiveGrowthRate, totalExpToLevel } from '../../../src/lib/runtime-data/experience-calculator.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

async function rate(id: string) {
  const result = (await runtimePromise).growthRates.find(candidate => candidate.growthRateId === id)
  assert.ok(result, `missing ${id}`)
  return result
}

test('all six canonical growth-rate tables retain independent level-50 and level-100 thresholds', async () => {
  const expected = {
    'growth:erratic': [125000, 600000], 'growth:fast': [100000, 800000], 'growth:medium-fast': [125000, 1000000],
    'growth:medium-slow': [117360, 1059860], 'growth:slow': [156250, 1250000], 'growth:fluctuating': [142500, 1640000],
  }
  for (const [id, [level50, level100]] of Object.entries(expected)) {
    const growthRate = await rate(id)
    assert.equal(levelToTotalExp(growthRate, 1), 0)
    assert.equal(levelToTotalExp(growthRate, 50), level50)
    assert.equal(levelToTotalExp(growthRate, 100), level100)
  }
})

test('total EXP conversion respects boundaries and clamps at level 100', async () => {
  const mediumFast = await rate('growth:medium-fast')
  assert.equal(totalExpToLevel(mediumFast, 124999), 49)
  assert.equal(totalExpToLevel(mediumFast, 125000), 50)
  assert.equal(totalExpToLevel(mediumFast, 2000000), 100)
  assert.deepEqual(expProgress(mediumFast, 125000), { currentLevel: 50, currentLevelTotalExp: 125000, nextLevelTotalExp: 132651, expIntoCurrentLevel: 0, expNeededForNextLevel: 7651, progressFraction: 0 })
  assert.equal(expProgress(mediumFast, 1000000).nextLevelTotalExp, null)
})

test('Species defaults, Partner Eevee override, and Raging Bolt unresolved state remain explicit', async () => {
  const runtime = await runtimePromise
  const eevee = runtime.species.find(species => species.speciesId === 'species:0133')!
  const eeveeBase = runtime.forms.find(form => form.formId === 'form:0133:base')!
  const partner = runtime.forms.find(form => form.formId === 'form:0133:partner')!
  const ragingBolt = runtime.species.find(species => species.speciesId === 'species:1021')!
  const ragingBoltForm = runtime.forms.find(form => form.formId === 'form:1021:base')!
  assert.equal(resolveEffectiveGrowthRate(eevee, eeveeBase, runtime.growthRates)?.growthRateId, 'growth:medium-fast')
  assert.equal(resolveEffectiveGrowthRate(eevee, partner, runtime.growthRates)?.growthRateId, 'growth:medium-slow')
  assert.equal(resolveEffectiveGrowthRate(ragingBolt, ragingBoltForm, runtime.growthRates), null)
})

test('invalid inputs fail instead of silently clamping', async () => {
  const mediumFast = await rate('growth:medium-fast')
  assert.throws(() => levelToTotalExp(mediumFast, 0), /INVALID_LEVEL/)
  assert.throws(() => totalExpToLevel(mediumFast, -1), /INVALID_TOTAL/)
})
