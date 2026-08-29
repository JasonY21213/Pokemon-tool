export type BattleWeather = 'none' | 'sun' | 'rain' | 'sandstorm' | 'snow'

export type BattleTerrain = 'none' | 'electric' | 'grassy' | 'psychic' | 'misty'

export type BattleStatStage = -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6

export type BattleContext = {
  weather: BattleWeather
  terrain: BattleTerrain
  attackerBurned: boolean
  criticalHit: boolean
  reflect: boolean
  lightScreen: boolean
  attackerStatStages: { atk: BattleStatStage; spa: BattleStatStage }
  defenderStatStages: { def: BattleStatStage; spd: BattleStatStage }
}

export const DEFAULT_BATTLE_CONTEXT: Readonly<BattleContext> = {
  weather: 'none',
  terrain: 'none',
  attackerBurned: false,
  criticalHit: false,
  reflect: false,
  lightScreen: false,
  attackerStatStages: { atk: 0, spa: 0 },
  defenderStatStages: { def: 0, spd: 0 },
}

// Deliberately limited Phase 17 policy: actual Form typing and an explicitly
// selected Levitate are the only airborne signals currently represented.
export function isGroundedForTerrain(typeIds: readonly string[], selectedAbilityId?: string | null): boolean {
  return !typeIds.includes('type:flying') && selectedAbilityId !== 'ability:0026'
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

export function resolveCriticalHitStage(
  stage: BattleStatStage,
  side: 'attacker' | 'defender',
  criticalHit: boolean,
): BattleStatStage {
  assertBattleStatStage(stage)
  if (!criticalHit) return stage
  if (side === 'attacker' && stage < 0) return 0
  if (side === 'defender' && stage > 0) return 0
  return stage
}

export function validateBattleContext(context: BattleContext): void {
  if (!['none', 'sun', 'rain', 'sandstorm', 'snow'].includes(context.weather)) throw new Error('BATTLE_CONTEXT_INVALID_WEATHER')
  if (!['none', 'electric', 'grassy', 'psychic', 'misty'].includes(context.terrain)) throw new Error('BATTLE_CONTEXT_INVALID_TERRAIN')
  if (typeof context.attackerBurned !== 'boolean') throw new Error('BATTLE_CONTEXT_INVALID_BURN')
  if (typeof context.criticalHit !== 'boolean') throw new Error('BATTLE_CONTEXT_INVALID_CRITICAL_HIT')
  if (typeof context.reflect !== 'boolean') throw new Error('BATTLE_CONTEXT_INVALID_REFLECT')
  if (typeof context.lightScreen !== 'boolean') throw new Error('BATTLE_CONTEXT_INVALID_LIGHT_SCREEN')
  assertBattleStatStage(context.attackerStatStages.atk)
  assertBattleStatStage(context.attackerStatStages.spa)
  assertBattleStatStage(context.defenderStatStages.def)
  assertBattleStatStage(context.defenderStatStages.spd)
}
