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
  mechanics: RuntimeAbilityMechanics
}

export type RuntimeAbilityMechanicsEffect =
  | { kind: 'incoming-type-immunity'; typeId: string }
  | { kind: 'incoming-type-attack-multiplier'; typeIds: string[]; multiplier: 0.5 }
  | { kind: 'super-effective-damage-multiplier'; multiplier: 0.75 }
  | { kind: 'stab-multiplier'; multiplier: 2 }

export type RuntimeAbilityMechanics =
  | { status: 'supported'; effects: RuntimeAbilityMechanicsEffect[] }
  | { status: 'unsupported' }

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
  damageSupport: RuntimeMoveDamageSupport
}

export type RuntimeMoveDamageUnsupportedReason =
  | 'non-numeric-base-power'
  | 'variable-base-power'
  | 'fixed-or-counter-damage'
  | 'ohko'
  | 'multi-hit'
  | 'spread-target'
  | 'max-or-z-move'
  | 'nonstandard-stat-selection'
  | 'nonstandard-type-effectiveness'
  | 'dynamic-move-type'
  | 'dynamic-move-mechanics'
  | 'forced-critical-hit'
  | 'damage-cap'
  | 'conditional-immunity'
  | 'conditional-hit-mechanics'

export type RuntimeMoveDamageSupport =
  | { status: 'supported' }
  | { status: 'non-damaging' }
  | { status: 'unsupported'; reason: RuntimeMoveDamageUnsupportedReason }
  | { status: 'incomplete'; reason: 'unknown-or-incomplete-mechanics' }

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
