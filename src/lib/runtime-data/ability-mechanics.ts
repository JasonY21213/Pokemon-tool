import type { DefensiveMatchup } from './type-matchup.ts'
import type { RuntimeAbility, RuntimeAbilityMechanicsEffect, RuntimeForm } from './types.js'

export type AbilityAdjustedMultiplier = 0 | 0.125 | 0.25 | 0.5 | 1 | 1.5 | 2 | 3 | 4
export type AppliedAbilityEffect = { abilityId: string; effect: RuntimeAbilityMechanicsEffect }
export type AbilityAdjustedMatchup = {
  attackingTypeId: string
  rawMultiplier: DefensiveMatchup['multiplier']
  adjustedMultiplier: AbilityAdjustedMultiplier
  appliedEffects: AppliedAbilityEffect[]
}

export function selectAbilityForForm(form: RuntimeForm, abilities: RuntimeAbility[], abilityId: string | null): RuntimeAbility | null {
  if (abilityId === null) return null
  if (!form.abilities.some(slot => slot.abilityId === abilityId)) throw new Error(`ABILITY_NOT_AVAILABLE_FOR_FORM: ${form.formId}:${abilityId}`)
  const ability = abilities.find(candidate => candidate.abilityId === abilityId)
  if (!ability) throw new Error(`ABILITY_RUNTIME_MISSING: ${abilityId}`)
  return ability
}

export function normalizeAbilityForForm(form: RuntimeForm, abilityId: string | null): string | null {
  return abilityId !== null && form.abilities.some(slot => slot.abilityId === abilityId) ? abilityId : null
}

export function adjustDefensiveMultiplier(
  entry: DefensiveMatchup,
  ability: RuntimeAbility | null,
): AbilityAdjustedMatchup {
  let adjusted: number = entry.multiplier
  const appliedEffects: AppliedAbilityEffect[] = []
  if (ability?.mechanics.status === 'supported') {
    for (const effect of ability.mechanics.effects) {
      if (effect.kind === 'incoming-type-immunity' && effect.typeId === entry.attackingTypeId) {
        adjusted = 0
        appliedEffects.push({ abilityId: ability.abilityId, effect })
      } else if (effect.kind === 'incoming-type-attack-multiplier' && effect.typeIds.includes(entry.attackingTypeId)) {
        adjusted *= effect.multiplier
        appliedEffects.push({ abilityId: ability.abilityId, effect })
      } else if (effect.kind === 'super-effective-damage-multiplier' && entry.multiplier > 1) {
        adjusted *= effect.multiplier
        appliedEffects.push({ abilityId: ability.abilityId, effect })
      }
    }
  }
  if (![0, 0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4].includes(adjusted)) throw new Error(`ABILITY_MATCHUP_UNEXPECTED_MULTIPLIER: ${adjusted}`)
  return { attackingTypeId: entry.attackingTypeId, rawMultiplier: entry.multiplier, adjustedMultiplier: adjusted as AbilityAdjustedMultiplier, appliedEffects }
}

export function adjustDefensiveMatchup(entries: DefensiveMatchup[], ability: RuntimeAbility | null): AbilityAdjustedMatchup[] {
  return entries.map(entry => adjustDefensiveMultiplier(entry, ability))
}
