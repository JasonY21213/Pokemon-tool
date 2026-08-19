import { z } from 'zod'

export const SourceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/)
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
export const SpeciesIdSchema = z.string().regex(/^species:\d{4}$/)
export const FormIdSchema = z.string().regex(/^form:\d{4}:[a-z0-9-]+$/)
export const AbilityIdSchema = z.string().regex(/^ability:\d{4}$/)
export const TypeIdSchema = z.string().regex(/^type:[a-z]+$/)
export const NatureIdSchema = z.string().regex(/^nature:[a-z]+$/)
export const GrowthRateIdSchema = z.enum([
  'growth:erratic',
  'growth:fast',
  'growth:medium-fast',
  'growth:medium-slow',
  'growth:slow',
  'growth:fluctuating',
])
export const EntityIdSchema = z.union([
  SpeciesIdSchema,
  FormIdSchema,
  AbilityIdSchema,
  TypeIdSchema,
  NatureIdSchema,
  GrowthRateIdSchema,
])

export const StatIdSchema = z.enum(['hp', 'atk', 'def', 'spa', 'spd', 'spe'])
export const BoostableStatIdSchema = z.enum(['atk', 'def', 'spa', 'spd', 'spe'])
export const AbilitySlotKeySchema = z.enum(['0', '1', 'H', 'S'])
export const DataStatusSchema = z.enum(['complete', 'partial', 'unresolved'])

export const AvailabilitySchema = z.object({
  lifecycle: z.enum(['current', 'past', 'future', 'unknown']),
  obtainability: z.enum(['obtainable', 'unobtainable', 'unknown']),
}).strict()

export const CanonicalNameSchema = z.object({
  en: z.string().min(1),
}).strict()

export const StatBlockSchema = z.object({
  hp: z.number().int().positive(),
  atk: z.number().int().positive(),
  def: z.number().int().positive(),
  spa: z.number().int().positive(),
  spd: z.number().int().positive(),
  spe: z.number().int().positive(),
}).strict()

export const AbilitySlotSchema = z.object({
  slot: AbilitySlotKeySchema,
  abilityId: AbilityIdSchema,
}).strict()

export const TypeMatchupSchema = z.object({
  attackingTypeId: TypeIdSchema,
  multiplier: z.union([z.literal(0), z.literal(0.5), z.literal(1), z.literal(2)]),
}).strict()

export const TypeSchema = z.object({
  typeId: TypeIdSchema,
  showdownId: z.string().regex(/^[a-z]+$/),
  canonicalName: CanonicalNameSchema,
  damageTaken: z.array(TypeMatchupSchema).length(18),
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const NatureSchema = z.object({
  natureId: NatureIdSchema,
  showdownId: z.string().regex(/^[a-z]+$/),
  canonicalName: CanonicalNameSchema,
  plusStat: BoostableStatIdSchema.nullable(),
  minusStat: BoostableStatIdSchema.nullable(),
  neutral: z.boolean(),
  dataStatus: DataStatusSchema,
}).strict()

export const AbilitySchema = z.object({
  abilityId: AbilityIdSchema,
  officialNumber: z.number().int().positive(),
  showdownId: z.string().regex(/^[a-z0-9]+$/),
  canonicalName: CanonicalNameSchema,
  generation: z.number().int().positive(),
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const GrowthRateResolutionSchema = z.object({
  id: GrowthRateIdSchema.nullable(),
  status: z.enum(['resolved', 'unresolved']),
}).strict().superRefine((value, context) => {
  if ((value.status === 'resolved') !== (value.id !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'resolved GrowthRate requires an id; unresolved GrowthRate requires null',
    })
  }
})

export const GrowthRateSchema = z.object({
  growthRateId: GrowthRateIdSchema,
  canonicalName: z.enum(['erratic', 'fast', 'medium-fast', 'medium-slow', 'slow', 'fluctuating']),
  formulaId: z.enum(['erratic', 'fast', 'mediumFast', 'mediumSlow', 'slow', 'fluctuating']),
  level100Total: z.number().int().positive(),
}).strict()

export const SpeciesSchema = z.object({
  speciesId: SpeciesIdSchema,
  nationalDexNumber: z.number().int().positive(),
  showdownId: z.string().regex(/^[a-z0-9]+$/),
  canonicalName: CanonicalNameSchema,
  generation: z.number().int().positive(),
  defaultFormId: FormIdSchema,
  growthRate: GrowthRateResolutionSchema,
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const FormSchema = z.object({
  formId: FormIdSchema,
  speciesId: SpeciesIdSchema,
  showdownId: z.string().regex(/^[a-z0-9]+$/),
  canonicalName: CanonicalNameSchema,
  formLabel: z.string().min(1).nullable(),
  formKind: z.enum(['base', 'mega', 'gmax', 'special']),
  types: z.array(TypeIdSchema).min(1).max(2),
  baseStats: StatBlockSchema,
  abilities: z.array(AbilitySlotSchema).min(1),
  generation: z.number().int().positive(),
  heightM: z.number().nonnegative().nullable(),
  weightKg: z.number().nonnegative().nullable(),
  gender: z.enum(['M', 'F', 'N']).nullable(),
  battleOnly: z.boolean(),
  changesFromFormIds: z.array(FormIdSchema),
  requiredItemNames: z.array(z.string().min(1)),
  requiredAbilityId: AbilityIdSchema.nullable(),
  growthRateOverride: GrowthRateResolutionSchema.nullable(),
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const SourceReferenceSchema = z.object({
  sourceReferenceId: z.string().regex(/^src:(pokemon-showdown|pokemon-dataset-zh):[0-9a-f]{16}$/),
  source: z.enum(['pokemon-showdown', 'pokemon-dataset-zh']),
  commit: SourceCommitSchema,
  path: z.string().min(1),
  sha256: Sha256Schema,
}).strict()

export const IdentityMatchSchema = z.object({
  entityId: EntityIdSchema,
  entityKind: z.enum(['species', 'form', 'ability', 'type', 'nature']),
  showdownId: z.string().min(1),
  mappingClass: z.enum(['automatic', 'rule-based', 'manual-exception']),
  sourceReferenceId: SourceReferenceSchema.shape.sourceReferenceId,
}).strict()

export const ValueProvenanceSchema = z.object({
  entityId: EntityIdSchema,
  fieldPath: z.string().startsWith('/'),
  sourceReferenceId: SourceReferenceSchema.shape.sourceReferenceId,
  method: z.enum(['source-literal', 'showdown-dex-rule', 'project-normalization']),
  mappingClass: z.enum(['automatic', 'rule-based', 'manual-exception']),
  selected: z.boolean(),
  sourcePointer: z.string().startsWith('/').optional(),
}).strict()

export const CoreLocalizationEntrySchema = z.object({
  entityId: z.union([SpeciesIdSchema, FormIdSchema]),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  formLabel: z.string().min(1).nullable(),
}).strict()

export const AbilityLocalizationEntrySchema = z.object({
  entityId: AbilityIdSchema,
  name: z.string().min(1),
  shortDescription: z.string().min(1).optional(),
}).strict()

export const CoreLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(CoreLocalizationEntrySchema),
}).strict()

export const AbilityLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(AbilityLocalizationEntrySchema),
}).strict()

export const SmokeLocalizationSchema = z.object({
  core: CoreLocalizationSchema,
  abilities: AbilityLocalizationSchema,
}).strict()

export const SmokeDatasetSchema = z.object({
  types: z.array(TypeSchema),
  natures: z.array(NatureSchema),
  species: z.array(SpeciesSchema),
  forms: z.array(FormSchema),
  abilities: z.array(AbilitySchema),
  growthRates: z.array(GrowthRateSchema),
}).strict()

export const ValidationIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['warning', 'error']),
  message: z.string().min(1),
}).strict()

export const SmokeReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceCommits: z.object({
    pokemonShowdown: SourceCommitSchema,
    pokemonDatasetZh: SourceCommitSchema,
  }).strict(),
  status: z.enum(['passed', 'failed']),
  counts: z.object({
    types: z.number().int().nonnegative(),
    natures: z.number().int().nonnegative(),
    species: z.number().int().nonnegative(),
    forms: z.number().int().nonnegative(),
    abilities: z.number().int().nonnegative(),
    growthRates: z.number().int().nonnegative(),
  }).strict(),
  scopeNotes: z.array(z.string()),
  issues: z.array(ValidationIssueSchema),
}).strict()

export const SmokeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  dataVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  sources: z.array(z.object({
    id: z.enum(['pokemon-showdown', 'pokemon-dataset-zh']),
    commit: SourceCommitSchema,
  }).strict()).length(2),
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: Sha256Schema,
  }).strict()),
}).strict()

export type Availability = z.infer<typeof AvailabilitySchema>
export type TypeEntity = z.infer<typeof TypeSchema>
export type Nature = z.infer<typeof NatureSchema>
export type Ability = z.infer<typeof AbilitySchema>
export type GrowthRate = z.infer<typeof GrowthRateSchema>
export type GrowthRateId = z.infer<typeof GrowthRateIdSchema>
export type GrowthRateResolution = z.infer<typeof GrowthRateResolutionSchema>
export type Species = z.infer<typeof SpeciesSchema>
export type Form = z.infer<typeof FormSchema>
export type SourceReference = z.infer<typeof SourceReferenceSchema>
export type IdentityMatch = z.infer<typeof IdentityMatchSchema>
export type ValueProvenance = z.infer<typeof ValueProvenanceSchema>
export type SmokeDataset = z.infer<typeof SmokeDatasetSchema>
export type SmokeReport = z.infer<typeof SmokeReportSchema>
export type CoreLocalizationEntry = z.infer<typeof CoreLocalizationEntrySchema>
export type AbilityLocalizationEntry = z.infer<typeof AbilityLocalizationEntrySchema>
export type SmokeLocalization = z.infer<typeof SmokeLocalizationSchema>
