import type { RuntimeItemMechanics, RuntimeItemMechanicsEffect } from '../../src/lib/runtime-data/types.ts'
import { parseItemRecord, type RegistryEntity } from './source.ts'

export type CanonicalItemRecord = {
  itemId: string
  officialNumber: number
  showdownId: string
  canonicalName: { en: string }
  availability: 'current' | 'past' | 'future'
  sourceEvidence: { sourceReferenceId: string; pointer: string }
}

export type ItemMechanicsRecord = { itemId: string; mechanics: RuntimeItemMechanics }

export type ItemMechanicsReport = {
  sourceRecords: number
  registeredItems: number
  excludedNonPositiveNumberRecords: number
  excludedDuplicateNumberAliases: number
  supportedMechanicsItems: number
  unsupportedItems: number
  supportedEffectCategories: Record<RuntimeItemMechanicsEffect['kind'], number>
  availability: Record<'current' | 'past' | 'future', number>
  explicitUnsupportedCategories: Array<{ category: string; examples: string[]; reason: string }>
}

const SUPPORTED: Record<string, { canonicalName: string; effects: RuntimeItemMechanicsEffect[] }> = {
  'item:0220': { canonicalName: 'Choice Band', effects: [{ kind: 'attack-stat-multiplier', numerator: 3, denominator: 2, unmodeledDrawback: 'move-lock' }] },
  'item:0243': { canonicalName: 'Mystic Water', effects: [{ kind: 'move-type-base-power-multiplier', typeId: 'type:water', numerator: 4915, denominator: 4096 }] },
  'item:0249': { canonicalName: 'Charcoal', effects: [{ kind: 'move-type-base-power-multiplier', typeId: 'type:fire', numerator: 4915, denominator: 4096 }] },
  'item:0268': { canonicalName: 'Expert Belt', effects: [{ kind: 'super-effective-damage-multiplier', numerator: 4915, denominator: 4096 }] },
  'item:0270': { canonicalName: 'Life Orb', effects: [{ kind: 'final-damage-multiplier', numerator: 5324, denominator: 4096, unmodeledDrawback: 'recoil' }] },
  'item:0297': { canonicalName: 'Choice Specs', effects: [{ kind: 'special-attack-stat-multiplier', numerator: 3, denominator: 2, unmodeledDrawback: 'move-lock' }] },
}

const PREFERRED_DUPLICATE_NUMBER_SHOWDOWN_IDS = new Map<number, string>([
  [149, 'cheriberry'], [150, 'chestoberry'], [151, 'pechaberry'], [152, 'rawstberry'], [153, 'aspearberry'],
  [154, 'leppaberry'], [155, 'oranberry'], [156, 'persimberry'], [157, 'lumberry'], [158, 'sitrusberry'],
  [251, 'silkscarf'], [259, 'leek'],
])

function itemId(number: number): string {
  return `item:${number.toString().padStart(4, '0')}`
}

function availability(isNonstandard: string | undefined): CanonicalItemRecord['availability'] {
  return isNonstandard === 'Future' ? 'future' : isNonstandard ? 'past' : 'current'
}

export function itemRegistryEntities(rawItems: Record<string, unknown>, commit: string): RegistryEntity[] {
  const entries = Object.entries(rawItems).flatMap(([showdownId, value]) => {
    const raw = parseItemRecord(value, showdownId)
    if (raw.num <= 0) return []
    const preferred = PREFERRED_DUPLICATE_NUMBER_SHOWDOWN_IDS.get(raw.num)
    if (preferred && preferred !== showdownId) return []
    return [{
      kind: 'item' as const,
      projectId: itemId(raw.num),
      anchor: { officialNumber: raw.num },
      showdownId,
      status: 'active' as const,
      firstSeen: commit,
      lastSeen: commit,
    }]
  }).sort((left, right) => left.projectId.localeCompare(right.projectId, 'en'))
  if (new Set(entries.map(entry => entry.projectId)).size !== entries.length) throw new Error('ITEM_REGISTRY_DUPLICATE_OFFICIAL_NUMBER')
  return entries
}

export function buildItemArtifacts(
  rawItems: Record<string, unknown>,
  registry: RegistryEntity[],
  sourceReferenceId: string,
): { items: CanonicalItemRecord[]; mechanics: ItemMechanicsRecord[]; report: ItemMechanicsReport } {
  const registryItems = registry.filter(entry => entry.kind === 'item')
  const registryByShowdownId = new Map(registryItems.map(entry => [entry.showdownId, entry]))
  const positiveSourceRows = Object.entries(rawItems).flatMap(([showdownId, value]) => {
    const raw = parseItemRecord(value, showdownId)
    const preferred = PREFERRED_DUPLICATE_NUMBER_SHOWDOWN_IDS.get(raw.num)
    return raw.num > 0 && (!preferred || preferred === showdownId) ? [{ showdownId, raw }] : []
  })
  if (positiveSourceRows.length !== registryItems.length) throw new Error('ITEM_REGISTRY_COVERAGE')

  const items = positiveSourceRows.map(({ showdownId, raw }) => {
    const registryEntry = registryByShowdownId.get(showdownId)
    if (!registryEntry || registryEntry.projectId !== itemId(raw.num) || registryEntry.anchor.officialNumber !== raw.num) throw new Error(`ITEM_REGISTRY_IDENTITY: ${showdownId}`)
    return {
      itemId: registryEntry.projectId,
      officialNumber: raw.num,
      showdownId,
      canonicalName: { en: raw.name },
      availability: availability(raw.isNonstandard),
      sourceEvidence: { sourceReferenceId, pointer: `/${showdownId}` },
    }
  }).sort((left, right) => left.itemId.localeCompare(right.itemId, 'en'))

  const mechanics = items.map(item => {
    const supported = SUPPORTED[item.itemId]
    if (supported && supported.canonicalName !== item.canonicalName.en) throw new Error(`ITEM_MECHANICS_IDENTITY_MISMATCH: ${item.itemId}`)
    return { itemId: item.itemId, mechanics: supported ? { status: 'supported' as const, effects: supported.effects } : { status: 'unsupported' as const } }
  })
  const supported = mechanics.filter(record => record.mechanics.status === 'supported')
  const effectKinds: RuntimeItemMechanicsEffect['kind'][] = ['attack-stat-multiplier', 'special-attack-stat-multiplier', 'final-damage-multiplier', 'move-type-base-power-multiplier', 'super-effective-damage-multiplier']
  const availabilityCounts = (kind: CanonicalItemRecord['availability']): number => items.filter(item => item.availability === kind).length
  return {
    items,
    mechanics,
    report: {
      sourceRecords: Object.keys(rawItems).length,
      registeredItems: items.length,
      excludedNonPositiveNumberRecords: Object.entries(rawItems).filter(([showdownId, value]) => parseItemRecord(value, showdownId).num <= 0).length,
      excludedDuplicateNumberAliases: 13,
      supportedMechanicsItems: supported.length,
      unsupportedItems: items.length - supported.length,
      supportedEffectCategories: Object.fromEntries(effectKinds.map(kind => [kind, supported.filter(record => record.mechanics.status === 'supported' && record.mechanics.effects.some(effect => effect.kind === kind)).length])) as ItemMechanicsReport['supportedEffectCategories'],
      availability: { current: availabilityCounts('current'), past: availabilityCounts('past'), future: availabilityCounts('future') },
      explicitUnsupportedCategories: [
        { category: 'consumable', examples: ['Gems', 'Berries'], reason: 'Requires consumption and battle-history state.' },
        { category: 'survival-or-recovery', examples: ['Focus Sash', 'Leftovers'], reason: 'Requires HP transition, recovery, or turn state.' },
        { category: 'species-or-move-state', examples: ['Light Ball', 'Knock Off interactions'], reason: 'Requires species restrictions or mutable held-item state outside the current inputs.' },
        { category: 'turn-or-switch-state', examples: ['Choice Scarf', 'Heavy-Duty Boots'], reason: 'Requires turn order, switching, or field hazards.' },
      ],
    },
  }
}
