import { calculateDefensiveMatchup, type DefensiveMatchup } from './type-matchup.ts'
import { adjustDefensiveMultiplier, type AbilityAdjustedMultiplier, type AppliedAbilityEffect } from './ability-mechanics.ts'
import { applyStatStage, DEFAULT_BATTLE_CONTEXT, isGroundedForTerrain, resolveCriticalHitStage, validateBattleContext, type BattleContext, type BattleStatStage, type BattleTerrain, type BattleWeather } from './battle-context.ts'
import { applyItemFixedPointModifier, itemEffect, type AppliedItemEffect } from './held-item-mechanics.ts'
import { effectiveTypeIds, INACTIVE_TERASTALLIZATION, resolveOrdinaryTeraBasePower, resolveStab, validateTerastallizationState, type ResolvedStab, type TerastallizationState } from './terastallization.ts'
import type { RuntimeAbility, RuntimeItem, RuntimeMove, RuntimeMoveDamageUnsupportedReason, RuntimeStatBlock, RuntimeType } from './types.js'

export type DamageCoreInput = {
  level: number
  attack: number
  defense: number
  basePower: number
  moveTypeId: string
  attackerTypeIds: string[]
  defenderTypeIds: string[]
  types: RuntimeType[]
  attackerAbility?: RuntimeAbility | null
  defenderAbility?: RuntimeAbility | null
  attackerItem?: RuntimeItem | null
  moveCategory: 'physical' | 'special'
  battleContext?: BattleContext
  attackerTerastallization?: TerastallizationState
  defenderTerastallization?: TerastallizationState
  movePriority?: number
}

export type AppliedBattleContextModifier =
  | { kind: 'stat-stage'; stat: 'atk' | 'def' | 'spa' | 'spd'; stage: BattleStatStage; effectiveStage: BattleStatStage; before: number; after: number }
  | { kind: 'weather'; weather: 'sun' | 'rain'; multiplier: 0.5 | 1.5 }
  | { kind: 'weather-defense-stat'; weather: 'sandstorm' | 'snow'; stat: 'def' | 'spd'; before: number; after: number; multiplier: 1.5 }
  | { kind: 'critical-hit'; multiplier: 1.5 }
  | { kind: 'burn'; multiplier: 0.5 }
  | { kind: 'screen'; screen: 'reflect' | 'light-screen'; multiplier: 0.5 }
  | { kind: 'screen-bypassed'; screen: 'reflect' | 'light-screen'; reason: 'critical-hit' }

export type AppliedTerrainEffect =
  | { kind: 'attacker-type-base-power'; terrain: 'electric' | 'grassy' | 'psychic'; typeId: 'type:electric' | 'type:grass' | 'type:psychic'; numerator: 5325; denominator: 4096 }
  | { kind: 'defender-dragon-base-power-reduction'; terrain: 'misty'; typeId: 'type:dragon'; numerator: 1; denominator: 2 }

export type DamageCoreResult = {
  minDamage: number
  maxDamage: number
  rolls: number[]
  typeMultiplier: DefensiveMatchup['multiplier']
  abilityAdjustedTypeMultiplier: AbilityAdjustedMultiplier
  stabMultiplier: 1 | 1.5 | 2 | 2.25
  stabResolution: ResolvedStab
  modifiers: Array<'random-85-to-100' | 'stab' | 'type-effectiveness'>
  appliedAbilityEffects: AppliedAbilityEffect[]
  unmodeledAbilityIds: string[]
  effectiveAttack: number
  effectiveDefense: number
  appliedBattleContextModifiers: AppliedBattleContextModifier[]
  attackerGrounded: boolean
  defenderGrounded: boolean
  appliedTerrainEffects: AppliedTerrainEffect[]
  effectiveBasePower: number
  appliedItemEffects: AppliedItemEffect[]
  unmodeledItemIds: string[]
  effectiveAttackerTypeIds: string[]
  effectiveDefenderTypeIds: string[]
  teraBasePowerFloorApplied: boolean
}

export type MoveDamageInput = {
  level: number
  move: RuntimeMove
  attackerStats: RuntimeStatBlock
  defenderStats: RuntimeStatBlock
  attackerTypeIds: string[]
  defenderTypeIds: string[]
  types: RuntimeType[]
  attackerAbility?: RuntimeAbility | null
  defenderAbility?: RuntimeAbility | null
  attackerItem?: RuntimeItem | null
  battleContext?: BattleContext
  attackerTerastallization?: TerastallizationState
  defenderTerastallization?: TerastallizationState
}

export type MoveDamageResult =
  | ({ status: 'supported'; attackingStat: 'atk' | 'spa'; defendingStat: 'def' | 'spd'; attack: number; defense: number } & DamageCoreResult)
  | { status: 'non-damaging' }
  | { status: 'unsupported'; reason: RuntimeMoveDamageUnsupportedReason }
  | { status: 'incomplete'; reason: 'unknown-or-incomplete-mechanics' }
  | { status: 'unsupported-context'; reason: 'burn-with-guts' | 'sun-with-hydro-steam' }

function assertInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`DAMAGE_CALCULATOR_INVALID_${label}`)
}

// Mirrors the pinned Showdown Gen 9 fixed-point modifier rounding for ordinary STAB.
function applyFixedPointModifier(value: number, numerator: number, denominator: number): number {
  const modifier = Math.floor((numerator * 4096) / denominator)
  return Math.floor((value * modifier + 2047) / 4096)
}

function chainFixedPointModifier(previous: number, numerator: number, denominator: number): number {
  const next = Math.floor((numerator * 4096) / denominator)
  return Math.floor((previous * next + 2048) / 4096)
}

function applyTypeMultiplier(value: number, multiplier: DefensiveMatchup['multiplier']): number {
  if (multiplier === 0) return 0
  if (multiplier === 4) return value * 4
  if (multiplier === 2) return value * 2
  if (multiplier === 1) return value
  if (multiplier === 0.5) return Math.floor(value / 2)
  return Math.floor(Math.floor(value / 2) / 2)
}

function weatherMultiplier(weather: BattleWeather, moveTypeId: string): 0.5 | 1 | 1.5 {
  if (weather === 'sun' && moveTypeId === 'type:fire') return 1.5
  if (weather === 'sun' && moveTypeId === 'type:water') return 0.5
  if (weather === 'rain' && moveTypeId === 'type:water') return 1.5
  if (weather === 'rain' && moveTypeId === 'type:fire') return 0.5
  return 1
}

function terrainEffect(terrain: BattleTerrain, moveTypeId: string, attackerGrounded: boolean, defenderGrounded: boolean): AppliedTerrainEffect | undefined {
  if (attackerGrounded && terrain === 'electric' && moveTypeId === 'type:electric') return { kind: 'attacker-type-base-power', terrain, typeId: moveTypeId, numerator: 5325, denominator: 4096 }
  if (attackerGrounded && terrain === 'grassy' && moveTypeId === 'type:grass') return { kind: 'attacker-type-base-power', terrain, typeId: moveTypeId, numerator: 5325, denominator: 4096 }
  if (attackerGrounded && terrain === 'psychic' && moveTypeId === 'type:psychic') return { kind: 'attacker-type-base-power', terrain, typeId: moveTypeId, numerator: 5325, denominator: 4096 }
  if (defenderGrounded && terrain === 'misty' && moveTypeId === 'type:dragon') return { kind: 'defender-dragon-base-power-reduction', terrain, typeId: moveTypeId, numerator: 1, denominator: 2 }
  return undefined
}

export function calculateCoreDamage(input: DamageCoreInput): DamageCoreResult {
  assertInteger(input.level, 1, 100, 'LEVEL')
  assertInteger(input.attack, 1, 9999, 'ATTACK')
  assertInteger(input.defense, 1, 9999, 'DEFENSE')
  assertInteger(input.basePower, 1, 9999, 'BASE_POWER')
  const context = input.battleContext ?? DEFAULT_BATTLE_CONTEXT
  validateBattleContext(context)
  const attackerTerastallization = input.attackerTerastallization ?? INACTIVE_TERASTALLIZATION
  const defenderTerastallization = input.defenderTerastallization ?? INACTIVE_TERASTALLIZATION
  validateTerastallizationState(attackerTerastallization)
  validateTerastallizationState(defenderTerastallization)
  if (input.attackerTypeIds.length < 1 || input.attackerTypeIds.length > 2 || new Set(input.attackerTypeIds).size !== input.attackerTypeIds.length) throw new Error('DAMAGE_CALCULATOR_INVALID_ATTACKER_TYPES')
  if (input.defenderTypeIds.length < 1 || input.defenderTypeIds.length > 2 || new Set(input.defenderTypeIds).size !== input.defenderTypeIds.length) throw new Error('DAMAGE_CALCULATOR_INVALID_DEFENDER_TYPES')

  const effectiveAttackerTypeIds = effectiveTypeIds(input.attackerTypeIds, attackerTerastallization)
  const effectiveDefenderTypeIds = effectiveTypeIds(input.defenderTypeIds, defenderTerastallization)
  const matchup = calculateDefensiveMatchup(input.types, effectiveDefenderTypeIds[0], effectiveDefenderTypeIds[1])
  const typeMultiplier = matchup.find(entry => entry.attackingTypeId === input.moveTypeId)?.multiplier
  if (typeMultiplier === undefined) throw new Error(`DAMAGE_CALCULATOR_UNKNOWN_MOVE_TYPE: ${input.moveTypeId}`)
  const defensiveAdjustment = adjustDefensiveMultiplier({ attackingTypeId: input.moveTypeId, multiplier: typeMultiplier }, input.defenderAbility ?? null)
  const stabEffect = input.attackerAbility?.mechanics.status === 'supported'
    ? input.attackerAbility.mechanics.effects.find(effect => effect.kind === 'stab-multiplier')
    : undefined
  const stabResolution = resolveStab(input.attackerTypeIds, attackerTerastallization, input.moveTypeId, stabEffect?.kind === 'stab-multiplier')
  const stabMultiplier = stabResolution.multiplier
  const appliedAbilityEffects: AppliedAbilityEffect[] = [
    ...(stabResolution.adaptabilityApplied && stabEffect ? [{ abilityId: input.attackerAbility!.abilityId, effect: stabEffect }] : []),
    ...defensiveAdjustment.appliedEffects,
  ]
  const unmodeledAbilityIds = [input.attackerAbility, input.defenderAbility]
    .filter((ability): ability is RuntimeAbility => ability?.mechanics.status === 'unsupported')
    .map(ability => ability.abilityId)
  const attackerGrounded = isGroundedForTerrain(effectiveAttackerTypeIds, input.attackerAbility?.abilityId)
  const defenderGrounded = isGroundedForTerrain(effectiveDefenderTypeIds, input.defenderAbility?.abilityId)
  const appliedTerrainEffect = terrainEffect(context.terrain, input.moveTypeId, attackerGrounded, defenderGrounded)
  const appliedTerrainEffects = appliedTerrainEffect ? [appliedTerrainEffect] : []

  const attackingStat: 'atk' | 'spa' = input.moveCategory === 'physical' ? 'atk' : 'spa'
  const defendingStat: 'def' | 'spd' = input.moveCategory === 'physical' ? 'def' : 'spd'
  const attackStage = context.attackerStatStages[attackingStat]
  const defenseStage = context.defenderStatStages[defendingStat]
  const effectiveAttackStage = resolveCriticalHitStage(attackStage, 'attacker', context.criticalHit)
  const effectiveDefenseStage = resolveCriticalHitStage(defenseStage, 'defender', context.criticalHit)
  const stagedAttack = applyStatStage(input.attack, effectiveAttackStage)
  const stagedDefense = applyStatStage(input.defense, effectiveDefenseStage)
  const defensiveWeather = context.weather === 'sandstorm' && defendingStat === 'spd' && effectiveDefenderTypeIds.includes('type:rock')
    ? 'sandstorm' as const
    : context.weather === 'snow' && defendingStat === 'def' && effectiveDefenderTypeIds.includes('type:ice')
      ? 'snow' as const
      : null
  const effectiveDefense = defensiveWeather ? applyFixedPointModifier(stagedDefense, 3, 2) : stagedDefense
  const appliedBattleContextModifiers: AppliedBattleContextModifier[] = [
    ...(attackStage !== 0 ? [{ kind: 'stat-stage' as const, stat: attackingStat, stage: attackStage, effectiveStage: effectiveAttackStage, before: input.attack, after: stagedAttack }] : []),
    ...(defenseStage !== 0 ? [{ kind: 'stat-stage' as const, stat: defendingStat, stage: defenseStage, effectiveStage: effectiveDefenseStage, before: input.defense, after: stagedDefense }] : []),
    ...(defensiveWeather ? [{ kind: 'weather-defense-stat' as const, weather: defensiveWeather, stat: defendingStat, before: stagedDefense, after: effectiveDefense, multiplier: 1.5 as const }] : []),
  ]
  const levelFactor = Math.floor((2 * input.level) / 5) + 2
  const incomingAttackEffect = defensiveAdjustment.appliedEffects.find(item => item.effect.kind === 'incoming-type-attack-multiplier')?.effect
  const abilityAdjustedAttack = incomingAttackEffect?.kind === 'incoming-type-attack-multiplier'
    ? applyFixedPointModifier(stagedAttack, 1, 2)
    : stagedAttack
  const attackItemEffect = input.moveCategory === 'physical'
    ? itemEffect(input.attackerItem, 'attack-stat-multiplier')
    : itemEffect(input.attackerItem, 'special-attack-stat-multiplier')
  const effectiveAttack = attackItemEffect
    ? applyItemFixedPointModifier(abilityAdjustedAttack, attackItemEffect.numerator, attackItemEffect.denominator)
    : abilityAdjustedAttack
  const typePowerEffect = itemEffect(input.attackerItem, 'move-type-base-power-multiplier')
  const appliedTypePowerEffect = typePowerEffect?.typeId === input.moveTypeId ? typePowerEffect : undefined
  let basePowerModifier = 4096
  // Pinned Showdown runs held Item BasePower callbacks (priority 15) before
  // Terrain BasePower callbacks (priority 6), chaining both before one rounding.
  if (appliedTypePowerEffect) basePowerModifier = chainFixedPointModifier(basePowerModifier, appliedTypePowerEffect.numerator, appliedTypePowerEffect.denominator)
  if (appliedTerrainEffect) basePowerModifier = chainFixedPointModifier(basePowerModifier, appliedTerrainEffect.numerator, appliedTerrainEffect.denominator)
  const modifiedBasePower = basePowerModifier === 4096 ? input.basePower : applyFixedPointModifier(input.basePower, basePowerModifier, 4096)
  const teraBasePower = input.movePriority === undefined
    ? { basePower: modifiedBasePower, floorApplied: false }
    : resolveOrdinaryTeraBasePower(modifiedBasePower, input.moveTypeId, input.movePriority, attackerTerastallization)
  const effectiveBasePower = teraBasePower.basePower
  const appliedItemEffects: AppliedItemEffect[] = [
    ...(attackItemEffect && input.attackerItem ? [{ itemId: input.attackerItem.itemId, effect: attackItemEffect }] : []),
    ...(appliedTypePowerEffect && input.attackerItem ? [{ itemId: input.attackerItem.itemId, effect: appliedTypePowerEffect }] : []),
  ]
  const dividedByDefense = Math.floor((levelFactor * effectiveBasePower * effectiveAttack) / effectiveDefense)
  const baseDamage = Math.floor(dividedByDefense / 50) + 2
  const weather = weatherMultiplier(context.weather, input.moveTypeId)
  if (weather !== 1) appliedBattleContextModifiers.push({ kind: 'weather', weather: context.weather as 'sun' | 'rain', multiplier: weather })
  if (context.criticalHit) appliedBattleContextModifiers.push({ kind: 'critical-hit', multiplier: 1.5 })
  const burnApplies = context.attackerBurned && input.moveCategory === 'physical'
  if (burnApplies) appliedBattleContextModifiers.push({ kind: 'burn', multiplier: 0.5 })
  const relevantScreen = input.moveCategory === 'physical'
    ? context.reflect ? 'reflect' as const : null
    : context.lightScreen ? 'light-screen' as const : null
  if (relevantScreen) {
    appliedBattleContextModifiers.push(context.criticalHit
      ? { kind: 'screen-bypassed', screen: relevantScreen, reason: 'critical-hit' }
      : { kind: 'screen', screen: relevantScreen, multiplier: 0.5 })
  }
  const lifeOrbEffect = itemEffect(input.attackerItem, 'final-damage-multiplier')
  const expertBeltEffect = typeMultiplier > 1 ? itemEffect(input.attackerItem, 'super-effective-damage-multiplier') : undefined
  const finalItemEffect = lifeOrbEffect ?? expertBeltEffect
  const defensiveFinalEffect = defensiveAdjustment.appliedEffects.some(item => item.effect.kind === 'super-effective-damage-multiplier')
  const rolls = Array.from({ length: 16 }, (_, index) => index + 85).map(randomRoll => {
    if (defensiveAdjustment.adjustedMultiplier === 0) return 0
    let damage = weather === 1 ? baseDamage : applyFixedPointModifier(baseDamage, weather === 1.5 ? 3 : 1, 2)
    if (context.criticalHit) damage = Math.floor((damage * 3) / 2)
    damage = Math.floor((damage * randomRoll) / 100)
    if (stabMultiplier === 1.5) damage = applyFixedPointModifier(damage, 3, 2)
    if (stabMultiplier === 2) damage = applyFixedPointModifier(damage, 2, 1)
    if (stabMultiplier === 2.25) damage = applyFixedPointModifier(damage, 9, 4)
    damage = applyTypeMultiplier(damage, typeMultiplier)
    if (burnApplies) damage = applyFixedPointModifier(damage, 1, 2)
    let finalModifier = 4096
    if (relevantScreen && !context.criticalHit) finalModifier = chainFixedPointModifier(finalModifier, 1, 2)
    if (defensiveFinalEffect) finalModifier = chainFixedPointModifier(finalModifier, 3, 4)
    if (finalItemEffect) finalModifier = chainFixedPointModifier(finalModifier, finalItemEffect.numerator, finalItemEffect.denominator)
    if (finalModifier !== 4096) damage = applyFixedPointModifier(damage, finalModifier, 4096)
    return Math.max(1, damage)
  })
  if (finalItemEffect && input.attackerItem) appliedItemEffects.push({ itemId: input.attackerItem.itemId, effect: finalItemEffect })
  return {
    minDamage: Math.min(...rolls),
    maxDamage: Math.max(...rolls),
    rolls,
    typeMultiplier,
    abilityAdjustedTypeMultiplier: defensiveAdjustment.adjustedMultiplier,
    stabMultiplier,
    stabResolution,
    modifiers: ['random-85-to-100', ...(stabMultiplier > 1 ? ['stab' as const] : []), 'type-effectiveness'],
    appliedAbilityEffects,
    unmodeledAbilityIds,
    effectiveAttack,
    effectiveDefense,
    appliedBattleContextModifiers,
    attackerGrounded,
    defenderGrounded,
    appliedTerrainEffects,
    effectiveBasePower,
    appliedItemEffects,
    unmodeledItemIds: input.attackerItem?.mechanics.status === 'unsupported' ? [input.attackerItem.itemId] : [],
    effectiveAttackerTypeIds,
    effectiveDefenderTypeIds,
    teraBasePowerFloorApplied: teraBasePower.floorApplied,
  }
}

export function calculateMoveDamage(input: MoveDamageInput): MoveDamageResult {
  if (input.move.damageSupport.status !== 'supported') return input.move.damageSupport
  if (input.move.category === 'status') return { status: 'non-damaging' }
  if (input.move.power.kind !== 'numeric') return { status: 'incomplete', reason: 'unknown-or-incomplete-mechanics' }
  const context = input.battleContext ?? DEFAULT_BATTLE_CONTEXT
  validateBattleContext(context)
  const attackerTerastallization = input.attackerTerastallization ?? INACTIVE_TERASTALLIZATION
  const defenderTerastallization = input.defenderTerastallization ?? INACTIVE_TERASTALLIZATION
  validateTerastallizationState(attackerTerastallization)
  validateTerastallizationState(defenderTerastallization)
  if (context.attackerBurned && input.attackerAbility?.abilityId === 'ability:0062') return { status: 'unsupported-context', reason: 'burn-with-guts' }
  if (context.weather === 'sun' && input.move.moveId === 'move:0876') return { status: 'unsupported-context', reason: 'sun-with-hydro-steam' }
  const physical = input.move.category === 'physical'
  const attackingStat = physical ? 'atk' : 'spa'
  const defendingStat = physical ? 'def' : 'spd'
  const attack = input.attackerStats[attackingStat]
  const defense = input.defenderStats[defendingStat]
  return {
    status: 'supported', attackingStat, defendingStat, attack, defense,
    ...calculateCoreDamage({
      level: input.level,
      attack,
      defense,
      basePower: input.move.power.value,
      moveTypeId: input.move.typeId,
      attackerTypeIds: input.attackerTypeIds,
      defenderTypeIds: input.defenderTypeIds,
      types: input.types,
      attackerAbility: input.attackerAbility,
      defenderAbility: input.defenderAbility,
      attackerItem: input.attackerItem,
      moveCategory: input.move.category,
      battleContext: context,
      attackerTerastallization,
      defenderTerastallization,
      movePriority: input.move.priority,
    }),
  }
}
