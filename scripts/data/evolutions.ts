import {
  AppearanceSchema,
  EvolutionEdgeSchema,
  IdentityMatchSchema,
  ValueProvenanceSchema,
  type Appearance,
  type EvolutionCondition,
  type EvolutionEdge,
  type IdentityMatch,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'
import type { PokemonDatasetZhAdapterOutput, ZhEvolutionCandidate } from './pokemon-dataset-zh.ts'
import { parsePokedexRecord, type RegistryEntity, type ShowdownSourceData, type VerifiedSource } from './source.ts'

type MappingClass = IdentityMatch['mappingClass']

interface EdgeDefinition {
  sourceShowdownId: string
  targetShowdownId: string
  sourceFormId: string
  targetFormId: string
  methodToken: string
  mappingClass: MappingClass
  resultAppearanceId: string | null
  dataStatus: EvolutionEdge['dataStatus']
  conditions: EvolutionCondition[]
}

interface AppearanceDefinition {
  appearanceId: string
  showdownId: string
  chineseName: string
  cream: string
  sweet: string
}

export interface EvolutionConflict {
  code: string
  evolutionId: string
  severity: 'warning' | 'error'
  structuredValue: unknown
  localizedRawValue: string
  resolution: 'structured-selected-raw-preserved'
}

export interface EvolutionBuildResult {
  evolutions: EvolutionEdge[]
  appearances: Appearance[]
  localizationEntries: Array<{ entityId: string; conditionText: string }>
  identityMatches: IdentityMatch[]
  valueProvenance: ValueProvenance[]
  conflicts: EvolutionConflict[]
  mappingCounts: { automatic: number; ruleBased: number; manualException: number; unresolved: number }
}

const APPEARANCE_DEFINITIONS: AppearanceDefinition[] = [
  {
    appearanceId: 'appearance:0869:vanilla-cream:strawberry-sweet',
    showdownId: 'alcremie',
    chineseName: '霜奶仙-奶香香草-草莓糖饰',
    cream: 'vanilla-cream',
    sweet: 'strawberry-sweet',
  },
  {
    appearanceId: 'appearance:0869:ruby-cream:strawberry-sweet',
    showdownId: 'alcremierubycream',
    chineseName: '霜奶仙-奶香红钻-草莓糖饰',
    cream: 'ruby-cream',
    sweet: 'strawberry-sweet',
  },
  {
    appearanceId: 'appearance:0869:matcha-cream:strawberry-sweet',
    showdownId: 'alcremiematchacream',
    chineseName: '霜奶仙-奶香抹茶-草莓糖饰',
    cream: 'matcha-cream',
    sweet: 'strawberry-sweet',
  },
]

function raw(textKey: string): EvolutionCondition {
  return { kind: 'raw', textKey }
}

function textKey(source: string, target: string, method: string): string {
  return `evolution-text:${source.replaceAll(':', '-')}:${target.replaceAll(':', '-')}:${method}`
}

function edgeId(source: string, target: string, method: string): string {
  const sourceToken = source.replace(/^form:/, '').replaceAll(':', '-')
  const targetToken = target.replace(/^form:/, '').replaceAll(':', '-')
  return `evolution:${sourceToken}:${targetToken}:${method}`
}

const EEVEE_DEFINITIONS: EdgeDefinition[] = [
  ['vaporeon', 'form:0134:base', 'water-stone', [{ kind: 'item', itemId: 'item:water-stone' }]],
  ['jolteon', 'form:0135:base', 'thunder-stone', [{ kind: 'item', itemId: 'item:thunder-stone' }]],
  ['flareon', 'form:0136:base', 'fire-stone', [{ kind: 'item', itemId: 'item:fire-stone' }]],
  ['espeon', 'form:0196:base', 'friendship-day', [
    { kind: 'level', minimum: null }, { kind: 'friendship', metric: 'friendship', minimum: null }, { kind: 'time', value: 'day' },
  ]],
  ['umbreon', 'form:0197:base', 'friendship-night', [
    { kind: 'level', minimum: null }, { kind: 'friendship', metric: 'friendship', minimum: null }, { kind: 'time', value: 'night' },
  ]],
  ['leafeon', 'form:0470:base', 'leaf-stone', [{ kind: 'item', itemId: 'item:leaf-stone' }]],
  ['glaceon', 'form:0471:base', 'ice-stone', [{ kind: 'item', itemId: 'item:ice-stone' }]],
  ['sylveon', 'form:0700:base', 'affection-fairy-move', [
    { kind: 'level', minimum: null },
    { kind: 'friendship', metric: 'affection', minimum: null },
    { kind: 'move-known', typeId: 'type:fairy' },
  ]],
].map(([targetShowdownId, targetFormId, methodToken, conditions]) => ({
  sourceShowdownId: 'eevee',
  targetShowdownId: targetShowdownId as string,
  sourceFormId: 'form:0133:base',
  targetFormId: targetFormId as string,
  methodToken: methodToken as string,
  mappingClass: 'automatic',
  resultAppearanceId: null,
  dataStatus: 'complete',
  conditions: conditions as EvolutionCondition[],
}))

const KADABRA_DEFINITION: EdgeDefinition = {
  sourceShowdownId: 'kadabra',
  targetShowdownId: 'alakazam',
  sourceFormId: 'form:0064:base',
  targetFormId: 'form:0065:base',
  methodToken: 'trade',
  mappingClass: 'rule-based',
  resultAppearanceId: null,
  dataStatus: 'partial',
  conditions: [{ kind: 'trade' }],
}

const MILCERY_DEFINITIONS: EdgeDefinition[] = APPEARANCE_DEFINITIONS.map(appearance => ({
  sourceShowdownId: 'milcery',
  targetShowdownId: 'alcremie',
  sourceFormId: 'form:0868:base',
  targetFormId: 'form:0869:base',
  methodToken: `spin-${appearance.cream.replace('-cream', '')}-strawberry`,
  mappingClass: 'manual-exception',
  resultAppearanceId: appearance.appearanceId,
  dataStatus: 'partial',
  conditions: [
    { kind: 'held-item', itemId: 'item:strawberry-sweet' },
    { kind: 'spin', direction: 'unknown', minDurationSeconds: null },
  ],
}))

const CONDITION_ORDER = new Map([
  ['level', 0], ['item', 1], ['trade', 2], ['friendship', 3], ['time', 4],
  ['move-known', 5], ['held-item', 6], ['spin', 7], ['raw', 8],
])

function registryEntry(source: VerifiedSource, kind: RegistryEntity['kind'], projectId: string): RegistryEntity {
  const matches = source.registry.filter(entity => entity.kind === kind && entity.projectId === projectId)
  if (matches.length !== 1) throw new Error(`EVOLUTION_REGISTRY_CONFLICT: ${kind} ${projectId} matched ${matches.length} entries`)
  return matches[0]
}

function showdownReference(source: VerifiedSource): string {
  const reference = source.sourceReferenceByPath.get('data/pokedex.ts')
  if (!reference) throw new Error('Missing Showdown Pokédex SourceReference')
  return reference.sourceReferenceId
}

function record(data: ShowdownSourceData, showdownId: string) {
  const value = data.pokedex[showdownId]
  if (value === undefined) throw new Error(`Missing evolution Pokédex record: ${showdownId}`)
  return parsePokedexRecord(value, showdownId)
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function structuredConditionPointer(condition: EvolutionCondition, targetPointer: string): string {
  if (condition.kind === 'item') return `${targetPointer}/evoItem`
  if (condition.kind === 'trade' || condition.kind === 'level') return `${targetPointer}/evoType`
  if (condition.kind === 'friendship' && condition.metric === 'friendship') return `${targetPointer}/evoType`
  return `${targetPointer}/evoCondition`
}

function rawCandidate(
  definition: EdgeDefinition,
  data: ShowdownSourceData,
  zh: PokemonDatasetZhAdapterOutput,
): ZhEvolutionCandidate | undefined {
  const sourceRecord = record(data, definition.sourceShowdownId)
  const targetRecord = record(data, definition.targetShowdownId)
  const sourceZh = zh.species.find(candidate => candidate.nationalDexNumber === sourceRecord.num)
  const targetZh = zh.species.find(candidate => candidate.nationalDexNumber === targetRecord.num)
  if (!sourceZh || !targetZh) throw new Error(`EVOLUTION_ZH_SPECIES_MISSING: ${definition.sourceShowdownId} -> ${definition.targetShowdownId}`)
  const matches = zh.evolutions.filter(candidate => candidate.documentNationalDexNumber === sourceRecord.num
    && candidate.sourceNameZh === sourceZh.chineseName
    && candidate.targetNameZh === targetZh.chineseName)
  if (matches.length > 1) throw new Error(`EVOLUTION_RAW_TEXT_CONFLICT: ${definition.sourceShowdownId} -> ${definition.targetShowdownId} matched ${matches.length}`)
  return matches[0]
}

function validateGraph(definition: EdgeDefinition, data: ShowdownSourceData): void {
  const source = record(data, definition.sourceShowdownId)
  const target = record(data, definition.targetShowdownId)
  if (!source.evos?.some(name => normalized(name) === definition.targetShowdownId)) {
    throw new Error(`EVOLUTION_GRAPH_SOURCE_MISMATCH: ${definition.sourceShowdownId} lacks ${definition.targetShowdownId}`)
  }
  if (!target.prevo || normalized(target.prevo) !== definition.sourceShowdownId) {
    throw new Error(`EVOLUTION_GRAPH_TARGET_MISMATCH: ${definition.targetShowdownId} prevo is not ${definition.sourceShowdownId}`)
  }
}

export function assertUniqueEvolutionMappings(edges: EvolutionEdge[]): void {
  const ids = new Set<string>()
  const methods = new Set<string>()
  for (const edge of edges) {
    if (ids.has(edge.evolutionId)) throw new Error(`DUPLICATE_EVOLUTION_ID: ${edge.evolutionId}`)
    ids.add(edge.evolutionId)
    const key = `${edge.source.kind}:${edge.source.id}:${edge.target.kind}:${edge.target.id}:${edge.methodToken}`
    if (methods.has(key)) throw new Error(`NON_UNIQUE_EVOLUTION_MAPPING: ${key}`)
    methods.add(key)
  }
}

export function buildEvolutions(
  data: ShowdownSourceData,
  source: VerifiedSource,
  zh: PokemonDatasetZhAdapterOutput,
): EvolutionBuildResult {
  const definitions = [...EEVEE_DEFINITIONS, KADABRA_DEFINITION, ...MILCERY_DEFINITIONS]
  const pokedexReference = showdownReference(source)
  const evolutions: EvolutionEdge[] = []
  const identities: IdentityMatch[] = []
  const provenance: ValueProvenance[] = []
  const localizationEntries: Array<{ entityId: string; conditionText: string }> = []
  const conflicts: EvolutionConflict[] = []

  const appearanceResults = APPEARANCE_DEFINITIONS.map(definition => {
    const candidate = zh.appearances.find(value => value.nameZh === definition.chineseName)
    if (!candidate) throw new Error(`APPEARANCE_SOURCE_MISSING: ${definition.chineseName}`)
    registryEntry(source, 'appearance', definition.appearanceId)
    const appearance = AppearanceSchema.parse({
      appearanceId: definition.appearanceId,
      speciesId: 'species:0869',
      formId: 'form:0869:base',
      aspects: [
        { dimension: 'cream', value: definition.cream },
        { dimension: 'sweet', value: definition.sweet },
      ],
      dataStatus: 'complete',
    })
    identities.push(IdentityMatchSchema.parse({
      entityId: appearance.appearanceId,
      entityKind: 'appearance',
      showdownId: definition.showdownId,
      mappingClass: 'manual-exception',
      sourceReferenceId: candidate.sourceReferenceId,
    }))
    for (const fieldPath of ['/appearanceId', '/speciesId', '/formId', '/aspects']) {
      provenance.push(ValueProvenanceSchema.parse({
        entityId: appearance.appearanceId,
        fieldPath,
        sourceReferenceId: candidate.sourceReferenceId,
        method: fieldPath === '/aspects' ? 'project-normalization' : 'curated-exception',
        mappingClass: 'manual-exception',
        selected: true,
        sourcePointer: candidate.sourcePointer,
      }))
    }
    return appearance
  })

  for (const definition of definitions) {
    validateGraph(definition, data)
    const id = edgeId(definition.sourceFormId, definition.targetFormId, definition.methodToken)
    registryEntry(source, 'evolution', id)
    const candidate = rawCandidate(definition, data, zh)
    const key = textKey(definition.sourceFormId, definition.targetFormId, definition.methodToken)
    const conditions = [...definition.conditions, ...(candidate ? [raw(key)] : [])]
      .sort((left, right) => (CONDITION_ORDER.get(left.kind) ?? 99) - (CONDITION_ORDER.get(right.kind) ?? 99))
    const edge = EvolutionEdgeSchema.parse({
      evolutionId: id,
      methodToken: definition.methodToken,
      source: { kind: 'form', id: definition.sourceFormId },
      target: { kind: 'form', id: definition.targetFormId },
      conditions,
      resultAppearanceId: definition.resultAppearanceId,
      conditionTextKey: candidate ? key : null,
      dataStatus: candidate ? definition.dataStatus : 'partial',
    })
    evolutions.push(edge)
    identities.push(IdentityMatchSchema.parse({
      entityId: edge.evolutionId,
      entityKind: 'evolution',
      showdownId: definition.targetShowdownId,
      mappingClass: definition.mappingClass,
      sourceReferenceId: pokedexReference,
    }))
    const targetPointer = `/${definition.targetShowdownId}`
    const add = (fieldPath: string, reference: string, method: ValueProvenance['method'], pointer: string) => provenance.push(ValueProvenanceSchema.parse({
      entityId: edge.evolutionId,
      fieldPath,
      sourceReferenceId: reference,
      method,
      mappingClass: definition.mappingClass,
      selected: true,
      sourcePointer: pointer,
    }))
    add('/evolutionId', pokedexReference, 'project-normalization', targetPointer)
    add('/source', pokedexReference, 'project-normalization', `${targetPointer}/prevo`)
    add('/target', pokedexReference, 'project-normalization', targetPointer)
    add('/methodToken', pokedexReference, 'project-normalization', `${targetPointer}/evoType`)
    for (const [index, condition] of conditions.entries()) {
      if (condition.kind === 'raw' && candidate) add(`/conditions/${index}`, candidate.sourceReferenceId, 'source-literal', candidate.sourcePointer)
      else if (definition.resultAppearanceId && (condition.kind === 'held-item' || condition.kind === 'spin')) {
        const appearance = zh.appearances.find(value => value.nameZh === APPEARANCE_DEFINITIONS.find(item => item.appearanceId === definition.resultAppearanceId)?.chineseName)
        if (!appearance) throw new Error(`APPEARANCE_PROVENANCE_MISSING: ${definition.resultAppearanceId}`)
        add(`/conditions/${index}`, appearance.sourceReferenceId, 'curated-exception', appearance.sourcePointer)
      } else add(`/conditions/${index}`, pokedexReference, 'project-normalization', structuredConditionPointer(condition, targetPointer))
    }
    if (edge.resultAppearanceId) {
      const appearance = zh.appearances.find(value => value.nameZh === APPEARANCE_DEFINITIONS.find(item => item.appearanceId === edge.resultAppearanceId)?.chineseName)
      if (!appearance) throw new Error(`APPEARANCE_PROVENANCE_MISSING: ${edge.resultAppearanceId}`)
      add('/resultAppearanceId', appearance.sourceReferenceId, 'curated-exception', appearance.sourcePointer)
    }
    if (candidate) {
      add('/conditionTextKey', candidate.sourceReferenceId, 'project-normalization', candidate.sourcePointer)
      add('/localization/zh-CN/conditionText', candidate.sourceReferenceId, 'source-literal', candidate.sourcePointer)
      localizationEntries.push({ entityId: edge.evolutionId, conditionText: candidate.rawText })
    } else {
      add('/conditionTextKey', pokedexReference, 'project-normalization', `${targetPointer}/evoCondition`)
    }

    if (definition === KADABRA_DEFINITION && candidate?.rawText.includes('联系绳')) {
      conflicts.push({
        code: 'ALTERNATE_EVOLUTION_METHOD_PRESERVED',
        evolutionId: edge.evolutionId,
        severity: 'warning',
        structuredValue: { kind: 'trade' },
        localizedRawValue: candidate.rawText,
        resolution: 'structured-selected-raw-preserved',
      })
    }
  }
  assertUniqueEvolutionMappings(evolutions)
  evolutions.sort((left, right) => `${left.source.id}:${left.target.id}:${left.evolutionId}`.localeCompare(`${right.source.id}:${right.target.id}:${right.evolutionId}`, 'en'))
  return {
    evolutions,
    appearances: appearanceResults.sort((left, right) => left.appearanceId.localeCompare(right.appearanceId, 'en')),
    localizationEntries: localizationEntries.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    identityMatches: identities.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    valueProvenance: provenance.sort((left, right) => `${left.entityId}:${left.fieldPath}`.localeCompare(`${right.entityId}:${right.fieldPath}`, 'en')),
    conflicts,
    mappingCounts: { automatic: 8, ruleBased: 1, manualException: 3, unresolved: 0 },
  }
}
