import type { RuntimeForm, RuntimeGrowthRate, RuntimeSpecies } from './types.js'

export type ExperienceProgress = {
  currentLevel: number
  currentLevelTotalExp: number
  nextLevelTotalExp: number | null
  expIntoCurrentLevel: number
  expNeededForNextLevel: number | null
  progressFraction: number | null
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error('EXPERIENCE_INVALID_LEVEL')
}

function assertTotalExp(totalExp: number): void {
  if (!Number.isInteger(totalExp) || totalExp < 0) throw new Error('EXPERIENCE_INVALID_TOTAL')
}

export function levelToTotalExp(growthRate: RuntimeGrowthRate, level: number): number {
  assertLevel(level)
  return growthRate.totalExpByLevel[level - 1]
}

export function totalExpToLevel(growthRate: RuntimeGrowthRate, totalExp: number): number {
  assertTotalExp(totalExp)
  for (let level = 100; level >= 1; level -= 1) {
    if (totalExp >= levelToTotalExp(growthRate, level)) return level
  }
  return 1
}

export function expProgress(growthRate: RuntimeGrowthRate, totalExp: number): ExperienceProgress {
  const currentLevel = totalExpToLevel(growthRate, totalExp)
  const currentLevelTotalExp = levelToTotalExp(growthRate, currentLevel)
  if (currentLevel === 100) {
    return { currentLevel, currentLevelTotalExp, nextLevelTotalExp: null, expIntoCurrentLevel: totalExp - currentLevelTotalExp, expNeededForNextLevel: null, progressFraction: null }
  }
  const nextLevelTotalExp = levelToTotalExp(growthRate, currentLevel + 1)
  const expIntoCurrentLevel = totalExp - currentLevelTotalExp
  const expNeededForNextLevel = nextLevelTotalExp - totalExp
  return { currentLevel, currentLevelTotalExp, nextLevelTotalExp, expIntoCurrentLevel, expNeededForNextLevel, progressFraction: expIntoCurrentLevel / (nextLevelTotalExp - currentLevelTotalExp) }
}

export function resolveEffectiveGrowthRate(species: RuntimeSpecies, form: RuntimeForm, growthRates: RuntimeGrowthRate[]): RuntimeGrowthRate | null {
  const resolution = form.growthRateOverride ?? species.growthRate
  return resolution.status === 'resolved' && resolution.id ? growthRates.find(rate => rate.growthRateId === resolution.id) ?? null : null
}
