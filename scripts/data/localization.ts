import {
  AbilityLocalizationSchema,
  CoreLocalizationEntrySchema,
  CoreLocalizationSchema,
  SmokeLocalizationSchema,
  ValueProvenanceSchema,
  type AbilityLocalizationEntry,
  type CoreLocalizationEntry,
  type Form,
  type SmokeDataset,
  type SmokeLocalization,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import type {
  PokemonDatasetZhAdapterOutput,
  ZhAbilityLocalizationCandidate,
  ZhFormCandidate,
  ZhSpeciesLocalizationCandidate,
} from './pokemon-dataset-zh.ts'

type MappingClass = 'automatic' | 'rule-based' | 'manual-exception'

export interface FormLocalizationMapping {
  formId: string
  sourcePointer?: string
  mappingClass: MappingClass | 'unresolved'
}

export interface LocalizationConflict {
  code: string
  entityId: string
  field: string
  showdownValue: unknown
  localizationSourceValue: unknown
}

export interface LocalizationBuildResult {
  localization: SmokeLocalization
  valueProvenance: ValueProvenance[]
  formMappings: FormLocalizationMapping[]
  mechanicsConflicts: LocalizationConflict[]
}

const ZH_TYPE_IDS = new Map<string, string>([
  ['一般', 'type:normal'], ['格斗', 'type:fighting'], ['飞行', 'type:flying'],
  ['毒', 'type:poison'], ['地面', 'type:ground'], ['岩石', 'type:rock'],
  ['虫', 'type:bug'], ['幽灵', 'type:ghost'], ['钢', 'type:steel'],
  ['火', 'type:fire'], ['水', 'type:water'], ['草', 'type:grass'],
  ['电', 'type:electric'], ['超能力', 'type:psychic'], ['冰', 'type:ice'],
  ['龙', 'type:dragon'], ['恶', 'type:dark'], ['妖精', 'type:fairy'],
])

function normalizedEnglish(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function sameSet(left: string[], right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

export function mapSpeciesLocalizations(
  dataset: SmokeDataset,
  candidates: ZhSpeciesLocalizationCandidate[],
): Array<{ entry: CoreLocalizationEntry; candidate: ZhSpeciesLocalizationCandidate }> {
  return dataset.species.map(species => {
    const matches = candidates.filter(candidate => candidate.nationalDexNumber === species.nationalDexNumber)
    if (matches.length !== 1) {
      throw new Error(`ZH_SPECIES_NUMBER_CONFLICT: ${species.speciesId} matched ${matches.length} source records`)
    }
    const candidate = matches[0]
    if (normalizedEnglish(candidate.englishName) !== normalizedEnglish(species.canonicalName.en)) {
      throw new Error(`ZH_SPECIES_ENGLISH_CONFLICT: ${species.speciesId} expected ${species.canonicalName.en}, received ${candidate.englishName}`)
    }
    return {
      entry: CoreLocalizationEntrySchema.parse({
        entityId: species.speciesId,
        name: candidate.chineseName,
        aliases: [],
        formLabel: null,
      }),
      candidate,
    }
  })
}

function abilityNameToId(
  dataset: SmokeDataset,
  candidates: ZhAbilityLocalizationCandidate[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const candidate of candidates) {
    const canonical = dataset.abilities.find(ability => ability.officialNumber === candidate.officialNumber)
    if (!canonical) continue
    if (normalizedEnglish(candidate.englishName) !== normalizedEnglish(canonical.canonicalName.en)) {
      throw new Error(`ZH_ABILITY_ENGLISH_CONFLICT: Ability #${candidate.officialNumber}`)
    }
    const existing = result.get(candidate.chineseName)
    if (existing && existing !== canonical.abilityId) {
      throw new Error(`ZH_FORM_ABILITY_NAME_AMBIGUOUS: ${candidate.chineseName}`)
    }
    result.set(candidate.chineseName, canonical.abilityId)
  }
  return result
}

function candidateTypes(candidate: ZhFormCandidate): string[] {
  return candidate.typesZh.map(name => ZH_TYPE_IDS.get(name) ?? `unknown-type:${name}`)
}

function candidateAbilities(candidate: ZhFormCandidate, abilityIds: ReadonlyMap<string, string>): string[] {
  return candidate.abilitiesZh.map(ability => abilityIds.get(ability.name) ?? `unknown-ability:${ability.name}`)
}

function formMechanicsMatch(
  form: Form,
  candidate: ZhFormCandidate,
  abilityIds: ReadonlyMap<string, string>,
): boolean {
  return sameSet(form.types, candidateTypes(candidate))
    && sameSet(form.abilities.map(slot => slot.abilityId), candidateAbilities(candidate, abilityIds))
}

function selectFormCandidate(
  form: Form,
  speciesCandidate: ZhSpeciesLocalizationCandidate,
  abilityIds: ReadonlyMap<string, string>,
): { candidate: ZhFormCandidate; mappingClass: MappingClass } | undefined {
  const mechanicsMatches = speciesCandidate.forms.filter(candidate => formMechanicsMatch(form, candidate, abilityIds))
  if (mechanicsMatches.length === 1) return { candidate: mechanicsMatches[0], mappingClass: 'automatic' }

  if (form.formKind === 'base') {
    const baseMatches = mechanicsMatches.filter(candidate => candidate.nameZh === speciesCandidate.chineseName)
    if (baseMatches.length === 1) return { candidate: baseMatches[0], mappingClass: 'automatic' }
  }
  if (form.formKind === 'gmax') {
    const gmaxMatches = mechanicsMatches.filter(candidate => candidate.nameZh.startsWith('超极巨化'))
    if (gmaxMatches.length === 1) return { candidate: gmaxMatches[0], mappingClass: 'rule-based' }
  }
  return undefined
}

export function requireUniqueAutomaticFormCandidate(
  form: Form,
  candidates: ZhFormCandidate[],
  abilityIds: ReadonlyMap<string, string>,
): ZhFormCandidate {
  const matches = candidates.filter(candidate => formMechanicsMatch(form, candidate, abilityIds))
  if (matches.length !== 1) {
    throw new Error(`ZH_FORM_NON_UNIQUE: ${form.formId} matched ${matches.length} candidates`)
  }
  return matches[0]
}

function localizedFormLabel(form: Form, candidate: ZhFormCandidate, speciesName: string): string | null {
  if (form.formKind === 'base' && candidate.nameZh === speciesName) return null
  const withoutSpecies = candidate.nameZh.replace(speciesName, '').trim()
  return withoutSpecies || candidate.nameZh
}

export function mapAbilityLocalizations(
  dataset: SmokeDataset,
  candidates: ZhAbilityLocalizationCandidate[],
): Array<{ entry: AbilityLocalizationEntry; candidate: ZhAbilityLocalizationCandidate }> {
  return dataset.abilities.map(ability => {
    const matches = candidates.filter(candidate => candidate.officialNumber === ability.officialNumber)
    if (matches.length !== 1) {
      throw new Error(`ZH_ABILITY_NUMBER_CONFLICT: ${ability.abilityId} matched ${matches.length} source rows`)
    }
    const candidate = matches[0]
    if (normalizedEnglish(candidate.englishName) !== normalizedEnglish(ability.canonicalName.en)) {
      throw new Error(`ZH_ABILITY_ENGLISH_CONFLICT: ${ability.abilityId} expected ${ability.canonicalName.en}, received ${candidate.englishName}`)
    }
    return {
      entry: {
        entityId: ability.abilityId,
        name: candidate.chineseName,
        ...(candidate.shortDescription ? { shortDescription: candidate.shortDescription } : {}),
      },
      candidate,
    }
  })
}

export function buildLocalization(
  dataset: SmokeDataset,
  source: PokemonDatasetZhAdapterOutput,
): LocalizationBuildResult {
  const speciesMappings = mapSpeciesLocalizations(dataset, source.species)
  const abilities = mapAbilityLocalizations(dataset, source.abilities)
  const abilityIdsByChineseName = abilityNameToId(dataset, source.abilities)
  const coreEntries: CoreLocalizationEntry[] = speciesMappings.map(mapping => mapping.entry)
  const formMappings: FormLocalizationMapping[] = []
  const provenance: ValueProvenance[] = []
  const mechanicsConflicts: LocalizationConflict[] = []

  for (const mapping of speciesMappings) {
    provenance.push(ValueProvenanceSchema.parse({
      entityId: mapping.entry.entityId,
      fieldPath: '/localization/zh-CN/name',
      sourceReferenceId: mapping.candidate.sourceReferenceId,
      method: 'source-literal',
      mappingClass: 'automatic',
      selected: true,
      sourcePointer: mapping.candidate.sourcePointer,
    }))

    const forms = dataset.forms.filter(form => form.speciesId === mapping.entry.entityId)
    for (const form of forms) {
      const selected = selectFormCandidate(form, mapping.candidate, abilityIdsByChineseName)
      if (!selected) {
        formMappings.push({ formId: form.formId, mappingClass: 'unresolved' })
        continue
      }
      const formLabel = localizedFormLabel(form, selected.candidate, mapping.entry.name)
      coreEntries.push(CoreLocalizationEntrySchema.parse({
        entityId: form.formId,
        name: selected.candidate.nameZh,
        aliases: [],
        formLabel,
      }))
      formMappings.push({
        formId: form.formId,
        sourcePointer: selected.candidate.sourcePointer,
        mappingClass: selected.mappingClass,
      })
      provenance.push(ValueProvenanceSchema.parse({
        entityId: form.formId,
        fieldPath: '/localization/zh-CN/name',
        sourceReferenceId: mapping.candidate.sourceReferenceId,
        method: 'source-literal',
        mappingClass: selected.mappingClass,
        selected: true,
        sourcePointer: `${selected.candidate.sourcePointer}/name`,
      }))
      if (formLabel !== null) {
        provenance.push(ValueProvenanceSchema.parse({
          entityId: form.formId,
          fieldPath: '/localization/zh-CN/formLabel',
          sourceReferenceId: mapping.candidate.sourceReferenceId,
          method: 'project-normalization',
          mappingClass: selected.mappingClass,
          selected: true,
          sourcePointer: `${selected.candidate.sourcePointer}/name`,
        }))
      }
    }
  }

  for (const mapping of abilities) {
    provenance.push(ValueProvenanceSchema.parse({
      entityId: mapping.entry.entityId,
      fieldPath: '/localization/zh-CN/name',
      sourceReferenceId: mapping.candidate.sourceReferenceId,
      method: 'source-literal',
      mappingClass: 'automatic',
      selected: true,
      sourcePointer: `${mapping.candidate.sourcePointer}/name_zh`,
    }))
    if (mapping.entry.shortDescription) {
      provenance.push(ValueProvenanceSchema.parse({
        entityId: mapping.entry.entityId,
        fieldPath: '/localization/zh-CN/shortDescription',
        sourceReferenceId: mapping.candidate.sourceReferenceId,
        method: 'source-literal',
        mappingClass: 'automatic',
        selected: true,
        sourcePointer: `${mapping.candidate.sourcePointer}/description`,
      }))
    }
    const canonical = dataset.abilities.find(ability => ability.abilityId === mapping.entry.entityId)
    if (canonical && canonical.generation !== mapping.candidate.generation) {
      mechanicsConflicts.push({
        code: 'ABILITY_GENERATION_MISMATCH',
        entityId: canonical.abilityId,
        field: '/generation',
        showdownValue: canonical.generation,
        localizationSourceValue: mapping.candidate.generation,
      })
    }
  }

  const localization = SmokeLocalizationSchema.parse({
    core: CoreLocalizationSchema.parse({
      locale: 'zh-CN',
      entries: coreEntries.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    }),
    abilities: AbilityLocalizationSchema.parse({
      locale: 'zh-CN',
      entries: abilities.map(mapping => mapping.entry).sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    }),
    moves: { locale: 'zh-CN', entries: [] },
    evolutions: { locale: 'zh-CN', entries: [] },
    appearances: { locale: 'zh-CN', entries: [] },
  })
  return {
    localization,
    valueProvenance: provenance.sort((left, right) => `${left.entityId}${left.fieldPath}`.localeCompare(`${right.entityId}${right.fieldPath}`, 'en')),
    formMappings: formMappings.sort((left, right) => left.formId.localeCompare(right.formId, 'en')),
    mechanicsConflicts,
  }
}
