import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { getProjectRoot } from './source.ts'

export const REVIEW_SOURCE_VERSIONS = {
  'pokemon-showdown': '84d7ceb4f009928221fce7a00e711bab263c5f4e',
  'pokemon-dataset-zh': '82ce04e611d19a12556c3955125b048b36187f52',
  excel: 'aa25849772c7d6ccbf56c24943cf97dbe9c34fae3211826b39a82658ddcb49e5',
} as const

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]))

const ReviewDecisionSchema = z.object({
  decisionId: z.string().regex(/^review:[a-z0-9:-]+$/),
  domain: z.enum(['type-chart', 'ability-identity', 'move', 'evolution']),
  selector: z.record(z.string(), JsonValueSchema).refine(value => Object.keys(value).length > 0, 'Selector must be specific.'),
  conflictReferences: z.array(z.string().min(1)).min(1),
  decision: z.enum(['keep-canonical', 'select-evidenced-official-number-map', 'quarantine-from-current-release']),
  selectedSource: z.string().min(1).nullable(),
  selectedValue: JsonValueSchema,
  observedValue: z.object({ source: z.string().min(1), value: JsonValueSchema, locator: z.string().min(1) }).strict(),
  classification: z.enum([
    'confirmed-legacy-error',
    'confirmed-source-number-error',
    'confirmed-representation-difference',
    'confirmed-current-vs-legacy',
    'reviewed-quarantine',
  ]),
  rationale: z.string().min(40),
  evidence: z.array(z.string().min(10)).min(1),
  status: z.enum(['accepted', 'review-required', 'retired']),
  reviewedBy: z.string().min(1),
  reReviewPolicy: z.string().min(20).optional(),
  applicableSourceVersions: z.array(z.object({
    sourceId: z.enum(['pokemon-showdown', 'pokemon-dataset-zh', 'excel']),
    version: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/),
  }).strict()).min(1),
}).strict().superRefine((decision, context) => {
  const inspect = (value: unknown): void => {
    if (typeof value === 'string' && (value.includes('*') || value.toLowerCase().includes('all-conflicts'))) {
      context.addIssue({ code: 'custom', message: 'Wildcard or broad conflict suppression is forbidden.' })
    } else if (Array.isArray(value)) value.forEach(inspect)
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect)
  }
  inspect(decision.selector)
})

const ReviewDecisionDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  decisions: z.array(ReviewDecisionSchema).min(1),
}).strict().superRefine((document, context) => {
  const ids = document.decisions.map(decision => decision.decisionId)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Review decision IDs must be unique.' })
})

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>

export function parseReviewDecisions(value: unknown): ReviewDecision[] {
  return ReviewDecisionDocumentSchema.parse(value).decisions
}

export function decisionApplicability(
  decision: ReviewDecision,
  versions: Record<string, string> = REVIEW_SOURCE_VERSIONS,
): 'applicable' | 'review-required' {
  return decision.applicableSourceVersions.every(item => versions[item.sourceId] === item.version)
    ? 'applicable' : 'review-required'
}

export async function loadReviewDecisions(): Promise<ReviewDecision[]> {
  const path = resolve(getProjectRoot(), 'data-curated', 'review-decisions.json')
  const decisions = parseReviewDecisions(JSON.parse(await readFile(path, 'utf8')) as unknown)
  for (const decision of decisions) {
    if (decision.status === 'accepted' && decisionApplicability(decision) !== 'applicable') {
      throw new Error(`REVIEW_DECISION_SOURCE_VERSION_CHANGED: ${decision.decisionId}`)
    }
  }
  return decisions
}

export function requireDecision(decisions: ReviewDecision[], decisionId: string): ReviewDecision {
  const decision = decisions.find(item => item.decisionId === decisionId)
  if (!decision || decision.status !== 'accepted') throw new Error(`REVIEW_DECISION_MISSING: ${decisionId}`)
  return decision
}

export function decisionTargetsMove(
  decision: ReviewDecision,
  entityId: string,
  showdownId: string,
): boolean {
  if (decision.domain !== 'move') return false
  return decision.selector.entityId === entityId && decision.selector.showdownId === showdownId
}

export function reviewedAbilityNumber(decisions: ReviewDecision[], showdownId: string, sourceNumber: number): number {
  const decision = decisions.find(item => {
    if (item.status !== 'accepted' || item.domain !== 'ability-identity'
      || item.decision !== 'select-evidenced-official-number-map') return false
    const selectedIds = item.selector.showdownIds
    return item.selector.sourceOfficialNumber === sourceNumber
      && Array.isArray(selectedIds) && selectedIds.includes(showdownId)
  })
  if (!decision) return sourceNumber
  const mapping = decision.selectedValue as Record<string, unknown>
  const reviewed = mapping[showdownId]
  return typeof reviewed === 'number' && Number.isInteger(reviewed) && reviewed > 0 ? reviewed : sourceNumber
}
