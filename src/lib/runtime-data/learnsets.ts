import type { RuntimeLearnsets } from './types.ts'

export function resolveEffectiveLearnsetMoveIds(learnsets: RuntimeLearnsets, entityId: string): string[] {
  const byEntity = new Map(learnsets.entries.map(entry => [entry.entityId, entry]))
  const moveIds = new Set<string>()
  const seen = new Set<string>()
  let current: string | null = entityId
  while (current) {
    if (seen.has(current)) throw new Error(`RUNTIME_LEARNSET_INHERITANCE_CYCLE: ${entityId}`)
    seen.add(current)
    const entry = byEntity.get(current)
    if (!entry) throw new Error(`RUNTIME_LEARNSET_ENTITY_MISSING: ${current}`)
    for (const moveId of entry.directMoveIds) moveIds.add(moveId)
    current = entry.parentEntityId
  }
  return [...moveIds].sort((left, right) => left.localeCompare(right, 'en'))
}
