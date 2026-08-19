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
export const MoveIdSchema = z.string().regex(/^move:(?:\d{4}|special:[a-z0-9-]+)$/)
export const AppearanceIdSchema = z.string().regex(/^appearance:\d{4}:[a-z0-9-]+(?::[a-z0-9-]+)*$/)
export const EvolutionIdSchema = z.string().regex(/^evolution:[a-z0-9:-]+$/)
export const DexIdSchema = z.string().regex(/^dex:[a-z0-9-]+(?::[a-z0-9-]+)+$/)
export const EntityIdSchema = z.union([
  SpeciesIdSchema,
  FormIdSchema,
  AbilityIdSchema,
  TypeIdSchema,
  NatureIdSchema,
  GrowthRateIdSchema,
  MoveIdSchema,
  AppearanceIdSchema,
  EvolutionIdSchema,
  DexIdSchema,
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

export const AccuracySemanticSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), value: z.number().positive().max(100) }).strict(),
  z.object({ kind: z.literal('always') }).strict(),
  z.object({ kind: z.literal('not-applicable') }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
])

export const NumericSemanticSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('numeric'), value: z.number().positive() }).strict(),
  z.object({ kind: z.literal('variable') }).strict(),
  z.object({ kind: z.literal('not-applicable') }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
])

export const MoveSchema = z.object({
  moveId: MoveIdSchema,
  officialNumber: z.number().int().positive().nullable(),
  showdownId: z.string().regex(/^[a-z0-9]+$/),
  canonicalName: CanonicalNameSchema,
  typeId: TypeIdSchema,
  category: z.enum(['physical', 'special', 'status']),
  basePower: NumericSemanticSchema,
  accuracy: AccuracySemanticSchema,
  pp: NumericSemanticSchema,
  priority: z.number().int(),
  target: z.string().min(1),
  generation: z.number().int().positive(),
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const AppearanceAspectSchema = z.object({
  dimension: z.enum(['glyph', 'cream', 'sweet']),
  value: z.string().regex(/^[a-z0-9-]+$/),
}).strict()

export const AppearanceSchema = z.object({
  appearanceId: AppearanceIdSchema,
  speciesId: SpeciesIdSchema,
  formId: FormIdSchema.nullable(),
  isDefault: z.boolean(),
  aspects: z.array(AppearanceAspectSchema).min(1),
  availability: AvailabilitySchema,
  dataStatus: DataStatusSchema,
}).strict()

export const DexSchema = z.object({
  dexId: DexIdSchema,
  regionId: z.string().regex(/^region:[a-z0-9-]+$/).nullable(),
  gameIds: z.array(z.string().regex(/^game:[a-z0-9-]+$/)),
  versionIds: z.array(z.string().regex(/^version:[a-z0-9-]+$/)),
  subdex: z.string().regex(/^[a-z0-9-]+$/).nullable(),
  scope: z.string().min(1),
  dataStatus: z.literal('complete'),
}).strict()

export const DexEntrySchema = z.object({
  dexId: DexIdSchema,
  regionalNumber: z.string().regex(/^\d{3}$/),
  regionalSortKey: z.string().regex(/^\d{8}$/),
  speciesId: SpeciesIdSchema,
  formId: FormIdSchema.nullable(),
  sourceName: z.string().min(1),
}).strict()

export const EntityRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('species'), id: SpeciesIdSchema }).strict(),
  z.object({ kind: z.literal('form'), id: FormIdSchema }).strict(),
])

export const EvolutionConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), itemId: z.string().regex(/^item:[a-z0-9-]+$/) }).strict(),
  z.object({ kind: z.literal('trade') }).strict(),
  z.object({ kind: z.literal('friendship'), metric: z.enum(['friendship', 'affection', 'either']), minimum: z.number().int().nonnegative().nullable() }).strict(),
  z.object({ kind: z.literal('time'), value: z.enum(['day', 'night', 'unknown']) }).strict(),
  z.object({ kind: z.literal('move-known'), typeId: TypeIdSchema }).strict(),
  z.object({ kind: z.literal('held-item'), itemId: z.string().regex(/^item:[a-z0-9-]+$/) }).strict(),
  z.object({ kind: z.literal('spin'), direction: z.enum(['clockwise', 'counterclockwise', 'either', 'unknown']), minDurationSeconds: z.number().positive().nullable() }).strict(),
  z.object({ kind: z.literal('level'), minimum: z.number().int().positive().nullable() }).strict(),
  z.object({ kind: z.literal('raw'), textKey: z.string().regex(/^evolution-text:[a-z0-9:-]+$/) }).strict(),
])

export const EvolutionEdgeSchema = z.object({
  evolutionId: EvolutionIdSchema,
  methodToken: z.string().regex(/^[a-z0-9-]+$/),
  source: EntityRefSchema,
  target: EntityRefSchema,
  conditions: z.array(EvolutionConditionSchema).min(1),
  resultAppearanceId: AppearanceIdSchema.nullable(),
  conditionTextKey: z.string().regex(/^evolution-text:[a-z0-9:-]+$/).nullable(),
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

export const SourceReferenceIdSchema = z.string().regex(/^src:(pokemon-showdown|pokemon-dataset-zh|local-curated):[0-9a-f]{16}$/)
const UpstreamSourceReferenceSchema = z.object({
  sourceReferenceId: SourceReferenceIdSchema,
  source: z.enum(['pokemon-showdown', 'pokemon-dataset-zh']),
  commit: SourceCommitSchema,
  path: z.string().min(1),
  sha256: Sha256Schema,
}).strict()
const CuratedSourceReferenceSchema = z.object({
  sourceReferenceId: SourceReferenceIdSchema,
  source: z.literal('local-curated'),
  revision: Sha256Schema,
  path: z.string().min(1),
  sha256: Sha256Schema,
}).strict()
export const SourceReferenceSchema = z.discriminatedUnion('source', [
  UpstreamSourceReferenceSchema,
  CuratedSourceReferenceSchema,
])

export const IdentityMatchSchema = z.object({
  entityId: EntityIdSchema,
  entityKind: z.enum(['species', 'form', 'ability', 'type', 'nature', 'move', 'appearance', 'evolution']),
  showdownId: z.string().min(1),
  mappingClass: z.enum(['automatic', 'rule-based', 'manual-exception']),
  sourceReferenceId: SourceReferenceIdSchema,
}).strict()

export const AppearanceMatchSchema = z.object({
  appearanceId: AppearanceIdSchema,
  source: z.enum(['pokemon-showdown', 'pokemon-dataset-zh']),
  upstreamKey: z.string().min(1),
  evidenceKind: z.enum(['cosmetic-identity', 'aspect', 'localization', 'coverage']),
  aspectDimensions: z.array(AppearanceAspectSchema.shape.dimension),
  mappingClass: z.enum(['automatic', 'rule-based', 'manual-exception', 'unresolved']),
  sourceReferenceId: SourceReferenceIdSchema,
}).strict()

export const ValueProvenanceSchema = z.object({
  entityId: EntityIdSchema,
  fieldPath: z.string().startsWith('/'),
  sourceReferenceId: SourceReferenceIdSchema,
  method: z.enum(['source-literal', 'showdown-dex-rule', 'project-normalization', 'curated-exception']),
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

export const MoveLocalizationEntrySchema = z.object({
  entityId: MoveIdSchema,
  name: z.string().min(1),
  shortDescription: z.string().min(1).optional(),
}).strict()

export const MoveLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(MoveLocalizationEntrySchema),
}).strict()

export const EvolutionLocalizationEntrySchema = z.object({
  entityId: EvolutionIdSchema,
  conditionText: z.string().min(1),
}).strict()

export const EvolutionLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(EvolutionLocalizationEntrySchema),
}).strict()

export const AppearanceLocalizationEntrySchema = z.object({
  entityId: AppearanceIdSchema,
  name: z.string().min(1),
  shortLabel: z.string().min(1).optional(),
  aspectLabels: z.array(z.object({
    dimension: AppearanceAspectSchema.shape.dimension,
    value: AppearanceAspectSchema.shape.value,
    label: z.string().min(1),
  }).strict()).min(1),
}).strict()

export const AppearanceLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(AppearanceLocalizationEntrySchema),
}).strict()

export const DexLocalizationEntrySchema = z.object({
  entityId: DexIdSchema,
  name: z.string().min(1),
  shortLabel: z.string().min(1).optional(),
}).strict()

export const DexLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(DexLocalizationEntrySchema),
}).strict()

export const SmokeLocalizationSchema = z.object({
  core: CoreLocalizationSchema,
  abilities: AbilityLocalizationSchema,
  moves: MoveLocalizationSchema,
  evolutions: EvolutionLocalizationSchema,
  appearances: AppearanceLocalizationSchema,
  dexes: DexLocalizationSchema,
}).strict()

export const SmokeDatasetSchema = z.object({
  types: z.array(TypeSchema),
  natures: z.array(NatureSchema),
  species: z.array(SpeciesSchema),
  forms: z.array(FormSchema),
  abilities: z.array(AbilitySchema),
  growthRates: z.array(GrowthRateSchema),
  moves: z.array(MoveSchema),
  appearances: z.array(AppearanceSchema),
  evolutions: z.array(EvolutionEdgeSchema),
  dexes: z.array(DexSchema),
  dexEntries: z.array(DexEntrySchema),
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
    moves: z.number().int().nonnegative(),
    appearances: z.number().int().nonnegative(),
    evolutions: z.number().int().nonnegative(),
    dexes: z.number().int().nonnegative(),
    dexEntries: z.number().int().nonnegative(),
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
export type Move = z.infer<typeof MoveSchema>
export type MoveId = z.infer<typeof MoveIdSchema>
export type AccuracySemantic = z.infer<typeof AccuracySemanticSchema>
export type NumericSemantic = z.infer<typeof NumericSemanticSchema>
export type Appearance = z.infer<typeof AppearanceSchema>
export type AppearanceMatch = z.infer<typeof AppearanceMatchSchema>
export type AppearanceLocalizationEntry = z.infer<typeof AppearanceLocalizationEntrySchema>
export type EvolutionEdge = z.infer<typeof EvolutionEdgeSchema>
export type EvolutionCondition = z.infer<typeof EvolutionConditionSchema>
export type EvolutionId = z.infer<typeof EvolutionIdSchema>
export type Dex = z.infer<typeof DexSchema>
export type DexEntry = z.infer<typeof DexEntrySchema>
export type DexId = z.infer<typeof DexIdSchema>
export type DexLocalizationEntry = z.infer<typeof DexLocalizationEntrySchema>
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
