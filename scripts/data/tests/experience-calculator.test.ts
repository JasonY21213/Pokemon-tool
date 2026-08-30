import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { EXPERIENCE_CANDY_VALUES, expProgress, experienceBetweenLevels, levelToTotalExp, maxCandyCountForTarget, resolveEffectiveGrowthRate, totalExperienceCandyValue, totalExpToLevel } from '../../../src/lib/runtime-data/experience-calculator.ts'

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
  assert.deepEqual(expProgress(mediumFast, 126000), { currentLevel: 50, currentLevelTotalExp: 125000, nextLevelTotalExp: 132651, expIntoCurrentLevel: 1000, expNeededForNextLevel: 6651, progressFraction: 1000 / 7651 })
  assert.deepEqual(expProgress(mediumFast, 2000000), { currentLevel: 100, currentLevelTotalExp: 1000000, nextLevelTotalExp: null, expIntoCurrentLevel: 1000000, expNeededForNextLevel: null, progressFraction: null })
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

test('level ranges report the experience between exact level thresholds', async () => {
  const mediumFast = await rate('growth:medium-fast')
  assert.equal(experienceBetweenLevels(mediumFast, 1, 50), 125000)
  assert.equal(experienceBetweenLevels(mediumFast, 50, 50), 0)
  assert.equal(experienceBetweenLevels(mediumFast, 50, 100), 875000)
  assert.throws(() => experienceBetweenLevels(mediumFast, 51, 50), /TARGET_BELOW_CURRENT/)
})

test('candy totals and per-size MAX respect existing candy experience and the 999 cap', () => {
  assert.equal(totalExperienceCandyValue({ xs: 1, s: 2, m: 3, l: 4, xl: 5 }), 200700)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.xs, 0), 240)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.s, 0), 30)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.m, 0), 8)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.l, 0), 3)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.xl, 0), 1)
  assert.equal(maxCandyCountForTarget(24000, EXPERIENCE_CANDY_VALUES.m, 9000), 5)
  assert.equal(maxCandyCountForTarget(1000000, EXPERIENCE_CANDY_VALUES.xs, 0), 999)
  assert.throws(() => totalExperienceCandyValue({ xs: 1000, s: 0, m: 0, l: 0, xl: 0 }), /COUNT_INVALID/)
})
