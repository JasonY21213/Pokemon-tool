export type BattleWeather = 'none' | 'sun' | 'rain'

export type BattleStatStage = -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6

export type BattleContext = {
  weather: BattleWeather
  attackerBurned: boolean
  attackerStatStages: { atk: BattleStatStage; spa: BattleStatStage }
  defenderStatStages: { def: BattleStatStage; spd: BattleStatStage }
}

export const DEFAULT_BATTLE_CONTEXT: Readonly<BattleContext> = {
  weather: 'none',
  attackerBurned: false,
  attackerStatStages: { atk: 0, spa: 0 },
  defenderStatStages: { def: 0, spd: 0 },
}

export function assertBattleStatStage(stage: number): asserts stage is BattleStatStage {
  if (!Number.isInteger(stage) || stage < -6 || stage > 6) throw new Error('BATTLE_CONTEXT_INVALID_STAT_STAGE')
}

export function applyStatStage(value: number, stage: BattleStatStage): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('BATTLE_CONTEXT_INVALID_STAT_VALUE')
  assertBattleStatStage(stage)
  return stage >= 0
    ? Math.floor((value * (2 + stage)) / 2)
    : Math.floor((value * 2) / (2 - stage))
}

export function validateBattleContext(context: BattleContext): void {
  if (!['none', 'sun', 'rain'].includes(context.weather)) throw new Error('BATTLE_CONTEXT_INVALID_WEATHER')
  if (typeof context.attackerBurned !== 'boolean') throw new Error('BATTLE_CONTEXT_INVALID_BURN')
  assertBattleStatStage(context.attackerStatStages.atk)
  assertBattleStatStage(context.attackerStatStages.spa)
  assertBattleStatStage(context.defenderStatStages.def)
  assertBattleStatStage(context.defenderStatStages.spd)
}
