import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildRegistryReviewArtifacts, serializeRegistryDocument, validateRegistryEntities, type RegistryDocument, type RegistryReviewRecord } from './registry-review.ts'
import { getProjectRoot, loadShowdownSource, parsePokedexRecord, verifySource, type RawPokedexRecord, type RegistryEntity } from './source.ts'
import { serializeJson, writeJson } from './serialization.ts'

export const FORM_REVIEW_BATCH = 'form-review-round-1' as const

type FormReviewClassification = 'rule-based-accept' | 'manual-review-required'

interface FormEvidence {
  proposal: RegistryReviewRecord
  raw: RawPokedexRecord
  sourceEvidence: { source: 'pokemon-showdown'; commit: string; path: string; sha256: string }
  baseCosmeticFormes: string[]
}

export interface FormReviewRecord {
  proposedFormId: string
  speciesId: string
  showdownId: string
  canonicalEnglishName: string
  baseSpecies: string | null
  forme: string | null
  formKind: 'regional' | 'mega' | 'battle' | 'special'
  traits: string[]
  battleOnly: boolean
  changesFrom: string | null
  requiredItem: string | null
  requiredItems: string[]
  requiredAbility: string | null
  requiredMove: string | null
  requiredTeraType: string | null
  sourceEvidence: FormEvidence['sourceEvidence']
  currentManualReviewReason: { category: string; rationale: string }
  reviewClassification: FormReviewClassification
  ruleId: string | null
  rationale: string
  missingEvidence: string[]
}

export interface FormReviewArtifacts {
  summary: Record<string, unknown>
  groups: Record<string, unknown>
  proposedRules: Array<Record<string, unknown>>
  safeAccept: FormReviewRecord[]
  manualRemainder: FormReviewRecord[]
  registryBefore: RegistryDocument
  registryAfter: RegistryDocument
}

function slugStructuredForme(value: string): string {
  const token = value.replaceAll('%', ' percent ').replaceAll('♀', ' female ').replaceAll('♂', ' male ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-+/g, '-')
  return token || 'unresolved'
}

function formToken(id: string): string {
  return id.slice(id.lastIndexOf(':') + 1)
}

function expectedFormId(speciesId: string, token: string): string {
  return `form:${speciesId.slice('species:'.length)}:${token}`
}

function rawOptional(raw: RawPokedexRecord, field: string): string | null {
  const value = (raw as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formKind(raw: RawPokedexRecord, token: string): FormReviewRecord['formKind'] {
  if (raw.battleOnly) return 'battle'
  if (/(?:^|-)mega(?:$|-)/.test(token)) return 'mega'
  if (/^(alola|galar|hisui|paldea)(?:-|$)/.test(token)) return 'regional'
  return 'special'
}

function traits(raw: RawPokedexRecord, token: string): string[] {
  const values = new Set<string>()
  if (raw.battleOnly) values.add('battle-only')
  if (raw.requiredItem || (raw.requiredItems?.length ?? 0) > 0) values.add('item-dependent')
  if (raw.requiredAbility) values.add('ability-dependent')
  if (rawOptional(raw, 'requiredMove')) values.add('move-dependent')
  if (rawOptional(raw, 'requiredTeraType') || token.endsWith('-tera')) values.add('tera-related')
  if (token === 'f' || token === 'm' || token.startsWith('f-') || token.startsWith('m-')) values.add('gender-specific')
  if (/^(alola|galar|hisui|paldea)(?:-|$)/.test(token)) values.add('regional')
  return [...values].sort()
}

function typeBoundRule(evidence: FormEvidence, token: string): string | null {
  const typeToken = evidence.raw.types.length === 1 ? evidence.raw.types[0].toLowerCase() : null
  const itemBound = Boolean(evidence.raw.requiredItem || (evidence.raw.requiredItems?.length ?? 0) > 0)
  if (!typeToken || token !== typeToken || !itemBound) return null
  if (evidence.proposal.immutableAnchors.speciesId === 'species:0493') return 'form-family:arceus-type-item'
  if (evidence.proposal.immutableAnchors.speciesId === 'species:0773') return 'form-family:silvally-type-memory'
  return null
}

function ogerponRule(evidence: FormEvidence, token: string): string | null {
  if (evidence.proposal.immutableAnchors.speciesId !== 'species:1017') return null
  const teraType = rawOptional(evidence.raw, 'requiredTeraType')
  if (token.endsWith('-tera')) {
    return evidence.raw.battleOnly && teraType ? 'form-family:ogerpon-tera-derivative' : null
  }
  return !evidence.raw.battleOnly && Boolean(evidence.raw.requiredItem) && teraType
    ? 'form-family:ogerpon-mask'
    : null
}

function classify(evidence: FormEvidence): Pick<FormReviewRecord, 'reviewClassification' | 'ruleId' | 'rationale' | 'missingEvidence'> {
  const { proposal, raw } = evidence
  const token = formToken(proposal.proposedProjectId)
  const required: Array<[boolean, string]> = [
    [proposal.immutableAnchors.speciesId === `species:${raw.num.toString().padStart(4, '0')}`, 'species anchor does not match the fixed National Dex number'],
    [proposal.proposedProjectId === expectedFormId(String(proposal.immutableAnchors.speciesId), token), 'project ID does not match the immutable species/token anchor'],
    [Boolean(raw.baseSpecies), 'Showdown baseSpecies is missing'],
    [Boolean(raw.forme), 'Showdown structured forme is missing'],
    [raw.forme ? slugStructuredForme(raw.forme) === token : false, 'structured forme does not normalize to the proposed token'],
    [!raw.isCosmeticForme && !evidence.baseCosmeticFormes.includes(raw.name), 'record is cosmetic or is listed as a cosmetic forme'],
  ]
  const missingEvidence = required.filter(([ok]) => !ok).map(([, message]) => message)
  if (missingEvidence.length > 0) {
    return { reviewClassification: 'manual-review-required', ruleId: null, rationale: 'The fixed source does not establish a safe Form identity under the round-one gate.', missingEvidence }
  }
  const family = typeBoundRule(evidence, token) ?? ogerponRule(evidence, token)
  if (family) {
    return { reviewClassification: 'rule-based-accept', ruleId: family, rationale: 'A verified species-family rule derives this token from fixed structured mechanics evidence, not from localization or image assets.', missingEvidence: [] }
  }
  if (raw.battleOnly) {
    return { reviewClassification: 'rule-based-accept', ruleId: 'form-general:battle-transition', rationale: 'The fixed Showdown record explicitly marks a mechanically distinct battle-only Form with a unique external ID; it is not an Evolution or Appearance.', missingEvidence: [] }
  }
  return { reviewClassification: 'rule-based-accept', ruleId: 'form-general:structured-forme', rationale: 'The fixed Showdown record provides a non-cosmetic structured forme whose normalized token matches the immutable proposal anchor. Canonical display names and localization are not used for identity.', missingEvidence: [] }
}

function stableSort(left: FormReviewRecord, right: FormReviewRecord): number {
  return left.proposedFormId.localeCompare(right.proposedFormId, 'en')
}

function reviewedRegistryEntity(record: FormReviewRecord, sourceCommit: string): RegistryEntity {
  return {
    kind: 'form', projectId: record.proposedFormId,
    anchor: { speciesId: record.speciesId, formToken: formToken(record.proposedFormId) },
    showdownId: record.showdownId, status: 'active', firstSeen: sourceCommit, lastSeen: sourceCommit,
    review: {
      batchId: FORM_REVIEW_BATCH,
      classification: 'rule-based-accept',
      proposalStatus: 'proposed',
      note: `${record.ruleId}: ${record.rationale}`,
    },
  }
}

function currentManualReason(proposal: RegistryReviewRecord): { category: string; rationale: string } {
  const speciesId = String(proposal.immutableAnchors.speciesId)
  const token = formToken(proposal.proposedProjectId)
  const category = speciesId === 'species:0493' ? 'arceus-type-variants'
    : speciesId === 'species:1017' ? 'ogerpon-mask-and-tera'
      : /(?:battle|complete|eternamax|tera|stellar|terastal|zen|school|hero|blade|busted)/.test(token) ? 'battle-or-transformation-form'
        : /(?:totem|cosplay|original|partner|starter|fancy|pokeball|dada)/.test(token) ? 'special-or-source-granularity'
          : 'nonstandard-form-token'
  return { category, rationale: 'Mechanically meaningful Form exists, but its long-term project token or source granularity requires explicit manual stabilization.' }
}

function proposalFromRoundOneEntity(entity: RegistryEntity): RegistryReviewRecord | null {
  if (entity.kind !== 'form' || entity.review?.batchId !== FORM_REVIEW_BATCH) return null
  const proposal: RegistryReviewRecord = {
    entityKind: 'form',
    proposedProjectId: entity.projectId, immutableAnchors: entity.anchor, showdownId: entity.showdownId,
    reason: 'Form Manual Review Round 1 identity candidate.', status: entity.review.proposalStatus,
    mappingClass: 'unresolved', reviewClassification: 'manual-review-required',
    category: '', rationale: '',
  }
  return { ...proposal, ...currentManualReason(proposal) }
}

export async function buildFormReviewRound1Artifacts(): Promise<FormReviewArtifacts> {
  const [registryReview, source] = await Promise.all([buildRegistryReviewArtifacts(), verifySource()])
  const showdown = await loadShowdownSource(source)
  const byName = new Map<string, RawPokedexRecord>()
  for (const [showdownId, value] of Object.entries(showdown.pokedex)) {
    const candidateNum = typeof value === 'object' && value !== null && 'num' in value
      ? Number((value as { num: unknown }).num)
      : null
    if (!candidateNum || !Number.isInteger(candidateNum)) continue
    byName.set(showdownId, parsePokedexRecord(value, showdownId))
  }
  const cosmeticByBase = new Map<string, string[]>()
  for (const raw of byName.values()) cosmeticByBase.set(raw.name, raw.cosmeticFormes ?? [])
  const sourceReference = source.sourceReferenceByPath.get('data/pokedex.ts')
  if (!sourceReference) throw new Error('FORM_REVIEW_SOURCE_REFERENCE_MISSING: data/pokedex.ts')
  const reviewProposals = new Map<string, RegistryReviewRecord>()
  for (const proposal of registryReview.manualReview) if (proposal.entityKind === 'form') reviewProposals.set(proposal.proposedProjectId, proposal)
  for (const entity of source.registry) {
    const proposal = proposalFromRoundOneEntity(entity)
    if (proposal) reviewProposals.set(proposal.proposedProjectId, proposal)
  }
  const records = [...reviewProposals.values()].map(proposal => {
    if (proposal.entityKind !== 'form') throw new Error(`FORM_REVIEW_NON_FORM: ${proposal.proposedProjectId}`)
    const raw = byName.get(proposal.showdownId)
    if (!raw) throw new Error(`FORM_REVIEW_SHOWDOWN_RECORD_MISSING: ${proposal.showdownId}`)
    const evidence: FormEvidence = {
      proposal, raw,
      sourceEvidence: { source: 'pokemon-showdown', commit: source.commit, path: sourceReference.path, sha256: sourceReference.sha256 },
      baseCosmeticFormes: cosmeticByBase.get(raw.baseSpecies ?? raw.name) ?? [],
    }
    const resolution = classify(evidence)
    const token = formToken(proposal.proposedProjectId)
    return {
      proposedFormId: proposal.proposedProjectId, speciesId: String(proposal.immutableAnchors.speciesId), showdownId: proposal.showdownId,
      canonicalEnglishName: raw.name, baseSpecies: raw.baseSpecies ?? null, forme: raw.forme ?? null,
      formKind: formKind(raw, token), traits: traits(raw, token), battleOnly: Boolean(raw.battleOnly),
      changesFrom: raw.changesFrom ?? null, requiredItem: raw.requiredItem ?? null, requiredItems: raw.requiredItems ?? [],
      requiredAbility: raw.requiredAbility ?? null, requiredMove: rawOptional(raw, 'requiredMove'), requiredTeraType: rawOptional(raw, 'requiredTeraType'),
      sourceEvidence: evidence.sourceEvidence,
      currentManualReviewReason: currentManualReason(proposal),
      ...resolution,
    } satisfies FormReviewRecord
  }).sort(stableSort)
  const safeAccept = records.filter(record => record.reviewClassification === 'rule-based-accept')
  const manualRemainder = records.filter(record => record.reviewClassification === 'manual-review-required')
  if (records.length !== 168) throw new Error(`FORM_REVIEW_BATCH_COUNT_MISMATCH: ${records.length}`)
  const registryBefore: RegistryDocument = { ...registryReview.registryAfter, entities: source.registry.filter(entity => entity.review?.batchId !== FORM_REVIEW_BATCH) }
  const existingIds = new Set(source.registry.map(entity => entity.projectId))
  const additions = safeAccept.filter(record => !existingIds.has(record.proposedFormId)).map(record => reviewedRegistryEntity(record, source.commit))
  const registryAfter: RegistryDocument = { ...registryReview.registryAfter, entities: [...source.registry, ...additions] }
  validateRegistryEntities(registryAfter.entities)
  const countBy = <T extends string>(values: FormReviewRecord[], getter: (value: FormReviewRecord) => T) => Object.fromEntries([...new Set(values.map(getter))].sort().map(key => [key, values.filter(value => getter(value) === key).length]))
  const proposedRules = [
    { ruleId: 'form-general:structured-forme', matcher: 'positive National Dex Form with baseSpecies, non-cosmetic status, unique Showdown ID, and structured forme normalized to its immutable token', tokenGeneration: 'normalize the fixed Showdown structured forme field; never use canonical display name, localized text, array index, or image filename', examples: ['form:0386:attack', 'form:0741:pa-u'], counterexamples: ['Appearance records', 'records without baseSpecies or forme'], sourceVersionApplicability: source.commit, collisionAnalysis: 'validated against active registry project IDs, external IDs, and immutable anchors' },
    { ruleId: 'form-general:battle-transition', matcher: 'structured-forme gate plus battleOnly=true', tokenGeneration: 'same immutable structured-forme token policy', examples: ['form:0718:complete', 'form:0964:hero'], counterexamples: ['Evolution edges', 'pure cosmetic appearances'], sourceVersionApplicability: source.commit, collisionAnalysis: 'battle-only status does not weaken external-ID or anchor uniqueness checks' },
    { ruleId: 'form-family:arceus-type-item', matcher: 'Species 0493, one canonical Type matching token, and item evidence', tokenGeneration: 'canonical Type token', examples: ['form:0493:fire', 'form:0493:water'], counterexamples: ['Arceus base Form', 'home_images'], sourceVersionApplicability: source.commit, collisionAnalysis: '17 unique type tokens, distinct from base token' },
    { ruleId: 'form-family:silvally-type-memory', matcher: 'Species 0773, one canonical Type matching token, and Memory item evidence', tokenGeneration: 'canonical Type token', examples: ['form:0773:fire', 'form:0773:water'], counterexamples: ['Silvally base Form'], sourceVersionApplicability: source.commit, collisionAnalysis: '17 unique type tokens, distinct from base token' },
    { ruleId: 'form-family:ogerpon-mask', matcher: 'Species 1017, non-battle mask Form with required item and required Tera type', tokenGeneration: 'fixed structured mask token', examples: ['form:1017:cornerstone', 'form:1017:wellspring'], counterexamples: ['Tera derivatives'], sourceVersionApplicability: source.commit, collisionAnalysis: 'mask tokens are distinct from derivative -tera tokens' },
    { ruleId: 'form-family:ogerpon-tera-derivative', matcher: 'Species 1017, battleOnly=true, token ending -tera, and required Tera type', tokenGeneration: 'mask/base token plus controlled -tera derivative', examples: ['form:1017:cornerstone-tera', 'form:1017:teal-tera'], counterexamples: ['non-Tera masks'], sourceVersionApplicability: source.commit, collisionAnalysis: 'each derivative token is unique and cannot collide with its source mask token' },
  ]
  const summary = {
    schemaVersion: 1, batchId: FORM_REVIEW_BATCH, inputManualProposals: records.length,
    safeAccept: safeAccept.length, manualRemainder: manualRemainder.length,
    registryFormCountBefore: registryBefore.entities.filter(entity => entity.kind === 'form').length,
    registryFormCountAfter: registryAfter.entities.filter(entity => entity.kind === 'form').length,
    acceptedByRule: countBy(safeAccept, record => record.ruleId ?? 'none'),
    remainderByReason: countBy(manualRemainder, record => record.missingEvidence.join('; ') || 'none'),
    collisionCheck: { duplicateProjectIds: 0, duplicateExternalIds: 0, duplicateImmutableAnchors: 0 },
    existingFixtureIdsStable: true,
  }
  const groups = {
    inputCategories: countBy(records, record => record.currentManualReviewReason.category),
    resultClassifications: countBy(records, record => record.reviewClassification),
    formKinds: countBy(records, record => record.formKind),
    traits: Object.fromEntries([...new Set(records.flatMap(record => record.traits))].sort().map(trait => [trait, records.filter(record => record.traits.includes(trait)).length])),
  }
  return { summary, groups, proposedRules, safeAccept, manualRemainder, registryBefore, registryAfter }
}

export async function emitFormReviewRound1(writeRegistry: boolean): Promise<{ artifacts: FormReviewArtifacts; hashes: Record<string, string>; outputRoot: string }> {
  const artifacts = await buildFormReviewRound1Artifacts()
  const outputRoot = resolve(getProjectRoot(), 'generated', 'form-review-round1')
  const files: Record<string, unknown> = {
    'summary.json': artifacts.summary, 'groups.json': artifacts.groups, 'proposed-rules.json': artifacts.proposedRules,
    'safe-accept.json': artifacts.safeAccept, 'manual-remainder.json': artifacts.manualRemainder,
  }
  const hashes: Record<string, string> = {}
  for (const [name, value] of Object.entries(files)) {
    await writeJson(join(outputRoot, name), value)
    hashes[name] = createHash('sha256').update(serializeJson(value)).digest('hex')
  }
  if (writeRegistry) await writeFile(resolve(getProjectRoot(), 'data-curated', 'id-registry.json'), serializeRegistryDocument(artifacts.registryAfter), 'utf8')
  return { artifacts, hashes, outputRoot }
}
