export const STANDARD_TERA_TYPE_IDS = [
  'type:bug', 'type:dark', 'type:dragon', 'type:electric', 'type:fairy', 'type:fighting',
  'type:fire', 'type:flying', 'type:ghost', 'type:grass', 'type:ground', 'type:ice',
  'type:normal', 'type:poison', 'type:psychic', 'type:rock', 'type:steel', 'type:water',
] as const

export type StandardTeraTypeId = (typeof STANDARD_TERA_TYPE_IDS)[number]
export type TeraSelection = '' | StandardTeraTypeId | 'stellar'

export type TerastallizationState =
  | { kind: 'none' }
  | { kind: 'ordinary'; typeId: StandardTeraTypeId }
  | { kind: 'stellar' }

export type StellarBoostUsageState = 'unknown' | 'available' | 'consumed'

export const INACTIVE_TERASTALLIZATION: Readonly<TerastallizationState> = { kind: 'none' }

type ResolvedStabBasis =
  | 'none' | 'original-type' | 'tera-type' | 'same-type-tera'
  | 'stellar-original-available' | 'stellar-original-consumed'
  | 'stellar-non-original-available' | 'stellar-non-original-consumed'

export type ResolvedStab =
  | {
      status: 'resolved'
      multiplier: 1 | 1.2 | 1.5 | 2 | 2.25
      numerator: 1 | 2 | 3 | 9 | 4915
      denominator: 1 | 2 | 4 | 4096
      basis: ResolvedStabBasis
      adaptabilityApplied: boolean
      stellarBoostStateRequired: false
    }
  | {
      status: 'unresolved'
      multiplier: null
      numerator: null
      denominator: null
      basis: 'stellar-usage-unknown'
      adaptabilityApplied: false
      stellarBoostStateRequired: true
    }

export function validateTerastallizationState(state: TerastallizationState): void {
  const keys = Object.keys(state).sort()
  if ((state.kind === 'none' || state.kind === 'stellar') && keys.length === 1 && keys[0] === 'kind') return
  if (state.kind === 'ordinary' && keys.join(',') === 'kind,typeId' && STANDARD_TERA_TYPE_IDS.includes(state.typeId)) return
  throw new Error('TERASTALLIZATION_INVALID_STATE')
}

export function effectiveTypeIds(originalTypeIds: readonly string[], state: TerastallizationState): string[] {
  validateTerastallizationState(state)
  return state.kind === 'ordinary' ? [state.typeId] : [...originalTypeIds]
}

function resolved(
  multiplier: 1 | 1.2 | 1.5 | 2 | 2.25,
  numerator: 1 | 2 | 3 | 9 | 4915,
  denominator: 1 | 2 | 4 | 4096,
  basis: ResolvedStabBasis,
  adaptabilityApplied = false,
): ResolvedStab {
  return { status: 'resolved', multiplier, numerator, denominator, basis, adaptabilityApplied, stellarBoostStateRequired: false }
}

// Mirrors pinned Showdown Gen 9 STAB resolution. Stellar retains original
// defensive types, uses an explicit per-move-type usage state, and bypasses
// ModifySTAB events such as Adaptability.
export function resolveStab(
  originalTypeIds: readonly string[],
  state: TerastallizationState,
  moveTypeId: string,
  adaptability: boolean,
  stellarBoostUsage: StellarBoostUsageState = 'unknown',
): ResolvedStab {
  validateTerastallizationState(state)
  const matchesOriginal = originalTypeIds.includes(moveTypeId)

  if (state.kind === 'stellar') {
    if (stellarBoostUsage === 'unknown') {
      return { status: 'unresolved', multiplier: null, numerator: null, denominator: null, basis: 'stellar-usage-unknown', adaptabilityApplied: false, stellarBoostStateRequired: true }
    }
    if (stellarBoostUsage === 'available') {
      return matchesOriginal
        ? resolved(2, 2, 1, 'stellar-original-available')
        : resolved(1.2, 4915, 4096, 'stellar-non-original-available')
    }
    return matchesOriginal
      ? resolved(1.5, 3, 2, 'stellar-original-consumed')
      : resolved(1, 1, 1, 'stellar-non-original-consumed')
  }

  const matchesTera = state.kind === 'ordinary' && state.typeId === moveTypeId
  if (matchesOriginal && matchesTera) return adaptability ? resolved(2.25, 9, 4, 'same-type-tera', true) : resolved(2, 2, 1, 'same-type-tera')
  if (matchesTera) return adaptability ? resolved(2, 2, 1, 'tera-type', true) : resolved(1.5, 3, 2, 'tera-type')
  if (matchesOriginal) {
    const adaptabilityApplied = adaptability && state.kind === 'none'
    return adaptabilityApplied ? resolved(2, 2, 1, 'original-type', true) : resolved(1.5, 3, 2, 'original-type')
  }
  return resolved(1, 1, 1, 'none')
}

export function resolveOrdinaryTeraBasePower(
  basePower: number,
  moveTypeId: string,
  priority: number,
  state: TerastallizationState,
): { basePower: number; floorApplied: boolean } {
  validateTerastallizationState(state)
  const floorApplied = state.kind === 'ordinary' && state.typeId === moveTypeId && basePower < 60 && priority <= 0
  return { basePower: floorApplied ? 60 : basePower, floorApplied }
}
