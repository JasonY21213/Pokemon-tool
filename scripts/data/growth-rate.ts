import {
  FormSchema,
  GrowthRateResolutionSchema,
  GrowthRateSchema,
  SpeciesSchema,
  ValueProvenanceSchema,
  type Form,
  type GrowthRate,
  type GrowthRateId,
  type GrowthRateResolution,
  type SmokeDataset,
  type Species,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import type { FormLocalizationMapping } from './localization.ts'
import type {
  PokemonDatasetZhAdapterOutput,
  ZhFormCandidate,
  ZhSpeciesLocalizationCandidate,
} from './pokemon-dataset-zh.ts'

type MappingClass = 'automatic' | 'rule-based' | 'manual-exception'

const DEFINITIONS = [
  ['growth:erratic', 'erratic', 'erratic', 600_000, '最快'],
  ['growth:fast', 'fast', 'fast', 800_000, '快'],
  ['growth:medium-fast', 'medium-fast', 'mediumFast', 1_000_000, '较快'],
  ['growth:medium-slow', 'medium-slow', 'mediumSlow', 1_059_860, '较慢'],
  ['growth:slow', 'slow', 'slow', 1_250_000, '慢'],
  ['growth:fluctuating', 'fluctuating', 'fluctuating', 1_640_000, '最慢'],
] as const

export const CANONICAL_GROWTH_RATES: GrowthRate[] = DEFINITIONS.map(([
  growthRateId,
  canonicalName,
  formulaId,
  level100Total,
]) => GrowthRateSchema.parse({ growthRateId, canonicalName, formulaId, level100Total }))

const DEFINITION_BY_LABEL = new Map<string, (typeof DEFINITIONS)[number]>(
  DEFINITIONS.map(definition => [definition[4], definition]),
)

export type ParsedGrowthRate = {
  status: 'resolved'
  growthRateId: GrowthRateId
  level100Total: number
  rawLabel: string
  rawValue: string
} | {
  status: 'unresolved'
  growthRateId: null
  level100Total: null
  rawLabel: '未知'
  rawValue: string
}

export interface GrowthRateAssignmentAudit {
  entityId: string
  field: '/growthRate' | '/growthRateOverride'
  status: 'resolved' | 'unresolved'
  growthRateId: GrowthRateId | null
  rawValue: string
  sourcePath: string
  sourcePointer: string
  mappingClass: MappingClass
}

export interface GrowthRateConflict {
  code: string
  speciesId: string
  formId: string | null
  sourcePath: string
  sourcePointer: string
  rawValue: string
  message: string
}

export interface GrowthRateBuildResult {
  species: Species[]
  forms: Form[]
  valueProvenance: ValueProvenance[]
  assignments: GrowthRateAssignmentAudit[]
  conflicts: GrowthRateConflict[]
  expectedUnresolvedCount: number
}

export function parseGrowthRate(rawValue: string): ParsedGrowthRate {
  const value = rawValue.trim()
  if (value === '未知') {
    return { status: 'unresolved', growthRateId: null, level100Total: null, rawLabel: '未知', rawValue }
  }
  const match = /^(\d{1,3}(?:,\d{3})*)（([^（）]+)）$/.exec(value)
  if (!match) throw new Error(`GROWTH_RATE_UNRECOGNIZED: ${rawValue}`)
  const level100Total = Number(match[1].replaceAll(',', ''))
  const rawLabel = match[2]
  const definition = DEFINITION_BY_LABEL.get(rawLabel)
  if (!definition) throw new Error(`GROWTH_RATE_UNKNOWN_LABEL: ${rawLabel}`)
  if (level100Total !== definition[3]) {
    throw new Error(
      `GROWTH_RATE_SOURCE_CONFLICT: ${rawLabel} requires ${definition[3]}, received ${level100Total}`,
    )
  }
  return {
    status: 'resolved',
    growthRateId: definition[0],
    level100Total,
    rawLabel,
    rawValue,
  }
}

function normalizedEnglish(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function resolution(parsed: ParsedGrowthRate): GrowthRateResolution {
  return GrowthRateResolutionSchema.parse({ id: parsed.growthRateId, status: parsed.status })
}

function sourceCandidate(
  species: Species,
  source: PokemonDatasetZhAdapterOutput,
): ZhSpeciesLocalizationCandidate {
  const matches = source.species.filter(candidate => candidate.nationalDexNumber === species.nationalDexNumber)
  if (matches.length !== 1) {
    throw new Error(`GROWTH_SPECIES_NUMBER_CONFLICT: ${species.speciesId} matched ${matches.length} source records`)
  }
  const candidate = matches[0]
  if (normalizedEnglish(candidate.englishName) !== normalizedEnglish(species.canonicalName.en)) {
    throw new Error(`GROWTH_SPECIES_ENGLISH_CONFLICT: ${species.speciesId}`)
  }
  return candidate
}

function candidateByPointer(
  candidate: ZhSpeciesLocalizationCandidate,
  pointer: string | undefined,
): ZhFormCandidate | undefined {
  if (!pointer) return undefined
  return candidate.forms.find(form => form.sourcePointer === pointer)
}

function growthFormMappings(
  dataset: SmokeDataset,
  source: PokemonDatasetZhAdapterOutput,
  localizationMappings: FormLocalizationMapping[],
): FormLocalizationMapping[] {
  const mappings = localizationMappings.map(mapping => ({ ...mapping }))
  const eevee = source.species.find(candidate => candidate.nationalDexNumber === 133)
  const partner = eevee?.forms.filter(form => form.nameZh === '搭档伊布') ?? []
  const canonicalPartner = dataset.forms.find(form => form.formId === 'form:0133:partner')
  if (canonicalPartner) {
    if (canonicalPartner.showdownId !== 'eeveestarter' || partner.length !== 1) {
      throw new Error('GROWTH_PARTNER_EEVEE_IDENTITY_CONFLICT')
    }
    const existing = mappings.find(mapping => mapping.formId === canonicalPartner.formId)
    if (existing) {
      existing.sourcePointer = partner[0].sourcePointer
      existing.mappingClass = 'rule-based'
    } else {
      mappings.push({
        formId: canonicalPartner.formId,
        sourcePointer: partner[0].sourcePointer,
        mappingClass: 'rule-based',
      })
    }
  }
  return mappings
}

function provenance(
  entityId: string,
  fieldPath: string,
  candidate: ZhSpeciesLocalizationCandidate,
  form: ZhFormCandidate,
  mappingClass: MappingClass,
): ValueProvenance {
  return ValueProvenanceSchema.parse({
    entityId,
    fieldPath,
    sourceReferenceId: candidate.sourceReferenceId,
    method: 'project-normalization',
    mappingClass,
    selected: true,
    sourcePointer: `${form.sourcePointer}/experience_100`,
  })
}

export function buildGrowthRates(
  dataset: SmokeDataset,
  source: PokemonDatasetZhAdapterOutput,
  localizationMappings: FormLocalizationMapping[],
): GrowthRateBuildResult {
  const mappings = growthFormMappings(dataset, source, localizationMappings)
  const mappingByFormId = new Map(mappings
    .filter(mapping => mapping.mappingClass !== 'unresolved')
    .map(mapping => [mapping.formId, mapping]))
  const species: Species[] = []
  const formUpdates = new Map<string, GrowthRateResolution>()
  const valueProvenance: ValueProvenance[] = []
  const assignments: GrowthRateAssignmentAudit[] = []
  const conflicts: GrowthRateConflict[] = []

  for (const entity of dataset.species) {
    const candidate = sourceCandidate(entity, source)
    const defaultMapping = mappingByFormId.get(entity.defaultFormId)
    const defaultCandidate = candidateByPointer(candidate, defaultMapping?.sourcePointer)
    if (!defaultMapping || defaultMapping.mappingClass === 'unresolved' || !defaultCandidate) {
      throw new Error(`GROWTH_DEFAULT_FORM_UNRESOLVED: ${entity.speciesId}`)
    }
    const defaultMappingClass = defaultMapping.mappingClass
    const defaultParsed = parseGrowthRate(defaultCandidate.experience100Raw)
    const growthRate = resolution(defaultParsed)
    species.push(SpeciesSchema.parse({ ...entity, growthRate }))
    for (const fieldPath of ['/growthRate/id', '/growthRate/status']) {
      valueProvenance.push(provenance(
        entity.speciesId,
        fieldPath,
        candidate,
        defaultCandidate,
        defaultMappingClass,
      ))
    }
    assignments.push({
      entityId: entity.speciesId,
      field: '/growthRate',
      status: defaultParsed.status,
      growthRateId: defaultParsed.growthRateId,
      rawValue: defaultParsed.rawValue,
      sourcePath: candidate.sourcePath,
      sourcePointer: `${defaultCandidate.sourcePointer}/experience_100`,
      mappingClass: defaultMappingClass,
    })

    for (const rawForm of candidate.forms) {
      if (rawForm.sourcePointer === defaultCandidate.sourcePointer) continue
      const parsed = parseGrowthRate(rawForm.experience100Raw)
      const mapped = mappings.find(mapping => mapping.sourcePointer === rawForm.sourcePointer
        && dataset.forms.some(form => form.formId === mapping.formId && form.speciesId === entity.speciesId))
      const differs = parsed.status !== defaultParsed.status || parsed.growthRateId !== defaultParsed.growthRateId
      if (!mapped || mapped.mappingClass === 'unresolved') {
        if (differs) {
          conflicts.push({
            code: 'UNMAPPED_FORM_GROWTH_RATE_DIFFERENCE',
            speciesId: entity.speciesId,
            formId: null,
            sourcePath: candidate.sourcePath,
            sourcePointer: `${rawForm.sourcePointer}/experience_100`,
            rawValue: parsed.rawValue,
            message: 'A differing Form GrowthRate cannot be selected without reliable Form identity.',
          })
        }
        continue
      }
      if (!differs) continue
      const override = resolution(parsed)
      formUpdates.set(mapped.formId, override)
      for (const fieldPath of ['/growthRateOverride/id', '/growthRateOverride/status']) {
        valueProvenance.push(provenance(
          mapped.formId,
          fieldPath,
          candidate,
          rawForm,
          mapped.mappingClass,
        ))
      }
      assignments.push({
        entityId: mapped.formId,
        field: '/growthRateOverride',
        status: parsed.status,
        growthRateId: parsed.growthRateId,
        rawValue: parsed.rawValue,
        sourcePath: candidate.sourcePath,
        sourcePointer: `${rawForm.sourcePointer}/experience_100`,
        mappingClass: mapped.mappingClass,
      })
    }
  }

  const forms = dataset.forms.map(form => FormSchema.parse({
    ...form,
    growthRateOverride: formUpdates.get(form.formId) ?? null,
  }))
  return {
    species: species.sort((left, right) => left.nationalDexNumber - right.nationalDexNumber),
    forms: forms.sort((left, right) => left.formId.localeCompare(right.formId, 'en')),
    valueProvenance: valueProvenance.sort((left, right) => `${left.entityId}${left.fieldPath}`.localeCompare(`${right.entityId}${right.fieldPath}`, 'en')),
    assignments: assignments.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    conflicts,
    expectedUnresolvedCount: assignments.filter(assignment => assignment.status === 'unresolved').length,
  }
}
