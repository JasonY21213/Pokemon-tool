import type { RuntimeNature, RuntimeStatBlock } from './types.js'

export type StatId = keyof RuntimeStatBlock
export type StatInputs = RuntimeStatBlock

export type StatCalculationInput = {
  speciesId: string
  baseStats: RuntimeStatBlock
  level: number
  ivs: StatInputs
  evs: StatInputs
  nature: RuntimeNature
}

const statIds: StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

function assertIntegerInRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`STAT_CALCULATOR_INVALID_${name}`)
}

export function validateStatCalculationInput(input: StatCalculationInput): void {
  assertIntegerInRange(input.level, 1, 100, 'LEVEL')
  for (const stat of statIds) {
    assertIntegerInRange(input.baseStats[stat], 1, 255, `BASE_${stat.toUpperCase()}`)
    assertIntegerInRange(input.ivs[stat], 0, 31, `IV_${stat.toUpperCase()}`)
    assertIntegerInRange(input.evs[stat], 0, 252, `EV_${stat.toUpperCase()}`)
  }
  const totalEvs = statIds.reduce((total, stat) => total + input.evs[stat], 0)
  if (totalEvs > 510) throw new Error('STAT_CALCULATOR_EV_TOTAL_EXCEEDED')
}

export function calculateStats(input: StatCalculationInput): RuntimeStatBlock {
  validateStatCalculationInput(input)
  const result = {} as RuntimeStatBlock
  for (const stat of statIds) {
    if (stat === 'hp' && input.speciesId === 'species:0292') {
      result.hp = 1
      continue
    }
    const intermediate = Math.floor(((2 * input.baseStats[stat] + input.ivs[stat] + Math.floor(input.evs[stat] / 4)) * input.level) / 100)
    if (stat === 'hp') {
      result.hp = intermediate + input.level + 10
      continue
    }
    const unmodified = intermediate + 5
    result[stat] = input.nature.plusStat === stat ? Math.floor((unmodified * 110) / 100)
      : input.nature.minusStat === stat ? Math.floor((unmodified * 90) / 100)
        : unmodified
  }
  return result
}

export function totalEvs(evs: StatInputs): number {
  return statIds.reduce((total, stat) => total + evs[stat], 0)
}
