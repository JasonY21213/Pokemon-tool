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
  growthRate: RuntimeGrowthRateResolution
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
  growthRateOverride: RuntimeGrowthRateResolution | null
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

export type RuntimeGrowthRateResolution = {
  id: string | null
  status: 'resolved' | 'unresolved'
}

export type RuntimeGrowthRate = {
  growthRateId: string
  canonicalName: string
  level100Total: number
  totalExpByLevel: number[]
}

export type RuntimeNumericValue =
  | { kind: 'numeric'; value: number }
  | { kind: 'not-applicable' }
  | { kind: 'unknown' }

export type RuntimeAccuracy =
  | { kind: 'percent'; value: number }
  | { kind: 'always' }
  | { kind: 'unknown' }

export type RuntimeMove = {
  moveId: string
  canonicalName: string
  zhName: string | null
  zhDescription: string | null
  typeId: string
  category: 'physical' | 'special' | 'status'
  power: RuntimeNumericValue
  accuracy: RuntimeAccuracy
  pp: RuntimeNumericValue
  priority: number
}

export type RuntimeEvolution = {
  evolutionId: string
  sourceFormId: string
  targetFormId: string
  method: string | null
  level: number | null
  item: string | null
  rawCondition: string | null
  dataStatus: 'complete' | 'partial'
}

export type RuntimeLearnsetEntry = {
  entityId: string
  parentEntityId: string | null
  directMoveIds: string[]
}

export type RuntimeLearnsets = {
  scope: 'pinned-showdown-known-association-across-generations'
  entries: RuntimeLearnsetEntry[]
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
  growthRates: RuntimeGrowthRate[]
  moves: RuntimeMove[]
  evolutions: RuntimeEvolution[]
  learnsets: RuntimeLearnsets
  manifest: RuntimeManifest
}
