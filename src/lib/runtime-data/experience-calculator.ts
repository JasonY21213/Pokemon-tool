import type { RuntimeForm, RuntimeGrowthRate, RuntimeSpecies } from './types.js'

export type ExperienceProgress = {
  currentLevel: number
  currentLevelTotalExp: number
  nextLevelTotalExp: number | null
  expIntoCurrentLevel: number
  expNeededForNextLevel: number | null
  progressFraction: number | null
}

export const EXPERIENCE_CANDY_VALUES = { xs: 100, s: 800, m: 3000, l: 10000, xl: 30000 } as const
export const EXPERIENCE_CANDY_MAX_COUNT = 999
export type ExperienceCandySize = keyof typeof EXPERIENCE_CANDY_VALUES
export type ExperienceCandyCounts = Record<ExperienceCandySize, number>

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

export function experienceBetweenLevels(growthRate: RuntimeGrowthRate, currentLevel: number, targetLevel: number): number {
  assertLevel(currentLevel)
  assertLevel(targetLevel)
  if (targetLevel < currentLevel) throw new Error('EXPERIENCE_TARGET_BELOW_CURRENT')
  return levelToTotalExp(growthRate, targetLevel) - levelToTotalExp(growthRate, currentLevel)
}

export function totalExperienceCandyValue(counts: ExperienceCandyCounts): number {
  return (Object.keys(EXPERIENCE_CANDY_VALUES) as ExperienceCandySize[]).reduce((total, size) => {
    const count = counts[size]
    if (!Number.isInteger(count) || count < 0 || count > EXPERIENCE_CANDY_MAX_COUNT) throw new Error(`EXPERIENCE_CANDY_COUNT_INVALID: ${size}`)
    return total + count * EXPERIENCE_CANDY_VALUES[size]
  }, 0)
}

export function maxCandyCountForTarget(requiredExperience: number, candyValue: number, otherCandyExperience: number): number {
  if (![requiredExperience, candyValue, otherCandyExperience].every(Number.isInteger) || requiredExperience < 0 || candyValue <= 0 || otherCandyExperience < 0) throw new Error('EXPERIENCE_CANDY_MAX_INPUT_INVALID')
  return Math.min(EXPERIENCE_CANDY_MAX_COUNT, Math.ceil(Math.max(0, requiredExperience - otherCandyExperience) / candyValue))
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
