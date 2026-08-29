import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildFullDryRun, type FullDryRunArtifacts, type RegistryProposal } from './full-dry-run.ts'
import { getProjectRoot, type RegistryEntity, verifySource } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

export const REGISTRY_REVIEW_BATCH = 'registry-review-round-1' as const
const FORM_REVIEW_BATCH = 'form-review-round-1' as const
type AcceptedReviewClassification = 'safe-bulk-accept' | 'rule-based-accept'
export type ReviewClassification = AcceptedReviewClassification
  | 'manual-review-required' | 'quarantine-reject'

export interface RegistryDocument {
  schemaVersion: 1
  sourceCommit: string
  entities: RegistryEntity[]
}

export function serializeRegistryDocument(document: RegistryDocument): string {
  const entityLines = document.entities.map(entity => {
    const compact = JSON.stringify(entity).replaceAll('{"', '{ "').replaceAll('":[', '": [')
      .replaceAll('":', '": ').replaceAll(',"', ', "').replaceAll('}', ' }')
    return `    ${compact}`
  })
  return `{
  "schemaVersion": ${document.schemaVersion},
  "sourceCommit": "${document.sourceCommit}",
  "entities": [
${entityLines.join(',\n')}
  ]
}
`
}

export interface RegistryReviewRecord extends RegistryProposal {
  mappingClass: string
  reviewClassification: ReviewClassification
  category: string
  rationale: string
  availability?: 'future'
  reviewNote?: string
}

export interface RegistryReviewArtifacts {
  reviewPlan: Record<string, unknown>
  accepted: RegistryReviewRecord[]
  manualReview: RegistryReviewRecord[]
  rejected: RegistryReviewRecord[]
  summary: Record<string, unknown>
  registryBefore: RegistryDocument
  registryAfter: RegistryDocument
}

const KIND_ORDER = ['species', 'form', 'ability', 'move'] as const
const RUIN_IDS = new Set(['vesselofruin', 'tabletsofruin', 'beadsofruin'])
const FUTURE_ABILITY_IDS = new Set(['piercingdrill', 'dragonize', 'eelevate', 'megasol', 'firemane', 'spicyspray'])

function stableRecordSort(left: RegistryReviewRecord, right: RegistryReviewRecord): number {
  return KIND_ORDER.indexOf(left.entityKind) - KIND_ORDER.indexOf(right.entityKind)
    || left.proposedProjectId.localeCompare(right.proposedProjectId, 'en')
}

function entityMap(full: FullDryRunArtifacts): Map<string, Record<string, unknown>> {
  return new Map([...full.species, ...full.forms, ...full.abilities, ...full.moves].map(entity => {
    const id = String(entity.formId ?? entity.abilityId ?? entity.moveId ?? entity.speciesId)
    return [id, entity]
  }))
}

function proposalFromReviewedEntity(entity: RegistryEntity): RegistryProposal | null {
  if (!entity.review || ![REGISTRY_REVIEW_BATCH, FORM_REVIEW_BATCH].includes(entity.review.batchId)) return null
  if (!['species', 'form', 'ability', 'move'].includes(entity.kind)) return null
  return {
    entityKind: entity.kind as RegistryProposal['entityKind'],
    proposedProjectId: entity.projectId,
    immutableAnchors: entity.anchor,
    showdownId: entity.showdownId,
    reason: 'Registry Review Round 1 identity candidate.',
    status: entity.review.proposalStatus,
  }
}

function reviewBatchProposals(full: FullDryRunArtifacts, registry: RegistryDocument): RegistryProposal[] {
  const accepted = registry.entities.map(proposalFromReviewedEntity).filter((value): value is RegistryProposal => value !== null)
  const combined = [...accepted, ...full.registryProposals]
  const unique = new Map(combined.map(proposal => [proposal.proposedProjectId, proposal]))
  return [...unique.values()].sort((left, right) => left.proposedProjectId.localeCompare(right.proposedProjectId, 'en'))
}

function isStandardFormToken(token: string): { classification: ReviewClassification; category: string } | null {
  if (token === 'base') return { classification: 'safe-bulk-accept', category: 'base-form' }
  if (/^(alola|galar|hisui|paldea)$/.test(token)) return { classification: 'rule-based-accept', category: 'regional-form' }
  if (/^mega(?:-[xyz])?$/.test(token)) return { classification: 'rule-based-accept', category: 'standard-mega' }
  if (token === 'primal') return { classification: 'rule-based-accept', category: 'primal-form' }
  if (token === 'gmax') return { classification: 'rule-based-accept', category: 'standard-gmax' }
  return null
}

export function classifyRegistryProposal(
  proposal: RegistryProposal,
  entity: Record<string, unknown> | undefined,
): RegistryReviewRecord {
  const base = { ...proposal, mappingClass: String(entity?.mappingClass ?? 'unresolved') }
  if (!entity || proposal.status === 'review-required' && proposal.entityKind !== 'ability') {
    return { ...base, reviewClassification: 'quarantine-reject', category: 'unresolved-identity', rationale: 'Identity evidence is unresolved; active registry acceptance is forbidden.' }
  }
  if (proposal.entityKind === 'species') {
    const number = proposal.immutableAnchors.nationalDexNumber
    const expected = typeof number === 'number' && number > 0 ? `species:${number.toString().padStart(4, '0')}` : null
    const valid = expected === proposal.proposedProjectId && /^species:\d{4}$/.test(proposal.proposedProjectId)
    return valid
      ? { ...base, reviewClassification: 'safe-bulk-accept', category: 'positive-national-dex', rationale: 'Positive unique National Dex anchor deterministically defines the project Species ID.' }
      : { ...base, reviewClassification: 'quarantine-reject', category: 'non-official-or-invalid-national-anchor', rationale: 'CAP, Custom, negative, or malformed National Dex identities cannot enter the official Species namespace.' }
  }
  if (proposal.entityKind === 'ability') {
    const number = proposal.immutableAnchors.officialNumber
    const valid = typeof number === 'number' && number > 0 && proposal.proposedProjectId === `ability:${number.toString().padStart(4, '0')}`
    if (!valid) return { ...base, reviewClassification: 'quarantine-reject', category: 'invalid-official-number-anchor', rationale: 'Ability identity lacks a valid deterministic official-number anchor.' }
    if (RUIN_IDS.has(proposal.showdownId)) return { ...base, reviewClassification: 'rule-based-accept', category: 'reviewed-ability-0284-map', rationale: 'Accepted fixed-source review decision selects the evidenced 284/286/287 identity mapping.', reviewNote: 'Uses review:ability:ruin-number-collision:0284.' }
    if (FUTURE_ABILITY_IDS.has(proposal.showdownId)) return { ...base, reviewClassification: 'rule-based-accept', category: 'future-identity-release-separated', rationale: 'Official number, English identity, and Showdown ID are stable; missing localization affects release readiness, not identity.', availability: 'future', reviewNote: 'Future identity accepted; localization/release readiness remains unresolved.' }
    return { ...base, reviewClassification: 'safe-bulk-accept', category: 'official-numbered-ability', rationale: 'Unique positive official number and Showdown identity deterministically define the Ability ID.' }
  }
  if (proposal.entityKind === 'move') {
    const official = proposal.immutableAnchors.officialNumber
    if (typeof official === 'number' && official > 0 && proposal.proposedProjectId === `move:${official.toString().padStart(4, '0')}`) {
      return { ...base, reviewClassification: 'safe-bulk-accept', category: 'official-numbered-move', rationale: 'Unique positive official number and Showdown identity deterministically define the Move ID.' }
    }
    const token = proposal.immutableAnchors.specialToken
    const validToken = typeof token === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token)
      && proposal.proposedProjectId === `move:special:${token}`
    if (validToken && (/^gmax-/.test(token) || /^hidden-power(?:-|$)/.test(token))) {
      return { ...base, reviewClassification: 'rule-based-accept', category: token.startsWith('gmax-') ? 'gmax-project-token' : 'hidden-power-project-token', rationale: 'Reviewed project-owned token is deterministic from English identity and does not depend on localization or array position.' }
    }
    return { ...base, reviewClassification: 'manual-review-required', category: 'unnumbered-token-review', rationale: 'Unnumbered Move token does not match a reviewed project-owned token family.' }
  }
  const speciesId = proposal.immutableAnchors.speciesId
  const token = proposal.immutableAnchors.formToken
  const expected = typeof speciesId === 'string' && typeof token === 'string' ? `form:${speciesId.slice('species:'.length)}:${token}` : null
  if (expected !== proposal.proposedProjectId || String(proposal.proposedProjectId).startsWith('appearance:')) {
    return { ...base, reviewClassification: 'quarantine-reject', category: 'invalid-form-anchor', rationale: 'Form identity is malformed or belongs to the Appearance domain.' }
  }
  const standard = isStandardFormToken(String(token))
  if (standard) return { ...base, reviewClassification: standard.classification, category: standard.category, rationale: 'Form token belongs to a reviewed deterministic base, regional, Mega, Primal, or G-Max pattern.' }
  const manualCategory = String(speciesId) === 'species:0493' ? 'arceus-type-variants'
    : String(speciesId) === 'species:1017' ? 'ogerpon-mask-and-tera'
      : /(?:battle|complete|eternamax|tera|stellar|terastal|zen|school|hero|blade|busted)/.test(String(token)) ? 'battle-or-transformation-form'
        : /(?:totem|cosplay|original|partner|starter|fancy|pokeball|dada)/.test(String(token)) ? 'special-or-source-granularity'
          : 'nonstandard-form-token'
  return { ...base, reviewClassification: 'manual-review-required', category: manualCategory, rationale: 'Mechanically meaningful Form exists, but its long-term project token or source granularity requires explicit manual stabilization.' }
}

function anchorKey(entity: Pick<RegistryEntity, 'kind' | 'anchor'>): string {
  return `${entity.kind}:${JSON.stringify(Object.fromEntries(Object.entries(entity.anchor).sort(([a], [b]) => a.localeCompare(b, 'en'))))}`
}

export function validateRegistryEntities(entities: RegistryEntity[]): void {
  const ids = new Set<string>(); const external = new Set<string>(); const anchors = new Set<string>()
  for (const entity of entities) {
    const externalKey = `${entity.kind}:${entity.showdownId}`; const immutableKey = anchorKey(entity)
    if (ids.has(entity.projectId)) throw new Error(`REGISTRY_DUPLICATE_PROJECT_ID: ${entity.projectId}`)
    if (KIND_ORDER.includes(entity.kind as typeof KIND_ORDER[number]) && external.has(externalKey)) {
      throw new Error(`REGISTRY_DUPLICATE_EXTERNAL_ID: ${externalKey}`)
    }
    if (anchors.has(immutableKey)) throw new Error(`REGISTRY_DUPLICATE_IMMUTABLE_ANCHOR: ${immutableKey}`)
    ids.add(entity.projectId); external.add(externalKey); anchors.add(immutableKey)
  }
}

function counts(records: RegistryReviewRecord[]): Record<string, number> {
  return Object.fromEntries(KIND_ORDER.map(kind => [kind, records.filter(record => record.entityKind === kind).length]))
}

function mappingCounts(records: RegistryReviewRecord[]): Record<string, number> {
  return Object.fromEntries(['automatic', 'rule-based', 'manual-exception', 'unresolved'].map(mapping => [mapping, records.filter(record => record.mappingClass === mapping).length]))
}

export async function buildRegistryReviewArtifacts(): Promise<RegistryReviewArtifacts> {
  const root = getProjectRoot(); const registry = JSON.parse(await readFile(resolve(root, 'data-curated', 'id-registry.json'), 'utf8')) as RegistryDocument
  const baselineEntities = registry.entities.filter(entity => !entity.review)
  const full = await buildFullDryRun(); const byId = entityMap(full)
  const proposals = reviewBatchProposals(full, registry)
  const reviewedRegistry = new Map(registry.entities.filter(entity => entity.review).map(entity => [entity.projectId, entity]))
  const reviewed = proposals.map(proposal => {
    const stabilized = reviewedRegistry.get(proposal.proposedProjectId)
    if (stabilized?.review?.batchId === FORM_REVIEW_BATCH && proposal.entityKind === 'form') {
      return {
        ...proposal, mappingClass: String(byId.get(proposal.proposedProjectId)?.mappingClass ?? 'unresolved'),
        reviewClassification: stabilized.review.classification,
        category: 'form-review-round1-accepted', rationale: stabilized.review.note,
      } satisfies RegistryReviewRecord
    }
    return classifyRegistryProposal(proposal, byId.get(proposal.proposedProjectId))
  }).sort(stableRecordSort)
  if (reviewed.length !== 3562) throw new Error(`REGISTRY_REVIEW_BATCH_COUNT_MISMATCH: ${reviewed.length}`)
  const accepted = reviewed.filter(record => record.reviewClassification === 'safe-bulk-accept' || record.reviewClassification === 'rule-based-accept')
  const manualReview = reviewed.filter(record => record.reviewClassification === 'manual-review-required')
  const rejected = reviewed.filter(record => record.reviewClassification === 'quarantine-reject')
  const existingIds = new Set(registry.entities.map(entity => entity.projectId)); const source = await verifySource()
  const additions: RegistryEntity[] = accepted.filter(record => !existingIds.has(record.proposedProjectId)).map(record => ({
    kind: record.entityKind, projectId: record.proposedProjectId, anchor: record.immutableAnchors,
    showdownId: record.showdownId, status: 'active', firstSeen: source.commit, lastSeen: source.commit,
    ...(record.availability ? { availability: record.availability } : {}),
    review: { batchId: REGISTRY_REVIEW_BATCH, classification: record.reviewClassification as AcceptedReviewClassification, proposalStatus: record.status, note: record.reviewNote ?? record.rationale },
  }))
  additions.sort((left, right) => KIND_ORDER.indexOf(left.kind as typeof KIND_ORDER[number]) - KIND_ORDER.indexOf(right.kind as typeof KIND_ORDER[number]) || left.projectId.localeCompare(right.projectId, 'en'))
  const registryAfter: RegistryDocument = { ...registry, entities: [...registry.entities, ...additions] }
  validateRegistryEntities(registryAfter.entities)
  const categories = Object.fromEntries([...new Set(reviewed.map(record => record.category))].sort().map(category => [category, reviewed.filter(record => record.category === category).length]))
  const perKind = Object.fromEntries(KIND_ORDER.map(kind => {
    const records = reviewed.filter(record => record.entityKind === kind)
    return [kind, { proposed: records.length, accepted: records.filter(record => accepted.includes(record)).length, manual: records.filter(record => manualReview.includes(record)).length, rejected: records.filter(record => rejected.includes(record)).length }]
  }))
  const summary = { schemaVersion: 1, batchId: REGISTRY_REVIEW_BATCH, proposals: reviewed.length, perKind, registryEntriesBefore: baselineEntities.length, registryEntriesAfter: registryAfter.entities.length, accepted: accepted.length, manualReview: manualReview.length, rejected: rejected.length, blockingIdentityConflicts: rejected.length, pendingManualIdentityReviews: manualReview.length, existingFixtureIdsStable: baselineEntities.every(entity => serializeJson(entity) === serializeJson(registryAfter.entities.find(candidate => candidate.projectId === entity.projectId))), duplicateProjectIds: 0, duplicateExternalIds: 0, duplicateImmutableAnchors: 0 }
  const reviewPlan = { schemaVersion: 1, batchId: REGISTRY_REVIEW_BATCH, proposalCount: reviewed.length, totalsByKind: counts(reviewed), mappingClassCounts: mappingCounts(reviewed), reviewClassCounts: { safeBulk: reviewed.filter(record => record.reviewClassification === 'safe-bulk-accept').length, ruleBased: reviewed.filter(record => record.reviewClassification === 'rule-based-accept').length, manualReview: manualReview.length, rejectedOrQuarantined: rejected.length }, categories, perKind }
  return { reviewPlan, accepted, manualReview, rejected, summary, registryBefore: { ...registry, entities: baselineEntities }, registryAfter }
}

export async function emitRegistryReview(writeRegistry: boolean): Promise<{ artifacts: RegistryReviewArtifacts; hashes: Record<string, string>; outputRoot: string }> {
  const artifacts = await buildRegistryReviewArtifacts(); const outputRoot = resolve(getProjectRoot(), 'generated', 'registry-review')
  const files: Record<string, unknown> = { 'review-plan.json': artifacts.reviewPlan, 'accepted.json': artifacts.accepted, 'manual-review.json': artifacts.manualReview, 'rejected.json': artifacts.rejected, 'summary.json': artifacts.summary }
  const hashes: Record<string, string> = {}
  for (const [name, value] of Object.entries(files)) { await writeJson(join(outputRoot, name), value); hashes[name] = createHash('sha256').update(serializeJson(value)).digest('hex') }
  if (writeRegistry) await writeFile(resolve(getProjectRoot(), 'data-curated', 'id-registry.json'), serializeRegistryDocument(artifacts.registryAfter), 'utf8')
  return { artifacts, hashes, outputRoot }
}
