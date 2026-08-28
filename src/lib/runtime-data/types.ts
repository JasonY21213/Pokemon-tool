export type RuntimeStatBlock = {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export type RuntimeAbilitySlot = {
  slot: '0' | '1' | 'H' | 'S'
  abilityId: string
}

export type RuntimeSpecies = {
  speciesId: string
  nationalDexNumber: number
  canonicalName: string
  zhName: string
  defaultFormId: string
  formIds: string[]
  tagIds: string[]
}

export type RuntimeForm = {
  formId: string
  speciesId: string
  canonicalName: string
  zhName: string | null
  types: string[]
  baseStats: RuntimeStatBlock
  abilities: RuntimeAbilitySlot[]
  tagIds: string[]
}

export type RuntimeAbility = {
  abilityId: string
  canonicalName: string
  zhName: string | null
  zhDescription: string | null
}

export type RuntimeTypeEffectiveness = 0 | 0.5 | 1 | 2

export type RuntimeType = {
  typeId: string
  canonicalName: string
  damageTaken: Array<{
    attackingTypeId: string
    multiplier: RuntimeTypeEffectiveness
  }>
}

export type RuntimeNature = {
  natureId: string
  canonicalName: string
  plusStat: 'atk' | 'def' | 'spa' | 'spd' | 'spe' | null
  minusStat: 'atk' | 'def' | 'spa' | 'spd' | 'spe' | null
  neutral: boolean
}

export type RuntimeManifestFile = {
  path: string
  sha256: string
  recordCount: number
}

export type RuntimeManifest = {
  schemaVersion: 1
  files: RuntimeManifestFile[]
}

export type PokemonRuntimeData = {
  species: RuntimeSpecies[]
  forms: RuntimeForm[]
  abilities: RuntimeAbility[]
  types: RuntimeType[]
  natures: RuntimeNature[]
  manifest: RuntimeManifest
}
