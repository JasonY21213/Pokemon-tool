import type { RuntimeAbilityMechanics, RuntimeAbilityMechanicsEffect } from '../../src/lib/runtime-data/types.ts'
import { parseAbilityRecord } from './source.ts'

export type AbilityMechanicsRecord = { abilityId: string; mechanics: RuntimeAbilityMechanics }
export type AbilityMechanicsReport = {
  totalAbilities: number
  supportedMechanicsAbilities: number
  unsupportedAbilities: number
  supportedEffectCategories: Record<RuntimeAbilityMechanicsEffect['kind'], number>
  auditCategorySignals: {
    typeImmunity: number
    typeResistanceOrDamageModifier: number
    stabModifier: number
    offensiveTypeModifier: number
    statModifier: number
    weatherOrTerrain: number
    statusDependent: number
    switchTurnEvent: number
    moveOrContactSpecific: number
  }
  explicitExclusions: Array<{ category: string; abilityNames: string[]; reason: string }>
}

type CanonicalAbility = Record<string, unknown>

const SUPPORTED: Record<string, { canonicalName: string; effects: RuntimeAbilityMechanicsEffect[] }> = {
  'ability:0026': { canonicalName: 'Levitate', effects: [{ kind: 'incoming-type-immunity', typeId: 'type:ground' }] },
  'ability:0047': { canonicalName: 'Thick Fat', effects: [{ kind: 'incoming-type-attack-multiplier', typeIds: ['type:fire', 'type:ice'], multiplier: 0.5 }] },
  'ability:0091': { canonicalName: 'Adaptability', effects: [{ kind: 'stab-multiplier', multiplier: 2 }] },
  'ability:0111': { canonicalName: 'Filter', effects: [{ kind: 'super-effective-damage-multiplier', multiplier: 0.75 }] },
  'ability:0116': { canonicalName: 'Solid Rock', effects: [{ kind: 'super-effective-damage-multiplier', multiplier: 0.75 }] },
  'ability:0232': { canonicalName: 'Prism Armor', effects: [{ kind: 'super-effective-damage-multiplier', multiplier: 0.75 }] },
}

function canonicalName(record: CanonicalAbility): string {
  const value = record.canonicalName
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).en !== 'string') throw new Error('ABILITY_MECHANICS_CANONICAL_NAME')
  return (value as Record<string, unknown>).en as string
}

function sourceText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${key} ${String(entry)}`).join(' ')
}

export function buildAbilityMechanicsArtifacts(
  abilities: CanonicalAbility[],
  showdownAbilities: Record<string, unknown>,
): { records: AbilityMechanicsRecord[]; report: AbilityMechanicsReport } {
  const sourceRows = Object.entries(showdownAbilities).map(([showdownId, value]) => ({
    showdownId,
    name: parseAbilityRecord(value, showdownId).name,
    text: sourceText(value),
  }))
  const sourceByName = new Map(sourceRows.map(row => [row.name, row]))
  const selectedRows = abilities.map(ability => {
    const name = canonicalName(ability)
    const row = sourceByName.get(name)
    if (!row) throw new Error(`ABILITY_MECHANICS_SOURCE_MISSING: ${name}`)
    return row
  })
  const records = abilities.map(ability => {
    const abilityId = String(ability.abilityId)
    const supported = SUPPORTED[abilityId]
    if (supported && supported.canonicalName !== canonicalName(ability)) throw new Error(`ABILITY_MECHANICS_IDENTITY_MISMATCH: ${abilityId}`)
    return { abilityId, mechanics: supported ? { status: 'supported' as const, effects: supported.effects } : { status: 'unsupported' as const } }
  }).sort((left, right) => left.abilityId.localeCompare(right.abilityId, 'en'))

  const count = (predicate: (row: (typeof selectedRows)[number]) => boolean): number => selectedRows.filter(predicate).length
  const supportedRecords = records.filter(record => record.mechanics.status === 'supported')
  const effectKinds = ['incoming-type-immunity', 'incoming-type-attack-multiplier', 'super-effective-damage-multiplier', 'stab-multiplier'] as const
  return {
    records,
    report: {
      totalAbilities: records.length,
      supportedMechanicsAbilities: supportedRecords.length,
      unsupportedAbilities: records.length - supportedRecords.length,
      supportedEffectCategories: Object.fromEntries(effectKinds.map(kind => [kind, supportedRecords.filter(record => record.mechanics.status === 'supported' && record.mechanics.effects.some(effect => effect.kind === kind)).length])) as AbilityMechanicsReport['supportedEffectCategories'],
      auditCategorySignals: {
        typeImmunity: count(row => row.showdownId === 'levitate' || (/onTryHit/.test(row.text) && /move\.type/.test(row.text) && /return null/.test(row.text))),
        typeResistanceOrDamageModifier: count(row => /onSourceModify(?:Damage|Atk|SpA)|onSourceBasePower/.test(row.text)),
        stabModifier: count(row => /onModifySTAB/.test(row.text)),
        offensiveTypeModifier: count(row => /on(?:BasePower|ModifyAtk|ModifySpA|ModifyDamage)/.test(row.text) && /move\.type/.test(row.text)),
        statModifier: count(row => /onModify(?:Atk|Def|SpA|SpD|Spe)|this\.boost/.test(row.text)),
        weatherOrTerrain: count(row => /Weather|Terrain|weather|terrain/.test(row.text)),
        statusDependent: count(row => /Status|status|brn|par|slp|psn|tox|frz/.test(row.text)),
        switchTurnEvent: count(row => /on(?:Start|SwitchIn|Residual|BeforeTurn|Update|End|Faint|AfterMove|BeforeMove)/.test(row.text)),
        moveOrContactSpecific: count(row => /on(?:TryHit|DamagingHit|AfterMoveSecondary|ModifyMove|RedirectTarget)|checkMoveMakesContact|move\.flags/.test(row.text)),
      },
      explicitExclusions: [
        { category: 'trigger-state-or-redirection', abilityNames: ['Flash Fire', 'Lightning Rod', 'Storm Drain'], reason: 'Requires triggered state, stat stages, or move redirection.' },
        { category: 'healing-weather-or-status', abilityNames: ['Dry Skin', 'Volt Absorb', 'Water Absorb', 'Heatproof'], reason: 'Relevant behavior includes healing, weather, or status damage outside this phase.' },
        { category: 'move-specific-or-contact', abilityNames: ['Soundproof', 'Bulletproof', 'Strong Jaw'], reason: 'Requires Move flags or contact-specific mechanics not present in the runtime Move model.' },
        { category: 'battle-state-systems', abilityNames: ['Drizzle', 'Electric Surge', 'Guts'], reason: 'Requires weather, terrain, status, or stat-stage state.' },
      ],
    },
  }
}
