import { z } from 'zod'

const TagSpeciesIdSchema = z.string().regex(/^species:\d{4}$/)
const TagFormIdSchema = z.string().regex(/^form:\d{4}:[a-z0-9-]+$/)

export const TagIdSchema = z.enum([
  'tag:starter',
  'tag:major-legendary',
  'tag:minor-legendary',
  'tag:mythical',
  'tag:pseudo-legendary',
  'tag:fossil',
  'tag:ultra-beast',
  'tag:paradox',
  'tag:mega',
  'tag:primal',
])

export const TagDefinitionSchema = z.object({
  tagId: TagIdSchema,
  canonicalName: z.object({ en: z.string().min(1) }).strict(),
  appliesTo: z.enum(['species', 'form']),
  descriptionKey: z.string().regex(/^tag-description:[a-z0-9-]+$/),
}).strict()

export const TagAssignmentSchema = z.object({
  assignmentId: z.string().regex(/^tag-assignment:[a-z0-9:-]+$/),
  entityId: z.union([TagSpeciesIdSchema, TagFormIdSchema]),
  tagId: TagIdSchema,
  status: z.literal('accepted'),
  mappingClass: z.enum(['automatic', 'rule-based', 'manual-exception']),
  rationale: z.string().min(1),
  sourceEvidence: z.object({
    sourceId: z.literal('excel'),
    workbookSha256: z.string().regex(/^[0-9a-f]{64}$/),
    locators: z.array(z.string().min(1)).min(1),
  }).strict(),
  review: z.object({
    status: z.literal('accepted-for-tags-migration'),
    basis: z.string().min(1),
  }).strict(),
}).strict()

export const UnresolvedTagRowSchema = z.object({
  unresolvedId: z.string().regex(/^tag-unresolved:[a-z0-9:-]+$/),
  tagId: TagIdSchema,
  sourceLabel: z.string().min(1),
  nationalDexNumber: z.number().int().positive(),
  sourceName: z.string().min(1),
  sourceLocators: z.array(z.string().min(1)).min(1),
  candidateEntityIds: z.array(TagFormIdSchema).min(2),
  reason: z.literal('non-unique-form-match'),
  status: z.literal('unresolved'),
  rationale: z.string().min(1),
  review: z.object({
    status: z.literal('quarantined-for-tags-migration'),
    basis: z.string().min(1),
  }).strict(),
}).strict()

export const TagLocalizationSchema = z.object({
  locale: z.literal('zh-CN'),
  entries: z.array(z.object({ tagId: TagIdSchema, name: z.string().min(1) }).strict()),
}).strict()

export const TagsDataSchema = z.object({
  schemaVersion: z.literal(1),
  definitions: z.array(TagDefinitionSchema),
  localization: TagLocalizationSchema,
  assignments: z.array(TagAssignmentSchema),
  unresolved: z.array(UnresolvedTagRowSchema),
  audit: z.object({
    sourceSheets: z.array(z.object({ sheet: z.string().min(1), column: z.string().min(1), role: z.enum(['primary', 'derived-copy', 'implicit-cross-check']) }).strict()),
    sourceRowCounts: z.record(TagIdSchema, z.number().int().nonnegative()),
    duplicateSourceRows: z.record(TagIdSchema, z.number().int().nonnegative()),
    derivedCopyRowCounts: z.record(TagIdSchema, z.number().int().nonnegative()),
    contradictions: z.array(z.object({ entityId: z.string().min(1), tagIds: z.array(TagIdSchema).min(2) }).strict()),
  }).strict(),
}).strict()

export const CanonicalTagAssignmentSchema = z.object({
  entityId: z.union([TagSpeciesIdSchema, TagFormIdSchema]),
  tagId: TagIdSchema,
}).strict()

export const CanonicalTagsDataSchema = z.object({
  schemaVersion: z.literal(1),
  definitions: z.array(TagDefinitionSchema),
  localization: TagLocalizationSchema,
  assignments: z.array(CanonicalTagAssignmentSchema),
}).strict()

export type TagId = z.infer<typeof TagIdSchema>
export type TagDefinition = z.infer<typeof TagDefinitionSchema>
export type TagAssignment = z.infer<typeof TagAssignmentSchema>
export type TagsData = z.infer<typeof TagsDataSchema>
export type CanonicalTagsData = z.infer<typeof CanonicalTagsDataSchema>
