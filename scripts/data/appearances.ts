import {
  AppearanceLocalizationEntrySchema,
  AppearanceMatchSchema,
  AppearanceSchema,
  IdentityMatchSchema,
  ValueProvenanceSchema,
  type Appearance,
  type AppearanceLocalizationEntry,
  type AppearanceMatch,
  type IdentityMatch,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import type { PokemonDatasetZhAdapterOutput, ZhAppearanceCandidate } from './pokemon-dataset-zh.ts'
import { parsePokedexRecord, type RegistryEntity, type ShowdownSourceData, type VerifiedSource } from './source.ts'

interface GlyphDefinition {
  token: string
  sourceLabel: string
  shortLabel: string
  showdownName: string
}

interface CreamDefinition {
  token: string
  labelZh: string
  showdownName: string
}

interface SweetDefinition {
  token: string
  labelZh: string
}

export interface AppearanceConflict {
  code: string
  severity: 'warning' | 'error'
  message: string
}

export interface AppearanceBuildResult {
  appearances: Appearance[]
  localizationEntries: AppearanceLocalizationEntry[]
  identityMatches: IdentityMatch[]
  appearanceMatches: AppearanceMatch[]
  valueProvenance: ValueProvenance[]
  mappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
  conflicts: AppearanceConflict[]
  sourceCoverage: {
    unownHomeImages: number
    showdownUnownGlyphs: number
    alcremieHomeImages: number
    alcremieCombinations: number
    alcremieExcludedCoverageRecords: number
    showdownAlcremieCreams: number
  }
}

const UNOWN_GLYPHS: GlyphDefinition[] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map(token => ({
    token,
    sourceLabel: token.toUpperCase(),
    shortLabel: token.toUpperCase(),
    showdownName: token === 'a' ? 'Unown' : `Unown-${token.toUpperCase()}`,
  })),
  { token: 'exclamation', sourceLabel: '!', shortLabel: '!', showdownName: 'Unown-Exclamation' },
  { token: 'question', sourceLabel: '？', shortLabel: '?', showdownName: 'Unown-Question' },
]

const ALCREMIE_CREAMS: CreamDefinition[] = [
  { token: 'vanilla-cream', labelZh: '奶香香草', showdownName: 'Alcremie' },
  { token: 'ruby-cream', labelZh: '奶香红钻', showdownName: 'Alcremie-Ruby-Cream' },
  { token: 'matcha-cream', labelZh: '奶香抹茶', showdownName: 'Alcremie-Matcha-Cream' },
  { token: 'mint-cream', labelZh: '奶香薄荷', showdownName: 'Alcremie-Mint-Cream' },
  { token: 'lemon-cream', labelZh: '奶香柠檬', showdownName: 'Alcremie-Lemon-Cream' },
  { token: 'salted-cream', labelZh: '奶香雪盐', showdownName: 'Alcremie-Salted-Cream' },
  { token: 'ruby-swirl', labelZh: '红钻综合', showdownName: 'Alcremie-Ruby-Swirl' },
  { token: 'caramel-swirl', labelZh: '焦糖综合', showdownName: 'Alcremie-Caramel-Swirl' },
  { token: 'rainbow-swirl', labelZh: '三色综合', showdownName: 'Alcremie-Rainbow-Swirl' },
]

const ALCREMIE_SWEETS: SweetDefinition[] = [
  { token: 'strawberry-sweet', labelZh: '草莓糖饰' },
  { token: 'love-sweet', labelZh: '爱心糖饰' },
  { token: 'berry-sweet', labelZh: '野莓糖饰' },
  { token: 'clover-sweet', labelZh: '幸运草糖饰' },
  { token: 'flower-sweet', labelZh: '花朵糖饰' },
  { token: 'star-sweet', labelZh: '星星糖饰' },
  { token: 'ribbon-sweet', labelZh: '蝴蝶结糖饰' },
]

export const ALCREMIE_PROOF_APPEARANCE_IDS = [
  'appearance:0869:vanilla-cream:strawberry-sweet',
  'appearance:0869:ruby-cream:strawberry-sweet',
  'appearance:0869:matcha-cream:strawberry-sweet',
] as const

export function stableAppearanceId(nationalDexNumber: number, aspectTokens: string[]): string {
  if (!Number.isInteger(nationalDexNumber) || nationalDexNumber <= 0 || nationalDexNumber > 9999) {
    throw new Error(`INVALID_APPEARANCE_SPECIES_NUMBER: ${nationalDexNumber}`)
  }
  if (aspectTokens.length === 0 || aspectTokens.some(token => !/^[a-z0-9-]+$/.test(token))) {
    throw new Error('INVALID_APPEARANCE_ASPECT_TOKEN')
  }
  return `appearance:${nationalDexNumber.toString().padStart(4, '0')}:${aspectTokens.join(':')}`
}

function showdownId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function registryEntry(source: VerifiedSource, projectId: string): RegistryEntity {
  const matches = source.registry.filter(entity => entity.kind === 'appearance' && entity.projectId === projectId)
  if (matches.length !== 1) throw new Error(`APPEARANCE_REGISTRY_CONFLICT: ${projectId} matched ${matches.length} entries`)
  return matches[0]
}

function reference(source: VerifiedSource, path: string): string {
  const sourceReference = path === 'data/pokedex.ts'
    ? source.sourceReferenceByPath.get(path)
    : source.localization.sourceReferenceByPath.get(path)
  if (!sourceReference) throw new Error(`APPEARANCE_SOURCE_REFERENCE_MISSING: ${path}`)
  return sourceReference.sourceReferenceId
}

function uniqueCandidate(candidates: ZhAppearanceCandidate[], nameZh: string): ZhAppearanceCandidate {
  const matches = candidates.filter(candidate => candidate.nameZh === nameZh)
  if (matches.length !== 1) throw new Error(`APPEARANCE_ZH_EVIDENCE_CONFLICT: ${nameZh} matched ${matches.length} records`)
  return matches[0]
}

function validateShowdownCoverage(data: ShowdownSourceData): void {
  const unown = parsePokedexRecord(data.pokedex.unown, 'unown')
  const unownNames = [unown.name, ...(unown.cosmeticFormes ?? [])]
  const expectedUnown = UNOWN_GLYPHS.map(definition => definition.showdownName)
  if (unown.baseForme !== 'A' || JSON.stringify(unownNames) !== JSON.stringify(expectedUnown)) {
    throw new Error('UNOWN_COSMETIC_COVERAGE_CONFLICT')
  }

  const alcremie = parsePokedexRecord(data.pokedex.alcremie, 'alcremie')
  const alcremieNames = [alcremie.name, ...(alcremie.cosmeticFormes ?? [])]
  const expectedAlcremie = ALCREMIE_CREAMS.map(definition => definition.showdownName)
  if (alcremie.baseForme !== 'Vanilla-Cream' || JSON.stringify(alcremieNames) !== JSON.stringify(expectedAlcremie)) {
    throw new Error('ALCREMIE_CREAM_COVERAGE_CONFLICT')
  }
}

export function appearanceCandidateForId(
  source: PokemonDatasetZhAdapterOutput,
  appearanceId: string,
): ZhAppearanceCandidate {
  const parts = appearanceId.split(':')
  if (parts[1] === '0201') {
    const glyph = UNOWN_GLYPHS.find(definition => definition.token === parts[2])
    if (!glyph) throw new Error(`UNKNOWN_UNOWN_APPEARANCE: ${appearanceId}`)
    return uniqueCandidate(source.appearances, `未知图腾-（${glyph.sourceLabel}）`)
  }
  if (parts[1] === '0869') {
    const cream = ALCREMIE_CREAMS.find(definition => definition.token === parts[2])
    const sweet = ALCREMIE_SWEETS.find(definition => definition.token === parts[3])
    if (!cream || !sweet) throw new Error(`UNKNOWN_ALCREMIE_APPEARANCE: ${appearanceId}`)
    return uniqueCandidate(source.appearances, `霜奶仙-${cream.labelZh}-${sweet.labelZh}`)
  }
  throw new Error(`UNSUPPORTED_APPEARANCE_ID: ${appearanceId}`)
}

export function buildAppearances(
  data: ShowdownSourceData,
  source: VerifiedSource,
  zh: PokemonDatasetZhAdapterOutput,
): AppearanceBuildResult {
  validateShowdownCoverage(data)
  const pokedexReference = reference(source, 'data/pokedex.ts')
  const unownCandidates = zh.appearances.filter(candidate => candidate.nationalDexNumber === 201)
  const alcremieCandidates = zh.appearances.filter(candidate => candidate.nationalDexNumber === 869)
  if (unownCandidates.length !== 28) throw new Error(`UNOWN_HOME_IMAGE_COUNT: expected 28, received ${unownCandidates.length}`)
  if (alcremieCandidates.length !== 71) throw new Error(`ALCREMIE_HOME_IMAGE_COUNT: expected 71, received ${alcremieCandidates.length}`)

  const appearances: Appearance[] = []
  const localizationEntries: AppearanceLocalizationEntry[] = []
  const identityMatches: IdentityMatch[] = []
  const appearanceMatches: AppearanceMatch[] = []
  const valueProvenance: ValueProvenance[] = []

  const addProvenance = (
    entityId: string,
    fieldPath: string,
    sourceReferenceId: string,
    method: ValueProvenance['method'],
    sourcePointer: string,
  ) => valueProvenance.push(ValueProvenanceSchema.parse({
    entityId,
    fieldPath,
    sourceReferenceId,
    method,
    mappingClass: 'rule-based',
    selected: true,
    sourcePointer,
  }))

  const addAppearance = (options: {
    appearanceId: string
    speciesId: string
    formId: string
    isDefault: boolean
    aspects: Array<{ dimension: 'glyph' | 'cream' | 'sweet'; value: string }>
    candidate: ZhAppearanceCandidate
    externalName: string
    externalDimensions: Array<'glyph' | 'cream' | 'sweet'>
    showdownEvidenceKind: 'cosmetic-identity' | 'aspect'
    name: string
    shortLabel?: string
    aspectLabels: Array<{ dimension: 'glyph' | 'cream' | 'sweet'; value: string; label: string }>
    showdownPointer: string
  }) => {
    const registry = registryEntry(source, options.appearanceId)
    if (registry.showdownId !== showdownId(options.externalName)) {
      throw new Error(`APPEARANCE_REGISTRY_EXTERNAL_ID_CONFLICT: ${options.appearanceId}`)
    }
    const appearance = AppearanceSchema.parse({
      appearanceId: options.appearanceId,
      speciesId: options.speciesId,
      formId: options.formId,
      isDefault: options.isDefault,
      aspects: [...options.aspects].sort((left, right) => `${left.dimension}:${left.value}`.localeCompare(`${right.dimension}:${right.value}`, 'en')),
      availability: { lifecycle: 'current', obtainability: 'obtainable' },
      dataStatus: 'complete',
    })
    appearances.push(appearance)
    localizationEntries.push(AppearanceLocalizationEntrySchema.parse({
      entityId: appearance.appearanceId,
      name: options.name,
      ...(options.shortLabel ? { shortLabel: options.shortLabel } : {}),
      aspectLabels: options.aspectLabels,
    }))
    identityMatches.push(IdentityMatchSchema.parse({
      entityId: appearance.appearanceId,
      entityKind: 'appearance',
      showdownId: registry.showdownId,
      mappingClass: 'rule-based',
      sourceReferenceId: pokedexReference,
    }))
    appearanceMatches.push(AppearanceMatchSchema.parse({
      appearanceId: appearance.appearanceId,
      source: 'pokemon-showdown',
      upstreamKey: options.externalName,
      evidenceKind: options.showdownEvidenceKind,
      aspectDimensions: options.externalDimensions,
      mappingClass: 'rule-based',
      sourceReferenceId: pokedexReference,
    }))
    appearanceMatches.push(AppearanceMatchSchema.parse({
      appearanceId: appearance.appearanceId,
      source: 'pokemon-dataset-zh',
      upstreamKey: options.candidate.nameZh,
      evidenceKind: 'localization',
      aspectDimensions: options.aspects.map(aspect => aspect.dimension),
      mappingClass: 'rule-based',
      sourceReferenceId: options.candidate.sourceReferenceId,
    }))
    for (const field of ['/appearanceId', '/speciesId', '/formId', '/isDefault', '/availability', '/dataStatus']) {
      addProvenance(appearance.appearanceId, field, pokedexReference, 'project-normalization', options.showdownPointer)
    }
    addProvenance(appearance.appearanceId, '/aspects', options.candidate.sourceReferenceId, 'project-normalization', options.candidate.sourcePointer)
    addProvenance(appearance.appearanceId, '/localization/zh-CN/name', options.candidate.sourceReferenceId, 'source-literal', options.candidate.sourcePointer)
    if (options.shortLabel) {
      addProvenance(appearance.appearanceId, '/localization/zh-CN/shortLabel', options.candidate.sourceReferenceId, 'project-normalization', options.candidate.sourcePointer)
    }
    addProvenance(appearance.appearanceId, '/localization/zh-CN/aspectLabels', options.candidate.sourceReferenceId, 'project-normalization', options.candidate.sourcePointer)
  }

  for (const glyph of UNOWN_GLYPHS) {
    const candidate = uniqueCandidate(unownCandidates, `未知图腾-（${glyph.sourceLabel}）`)
    addAppearance({
      appearanceId: stableAppearanceId(201, [glyph.token]),
      speciesId: 'species:0201',
      formId: 'form:0201:base',
      isDefault: glyph.token === 'a',
      aspects: [{ dimension: 'glyph', value: glyph.token }],
      candidate,
      externalName: glyph.showdownName,
      externalDimensions: ['glyph'],
      showdownEvidenceKind: 'cosmetic-identity',
      name: candidate.nameZh,
      shortLabel: glyph.shortLabel,
      aspectLabels: [{ dimension: 'glyph', value: glyph.token, label: glyph.shortLabel }],
      showdownPointer: glyph.token === 'a' ? '/unown/baseForme' : '/unown/cosmeticFormes',
    })
  }

  const selectedAlcremieNames = new Set<string>()
  for (const cream of ALCREMIE_CREAMS) {
    for (const sweet of ALCREMIE_SWEETS) {
      const name = `霜奶仙-${cream.labelZh}-${sweet.labelZh}`
      const candidate = uniqueCandidate(alcremieCandidates, name)
      selectedAlcremieNames.add(name)
      addAppearance({
        appearanceId: stableAppearanceId(869, [cream.token, sweet.token]),
        speciesId: 'species:0869',
        formId: 'form:0869:base',
        isDefault: false,
        aspects: [
          { dimension: 'cream', value: cream.token },
          { dimension: 'sweet', value: sweet.token },
        ],
        candidate,
        externalName: cream.showdownName,
        externalDimensions: ['cream'],
        showdownEvidenceKind: 'aspect',
        name: candidate.nameZh,
        aspectLabels: [
          { dimension: 'cream', value: cream.token, label: cream.labelZh },
          { dimension: 'sweet', value: sweet.token, label: sweet.labelZh },
        ],
        showdownPointer: cream.token === 'vanilla-cream' ? '/alcremie/baseForme' : '/alcremie/cosmeticFormes',
      })
    }
  }

  const excludedAlcremie = alcremieCandidates.filter(candidate => !selectedAlcremieNames.has(candidate.nameZh))
  const expectedExcluded = new Set([
    '霜奶仙-超极巨化',
    ...ALCREMIE_SWEETS.map(sweet => `霜奶仙-${sweet.labelZh}`),
  ])
  if (excludedAlcremie.length !== expectedExcluded.size
    || excludedAlcremie.some(candidate => !expectedExcluded.has(candidate.nameZh))) {
    throw new Error('ALCREMIE_NON_COMBINATION_COVERAGE_CHANGED')
  }

  return {
    appearances: appearances.sort((left, right) => `${left.speciesId}:${left.formId ?? ''}:${left.appearanceId}`.localeCompare(`${right.speciesId}:${right.formId ?? ''}:${right.appearanceId}`, 'en')),
    localizationEntries: localizationEntries.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    identityMatches: identityMatches.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    appearanceMatches: appearanceMatches.sort((left, right) => `${left.appearanceId}:${left.source}`.localeCompare(`${right.appearanceId}:${right.source}`, 'en')),
    valueProvenance: valueProvenance.sort((left, right) => `${left.entityId}:${left.fieldPath}`.localeCompare(`${right.entityId}:${right.fieldPath}`, 'en')),
    mappingCounts: { automatic: 0, ruleBased: appearances.length, manualException: 0, unresolved: 0 },
    conflicts: [],
    sourceCoverage: {
      unownHomeImages: unownCandidates.length,
      showdownUnownGlyphs: UNOWN_GLYPHS.length,
      alcremieHomeImages: alcremieCandidates.length,
      alcremieCombinations: selectedAlcremieNames.size,
      alcremieExcludedCoverageRecords: excludedAlcremie.length,
      showdownAlcremieCreams: ALCREMIE_CREAMS.length,
    },
  }
}
