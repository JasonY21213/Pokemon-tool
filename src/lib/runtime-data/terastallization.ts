export const STANDARD_TERA_TYPE_IDS = [
  'type:bug', 'type:dark', 'type:dragon', 'type:electric', 'type:fairy', 'type:fighting',
  'type:fire', 'type:flying', 'type:ghost', 'type:grass', 'type:ground', 'type:ice',
  'type:normal', 'type:poison', 'type:psychic', 'type:rock', 'type:steel', 'type:water',
] as const

export type StandardTeraTypeId = (typeof STANDARD_TERA_TYPE_IDS)[number]

export type TerastallizationState =
  | { active: false; teraType: null }
  | { active: true; teraType: StandardTeraTypeId }

export const INACTIVE_TERASTALLIZATION: Readonly<TerastallizationState> = { active: false, teraType: null }

export type ResolvedStab = {
  multiplier: 1 | 1.5 | 2 | 2.25
  basis: 'none' | 'original-type' | 'tera-type' | 'same-type-tera'
  adaptabilityApplied: boolean
}

export function validateTerastallizationState(state: TerastallizationState): void {
  if (state.active === false) {
    if (state.teraType !== null) throw new Error('TERASTALLIZATION_INACTIVE_WITH_TYPE')
    return
  }
  if (!STANDARD_TERA_TYPE_IDS.includes(state.teraType)) throw new Error('TERASTALLIZATION_INVALID_TYPE')
}

export function effectiveTypeIds(originalTypeIds: readonly string[], state: TerastallizationState): string[] {
  validateTerastallizationState(state)
  return state.active ? [state.teraType] : [...originalTypeIds]
}

// Mirrors pinned Showdown's ordinary Gen 9 STAB resolution. Original types
// remain STAB history, while Adaptability checks the current post-Tera type.
export function resolveStab(
  originalTypeIds: readonly string[],
  state: TerastallizationState,
  moveTypeId: string,
  adaptability: boolean,
): ResolvedStab {
  validateTerastallizationState(state)
  const matchesOriginal = originalTypeIds.includes(moveTypeId)
  const matchesTera = state.active && state.teraType === moveTypeId
  if (matchesOriginal && matchesTera) return { multiplier: adaptability ? 2.25 : 2, basis: 'same-type-tera', adaptabilityApplied: adaptability }
  if (matchesTera) return { multiplier: adaptability ? 2 : 1.5, basis: 'tera-type', adaptabilityApplied: adaptability }
  if (matchesOriginal) {
    const adaptabilityApplied = adaptability && !state.active
    return { multiplier: adaptabilityApplied ? 2 : 1.5, basis: 'original-type', adaptabilityApplied }
  }
  return { multiplier: 1, basis: 'none', adaptabilityApplied: false }
}

export function resolveOrdinaryTeraBasePower(
  basePower: number,
  moveTypeId: string,
  priority: number,
  state: TerastallizationState,
): { basePower: number; floorApplied: boolean } {
  validateTerastallizationState(state)
  const floorApplied = state.active && state.teraType === moveTypeId && basePower < 60 && priority <= 0
  return { basePower: floorApplied ? 60 : basePower, floorApplied }
}
