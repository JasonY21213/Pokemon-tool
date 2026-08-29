import { selectAbilityForForm } from './ability-mechanics.ts'
import { validateBattleContext, type BattleContext } from './battle-context.ts'
import { calculateStats } from './stat-calculator.ts'
import { STANDARD_TERA_TYPE_IDS, type TeraSelection, type TerastallizationState } from './terastallization.ts'
import type { PokemonRuntimeData, RuntimeAbility, RuntimeForm, RuntimeItem, RuntimeNature, RuntimeSpecies, RuntimeStatBlock } from './types.js'

export type CombatantConfiguration = {
  speciesId: string
  formId: string
  level: number
  natureId: string
  ivs: RuntimeStatBlock
  evs: RuntimeStatBlock
  abilityId: string | null
  teraTypeId: TeraSelection
}

export type ResolvedCombatantConfiguration = {
  species: RuntimeSpecies
  form: RuntimeForm
  nature: RuntimeNature
  ability: RuntimeAbility | null
  stats: RuntimeStatBlock
  terastallization: TerastallizationState
}

type CombatantReferenceData = Pick<PokemonRuntimeData, 'species' | 'forms' | 'natures' | 'abilities'>

export function terastallizationState(teraTypeId: TeraSelection): TerastallizationState {
  if (teraTypeId === '') return { kind: 'none' }
  if (teraTypeId === 'stellar') return { kind: 'stellar' }
  if (!STANDARD_TERA_TYPE_IDS.includes(teraTypeId)) throw new Error(`DAMAGE_STATE_INVALID_TERA_TYPE: ${teraTypeId}`)
  return { kind: 'ordinary', typeId: teraTypeId }
}

export function resolveCombatantConfiguration(data: CombatantReferenceData, configuration: CombatantConfiguration): ResolvedCombatantConfiguration {
  const species = data.species.find(candidate => candidate.speciesId === configuration.speciesId)
  const form = data.forms.find(candidate => candidate.formId === configuration.formId)
  const nature = data.natures.find(candidate => candidate.natureId === configuration.natureId)
  if (!species || !form || !nature || !species.formIds.includes(form.formId)) throw new Error('DAMAGE_STATE_INVALID_COMBATANT_SELECTION')
  const ability = selectAbilityForForm(form, data.abilities, configuration.abilityId)
  return {
    species,
    form,
    nature,
    ability,
    stats: calculateStats({ speciesId: species.speciesId, baseStats: form.baseStats, level: configuration.level, nature, ivs: configuration.ivs, evs: configuration.evs }),
    terastallization: terastallizationState(configuration.teraTypeId),
  }
}

export function resolveAttackerItem(data: Pick<PokemonRuntimeData, 'items'>, itemId: string | null): RuntimeItem | null {
  if (itemId === null) return null
  const item = data.items.find(candidate => candidate.itemId === itemId)
  if (!item) throw new Error(`DAMAGE_STATE_INVALID_ITEM: ${itemId}`)
  return item
}

export function validateDamageCalculatorContext(context: BattleContext): void {
  validateBattleContext(context)
}
