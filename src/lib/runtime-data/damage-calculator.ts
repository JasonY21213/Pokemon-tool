import { calculateDefensiveMatchup, type DefensiveMatchup } from './type-matchup.ts'
import { adjustDefensiveMultiplier, type AbilityAdjustedMultiplier, type AppliedAbilityEffect } from './ability-mechanics.ts'
import type { RuntimeAbility, RuntimeMove, RuntimeMoveDamageUnsupportedReason, RuntimeStatBlock, RuntimeType } from './types.js'

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
}

export type DamageCoreResult = {
  minDamage: number
  maxDamage: number
  rolls: number[]
  typeMultiplier: DefensiveMatchup['multiplier']
  abilityAdjustedTypeMultiplier: AbilityAdjustedMultiplier
  stabMultiplier: 1 | 1.5 | 2
  modifiers: Array<'random-85-to-100' | 'stab' | 'type-effectiveness'>
  appliedAbilityEffects: AppliedAbilityEffect[]
  unmodeledAbilityIds: string[]
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
}

export type MoveDamageResult =
  | ({ status: 'supported'; attackingStat: 'atk' | 'spa'; defendingStat: 'def' | 'spd'; attack: number; defense: number } & DamageCoreResult)
  | { status: 'non-damaging' }
  | { status: 'unsupported'; reason: RuntimeMoveDamageUnsupportedReason }
  | { status: 'incomplete'; reason: 'unknown-or-incomplete-mechanics' }

function assertInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`DAMAGE_CALCULATOR_INVALID_${label}`)
}

// Mirrors the pinned Showdown Gen 9 fixed-point modifier rounding for ordinary STAB.
function applyFixedPointModifier(value: number, numerator: number, denominator: number): number {
  const modifier = Math.floor((numerator * 4096) / denominator)
  return Math.floor((value * modifier + 2047) / 4096)
}

function applyTypeMultiplier(value: number, multiplier: DefensiveMatchup['multiplier']): number {
  if (multiplier === 0) return 0
  if (multiplier === 4) return value * 4
  if (multiplier === 2) return value * 2
  if (multiplier === 1) return value
  if (multiplier === 0.5) return Math.floor(value / 2)
  return Math.floor(Math.floor(value / 2) / 2)
}

export function calculateCoreDamage(input: DamageCoreInput): DamageCoreResult {
  assertInteger(input.level, 1, 100, 'LEVEL')
  assertInteger(input.attack, 1, 9999, 'ATTACK')
  assertInteger(input.defense, 1, 9999, 'DEFENSE')
  assertInteger(input.basePower, 1, 9999, 'BASE_POWER')
  if (input.attackerTypeIds.length < 1 || input.attackerTypeIds.length > 2 || new Set(input.attackerTypeIds).size !== input.attackerTypeIds.length) throw new Error('DAMAGE_CALCULATOR_INVALID_ATTACKER_TYPES')
  if (input.defenderTypeIds.length < 1 || input.defenderTypeIds.length > 2 || new Set(input.defenderTypeIds).size !== input.defenderTypeIds.length) throw new Error('DAMAGE_CALCULATOR_INVALID_DEFENDER_TYPES')

  const matchup = calculateDefensiveMatchup(input.types, input.defenderTypeIds[0], input.defenderTypeIds[1])
  const typeMultiplier = matchup.find(entry => entry.attackingTypeId === input.moveTypeId)?.multiplier
  if (typeMultiplier === undefined) throw new Error(`DAMAGE_CALCULATOR_UNKNOWN_MOVE_TYPE: ${input.moveTypeId}`)
  const defensiveAdjustment = adjustDefensiveMultiplier({ attackingTypeId: input.moveTypeId, multiplier: typeMultiplier }, input.defenderAbility ?? null)
  const hasStab = input.attackerTypeIds.includes(input.moveTypeId)
  const stabEffect = input.attackerAbility?.mechanics.status === 'supported'
    ? input.attackerAbility.mechanics.effects.find(effect => effect.kind === 'stab-multiplier')
    : undefined
  const stabMultiplier: 1 | 1.5 | 2 = hasStab ? stabEffect?.kind === 'stab-multiplier' ? stabEffect.multiplier : 1.5 : 1
  const appliedAbilityEffects: AppliedAbilityEffect[] = [
    ...(hasStab && stabEffect ? [{ abilityId: input.attackerAbility!.abilityId, effect: stabEffect }] : []),
    ...defensiveAdjustment.appliedEffects,
  ]
  const unmodeledAbilityIds = [input.attackerAbility, input.defenderAbility]
    .filter((ability): ability is RuntimeAbility => ability?.mechanics.status === 'unsupported')
    .map(ability => ability.abilityId)

  const levelFactor = Math.floor((2 * input.level) / 5) + 2
  const incomingAttackEffect = defensiveAdjustment.appliedEffects.find(item => item.effect.kind === 'incoming-type-attack-multiplier')?.effect
  const modifiedAttack = incomingAttackEffect?.kind === 'incoming-type-attack-multiplier'
    ? applyFixedPointModifier(input.attack, 1, 2)
    : input.attack
  const dividedByDefense = Math.floor((levelFactor * input.basePower * modifiedAttack) / input.defense)
  const baseDamage = Math.floor(dividedByDefense / 50) + 2
  const rolls = Array.from({ length: 16 }, (_, index) => index + 85).map(randomRoll => {
    if (defensiveAdjustment.adjustedMultiplier === 0) return 0
    let damage = Math.floor((baseDamage * randomRoll) / 100)
    if (stabMultiplier === 1.5) damage = applyFixedPointModifier(damage, 3, 2)
    if (stabMultiplier === 2) damage = applyFixedPointModifier(damage, 2, 1)
    damage = applyTypeMultiplier(damage, typeMultiplier)
    if (defensiveAdjustment.appliedEffects.some(item => item.effect.kind === 'super-effective-damage-multiplier')) damage = applyFixedPointModifier(damage, 3, 4)
    return Math.max(1, damage)
  })
  return {
    minDamage: Math.min(...rolls),
    maxDamage: Math.max(...rolls),
    rolls,
    typeMultiplier,
    abilityAdjustedTypeMultiplier: defensiveAdjustment.adjustedMultiplier,
    stabMultiplier,
    modifiers: ['random-85-to-100', ...(stabMultiplier > 1 ? ['stab' as const] : []), 'type-effectiveness'],
    appliedAbilityEffects,
    unmodeledAbilityIds,
  }
}

export function calculateMoveDamage(input: MoveDamageInput): MoveDamageResult {
  if (input.move.damageSupport.status !== 'supported') return input.move.damageSupport
  if (input.move.category === 'status') return { status: 'non-damaging' }
  if (input.move.power.kind !== 'numeric') return { status: 'incomplete', reason: 'unknown-or-incomplete-mechanics' }
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
    }),
  }
}
