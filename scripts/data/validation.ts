import {
  SmokeLocalizationSchema,
  SmokeDatasetSchema,
  type IdentityMatch,
  type SmokeDataset,
  type SmokeLocalization,
  type SourceReference,
  type ValueProvenance,
} from '../../src/lib/data-model/smoke-schema.ts'

interface ValidationIssue {
  code: string
  severity: 'warning' | 'error'
  message: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort()
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function validateSmokeDataset(
  input: SmokeDataset,
  sourceReferences: SourceReference[],
  identityMatches: IdentityMatch[],
  valueProvenance: ValueProvenance[],
  localization?: SmokeLocalization,
): ValidationResult {
  const dataset = SmokeDatasetSchema.parse(input)
  const issues: ValidationIssue[] = []
  const error = (code: string, message: string) => issues.push({ code, severity: 'error', message })
  const warning = (code: string, message: string) => issues.push({ code, severity: 'warning', message })

  const allEntityIds = [
    ...dataset.types.map(entity => entity.typeId),
    ...dataset.natures.map(entity => entity.natureId),
    ...dataset.species.map(entity => entity.speciesId),
    ...dataset.forms.map(entity => entity.formId),
    ...dataset.abilities.map(entity => entity.abilityId),
    ...dataset.moves.map(entity => entity.moveId),
    ...dataset.appearances.map(entity => entity.appearanceId),
    ...dataset.evolutions.map(entity => entity.evolutionId),
    ...dataset.dexes.map(entity => entity.dexId),
  ]
  for (const id of duplicateValues(allEntityIds)) error('DUPLICATE_ID', `Entity ID occurs more than once: ${id}`)
  for (const number of duplicateValues(dataset.abilities.map(ability => String(ability.officialNumber)))) {
    error('DUPLICATE_ABILITY_NUMBER', `Ability official number occurs more than once: ${number}`)
  }
  for (const number of duplicateValues(dataset.moves.flatMap(move => move.officialNumber === null ? [] : [String(move.officialNumber)]))) {
    error('DUPLICATE_MOVE_NUMBER', `Move official number occurs more than once: ${number}`)
  }
  for (const id of duplicateValues(dataset.growthRates.map(growthRate => growthRate.growthRateId))) {
    error('DUPLICATE_GROWTH_RATE_ID', `GrowthRate ID occurs more than once: ${id}`)
  }
  for (const id of duplicateValues(dataset.evolutions.map(evolution => evolution.evolutionId))) {
    error('DUPLICATE_EVOLUTION_ID', `Evolution ID occurs more than once: ${id}`)
  }
  for (const id of duplicateValues(dataset.appearances.map(appearance => appearance.appearanceId))) {
    error('DUPLICATE_APPEARANCE_ID', `Appearance ID occurs more than once: ${id}`)
  }

  const expectedGrowthRates = new Map([
    ['growth:erratic', 600_000],
    ['growth:fast', 800_000],
    ['growth:medium-fast', 1_000_000],
    ['growth:medium-slow', 1_059_860],
    ['growth:slow', 1_250_000],
    ['growth:fluctuating', 1_640_000],
  ])
  if (dataset.growthRates.length !== expectedGrowthRates.size) {
    error('GROWTH_RATE_COUNT', `Expected six canonical GrowthRates, received ${dataset.growthRates.length}`)
  }
  for (const [id, total] of expectedGrowthRates) {
    const growthRate = dataset.growthRates.find(candidate => candidate.growthRateId === id)
    if (!growthRate || growthRate.level100Total !== total) {
      error('GROWTH_RATE_TOTAL', `${id} must have Lv.100 total ${total}`)
    }
  }
  for (const total of duplicateValues(dataset.growthRates.map(growthRate => String(growthRate.level100Total)))) {
    error('DUPLICATE_GROWTH_RATE_TOTAL', `GrowthRate Lv.100 total occurs more than once: ${total}`)
  }

  const speciesIds = new Set(dataset.species.map(entity => entity.speciesId))
  const formIds = new Set(dataset.forms.map(entity => entity.formId))
  const abilityIds = new Set(dataset.abilities.map(entity => entity.abilityId))
  const typeIds = new Set(dataset.types.map(entity => entity.typeId))
  const growthRateIds = new Set(dataset.growthRates.map(entity => entity.growthRateId))
  const appearanceIds = new Set(dataset.appearances.map(entity => entity.appearanceId))
  const dexIds = new Set(dataset.dexes.map(entity => entity.dexId))
  for (const species of dataset.species) {
    if (species.nationalDexNumber <= 0) error('NON_POSITIVE_NATIONAL_NUMBER', `${species.speciesId} has an invalid national number`)
    const defaultForm = dataset.forms.find(form => form.formId === species.defaultFormId)
    if (!defaultForm || defaultForm.speciesId !== species.speciesId) {
      error('ORPHAN_DEFAULT_FORM', `${species.speciesId} defaultFormId does not resolve within its Species`)
    }
    const baseForms = dataset.forms.filter(form => form.speciesId === species.speciesId && form.formKind === 'base')
    if (baseForms.length !== 1) error('NON_UNIQUE_BASE_FORM', `${species.speciesId} has ${baseForms.length} base Forms`)
    if (species.growthRate.status === 'resolved' && species.growthRate.id && !growthRateIds.has(species.growthRate.id)) {
      error('ORPHAN_GROWTH_RATE', `${species.speciesId} references ${species.growthRate.id}`)
    }
    if (species.growthRate.status === 'unresolved') {
      warning('EXPECTED_UNRESOLVED_GROWTH_RATE', `${species.speciesId} GrowthRate remains unresolved by source evidence`)
    }
  }
  for (const form of dataset.forms) {
    if (!speciesIds.has(form.speciesId)) error('ORPHAN_SPECIES_REFERENCE', `${form.formId} references ${form.speciesId}`)
    for (const referencedType of form.types) {
      if (!typeIds.has(referencedType)) error('ORPHAN_TYPE_REFERENCE', `${form.formId} references ${referencedType}`)
    }
    for (const slot of form.abilities) {
      if (!abilityIds.has(slot.abilityId)) error('ORPHAN_ABILITY_REFERENCE', `${form.formId} references ${slot.abilityId}`)
    }
    for (const slot of duplicateValues(form.abilities.map(ability => ability.slot))) {
      error('DUPLICATE_ABILITY_SLOT', `${form.formId} repeats Ability slot ${slot}`)
    }
    for (const changesFrom of form.changesFromFormIds) {
      if (!formIds.has(changesFrom)) error('ORPHAN_CHANGES_FROM_REFERENCE', `${form.formId} references ${changesFrom}`)
    }
    if (form.requiredAbilityId && !abilityIds.has(form.requiredAbilityId)) {
      error('ORPHAN_REQUIRED_ABILITY', `${form.formId} requires ${form.requiredAbilityId}`)
    }
    if (form.growthRateOverride?.id && !growthRateIds.has(form.growthRateOverride.id)) {
      error('ORPHAN_GROWTH_RATE', `${form.formId} references ${form.growthRateOverride.id}`)
    }
    const owner = dataset.species.find(species => species.speciesId === form.speciesId)
    if (form.growthRateOverride && owner && sameValue(form.growthRateOverride, owner.growthRate)) {
      error('REDUNDANT_GROWTH_RATE_OVERRIDE', `${form.formId} repeats its Species default GrowthRate`)
    }
  }
  for (const showdownId of duplicateValues(dataset.forms.map(form => form.showdownId))) {
    error('NON_UNIQUE_FORM_MAPPING', `Showdown Form ${showdownId} maps to multiple project Forms`)
  }
  for (const move of dataset.moves) {
    if (!typeIds.has(move.typeId)) error('ORPHAN_MOVE_TYPE_REFERENCE', `${move.moveId} references ${move.typeId}`)
  }
  for (const appearance of dataset.appearances) {
    if (!speciesIds.has(appearance.speciesId)) error('ORPHAN_APPEARANCE_SPECIES', `${appearance.appearanceId} references ${appearance.speciesId}`)
    if (appearance.formId && !formIds.has(appearance.formId)) error('ORPHAN_APPEARANCE_FORM', `${appearance.appearanceId} references ${appearance.formId}`)
    const ownerForm = appearance.formId ? dataset.forms.find(form => form.formId === appearance.formId) : undefined
    if (ownerForm && ownerForm.speciesId !== appearance.speciesId) {
      error('APPEARANCE_FORM_SPECIES_MISMATCH', `${appearance.appearanceId} Form belongs to ${ownerForm.speciesId}`)
    }
    for (const dimension of duplicateValues(appearance.aspects.map(aspect => aspect.dimension))) {
      error('DUPLICATE_APPEARANCE_DIMENSION', `${appearance.appearanceId} repeats aspect dimension ${dimension}`)
    }
  }
  const appearanceCombinations = dataset.appearances.map(appearance => {
    const aspects = [...appearance.aspects]
      .sort((left, right) => `${left.dimension}:${left.value}`.localeCompare(`${right.dimension}:${right.value}`, 'en'))
      .map(aspect => `${aspect.dimension}=${aspect.value}`).join('&')
    return `${appearance.speciesId}:${appearance.formId ?? 'none'}:${aspects}`
  })
  for (const combination of duplicateValues(appearanceCombinations)) {
    error('DUPLICATE_APPEARANCE_COMBINATION', `Appearance aspect combination occurs more than once: ${combination}`)
  }
  const appearanceOwners = new Set(dataset.appearances.map(appearance => appearance.formId ?? appearance.speciesId))
  for (const owner of appearanceOwners) {
    const defaults = dataset.appearances.filter(appearance => (appearance.formId ?? appearance.speciesId) === owner && appearance.isDefault)
    if (defaults.length > 1) error('MULTIPLE_DEFAULT_APPEARANCES', `${owner} has ${defaults.length} default Appearances`)
  }
  const evolutionRefExists = (reference: { kind: 'species' | 'form'; id: string }) => reference.kind === 'species'
    ? speciesIds.has(reference.id as never)
    : formIds.has(reference.id as never)
  for (const evolution of dataset.evolutions) {
    if (!evolutionRefExists(evolution.source)) error('ORPHAN_EVOLUTION_SOURCE', `${evolution.evolutionId} source does not resolve`)
    if (!evolutionRefExists(evolution.target)) error('ORPHAN_EVOLUTION_TARGET', `${evolution.evolutionId} target does not resolve`)
    if (evolution.resultAppearanceId && !appearanceIds.has(evolution.resultAppearanceId)) {
      error('ORPHAN_RESULT_APPEARANCE', `${evolution.evolutionId} references ${evolution.resultAppearanceId}`)
    }
    for (const condition of evolution.conditions) {
      if (condition.kind === 'move-known' && !typeIds.has(condition.typeId)) {
        error('ORPHAN_EVOLUTION_TYPE', `${evolution.evolutionId} references ${condition.typeId}`)
      }
    }
  }
  for (const duplicate of duplicateValues(dataset.evolutions.map(edge => `${edge.source.kind}:${edge.source.id}:${edge.target.kind}:${edge.target.id}:${edge.methodToken}`))) {
    error('NON_UNIQUE_EVOLUTION_MAPPING', `Evolution source/target/method occurs more than once: ${duplicate}`)
  }
  if (dataset.evolutions.some(edge => edge.source.kind === 'form' && edge.source.id === 'form:0133:partner')) {
    error('PARTNER_EEVEE_EVOLUTION', 'Partner Eevee must not inherit base Eevee evolution edges')
  }
  for (const showdownId of duplicateValues(dataset.moves.map(move => move.showdownId))) {
    error('NON_UNIQUE_MOVE_MAPPING', `Showdown Move ${showdownId} maps to multiple project Moves`)
  }
  const dexEntryKeys = new Set<string>()
  for (const entry of dataset.dexEntries) {
    if (!dexIds.has(entry.dexId)) error('ORPHAN_DEX_ENTRY_DEX', `${entry.dexId}:${entry.regionalNumber} references a missing Dex`)
    if (!speciesIds.has(entry.speciesId)) error('ORPHAN_DEX_ENTRY_SPECIES', `${entry.dexId}:${entry.regionalNumber} references ${entry.speciesId}`)
    if (entry.formId && !formIds.has(entry.formId)) error('ORPHAN_DEX_ENTRY_FORM', `${entry.dexId}:${entry.regionalNumber} references ${entry.formId}`)
    const owner = entry.formId ? dataset.forms.find(form => form.formId === entry.formId) : undefined
    if (owner && owner.speciesId !== entry.speciesId) error('DEX_ENTRY_FORM_SPECIES_MISMATCH', `${entry.formId} does not belong to ${entry.speciesId}`)
    const key = `${entry.dexId}:${entry.regionalNumber}`
    if (dexEntryKeys.has(key)) error('DUPLICATE_DEX_REGIONAL_NUMBER', `${key} occurs more than once`)
    dexEntryKeys.add(key)
    if (entry.regionalSortKey !== entry.regionalNumber.padStart(8, '0')) error('DEX_SORT_KEY', `${key} has an invalid sort key`)
  }

  if (dataset.types.length !== 18) error('TYPE_COUNT', `Expected 18 standard attack Types, received ${dataset.types.length}`)
  if (dataset.types.some(type => type.typeId === 'type:stellar')) error('STELLAR_SCOPE', 'Stellar must not be mixed into the 18-type smoke matrix')
  if (dataset.natures.length !== 25) error('NATURE_COUNT', `Expected 25 Natures, received ${dataset.natures.length}`)
  for (const nature of dataset.natures) {
    const shouldBeNeutral = nature.plusStat === null && nature.minusStat === null
    if (nature.neutral !== shouldBeNeutral) error('NATURE_NEUTRAL_RULE', `${nature.natureId} has inconsistent neutral fields`)
    if (!nature.neutral && (!nature.plusStat || !nature.minusStat || nature.plusStat === nature.minusStat)) {
      error('NATURE_STAT_RULE', `${nature.natureId} must have two different modified stats`)
    }
  }

  const expectedFormCounts = new Map([['species:0006', 4], ['species:0479', 6], ['species:0678', 2]])
  for (const [speciesId, expected] of expectedFormCounts) {
    const actual = dataset.forms.filter(form => form.speciesId === speciesId).length
    if (actual !== expected) error('FIXTURE_FORM_COUNT', `${speciesId} expected ${expected} Forms, received ${actual}`)
  }

  const form = (id: string) => dataset.forms.find(candidate => candidate.formId === id)
  const charizardBase = form('form:0006:base')
  const megaX = form('form:0006:mega-x')
  const megaY = form('form:0006:mega-y')
  const charizardGmax = form('form:0006:gmax')
  if (!charizardBase || !megaX || !megaY || !charizardGmax) {
    error('CHARIZARD_FIXTURE', 'Charizard base, Mega X, Mega Y, and G-Max must all exist')
  } else {
    if (megaX.requiredItemNames[0] !== 'Charizardite X') error('CHARIZARD_MEGA_X_ITEM', 'Mega X requirement was not preserved')
    if (megaY.requiredItemNames[0] !== 'Charizardite Y') error('CHARIZARD_MEGA_Y_ITEM', 'Mega Y requirement was not preserved')
    if (!charizardGmax.changesFromFormIds.includes(charizardBase.formId)) error('CHARIZARD_GMAX_SOURCE', 'G-Max must change from base Charizard')
    if (!sameValue(charizardGmax.baseStats, charizardBase.baseStats)) error('CHARIZARD_GMAX_STATS', 'G-Max should preserve base stats while remaining a separate Form')
  }

  const rotomBase = form('form:0479:base')
  const rotomForms = dataset.forms.filter(candidate => candidate.speciesId === 'species:0479' && candidate.formKind !== 'base')
  const expectedRotomTypes = new Map([
    ['form:0479:heat', 'type:fire'], ['form:0479:wash', 'type:water'],
    ['form:0479:frost', 'type:ice'], ['form:0479:fan', 'type:flying'], ['form:0479:mow', 'type:grass'],
  ])
  if (!rotomBase || rotomForms.length !== 5) error('ROTOM_FIXTURE', 'Rotom must have base plus five appliance Forms')
  for (const rotomForm of rotomForms) {
    const expectedType = expectedRotomTypes.get(rotomForm.formId)
    if (!expectedType || !rotomForm.types.includes(expectedType)) error('ROTOM_TYPES', `${rotomForm.formId} has the wrong appliance Type`)
    if (!rotomBase || !rotomForm.changesFromFormIds.includes(rotomBase.formId)) error('ROTOM_CHANGES_FROM', `${rotomForm.formId} must change from base Rotom`)
  }

  const meowsticBase = form('form:0678:base')
  const meowsticFemale = form('form:0678:female')
  if (!meowsticBase || !meowsticFemale) {
    error('MEOWSTIC_FIXTURE', 'Male/default and female Meowstic Forms must exist')
  } else {
    if (!sameValue(meowsticBase.baseStats, meowsticFemale.baseStats)) error('MEOWSTIC_STATS', 'Meowstic Forms should share stats in this snapshot')
    const maleHidden = meowsticBase.abilities.find(slot => slot.slot === 'H')?.abilityId
    const femaleHidden = meowsticFemale.abilities.find(slot => slot.slot === 'H')?.abilityId
    if (!maleHidden || !femaleHidden || maleHidden === femaleHidden) error('MEOWSTIC_ABILITY_SLOTS', 'Meowstic hidden Ability difference must be preserved')
  }

  const unownAppearances = dataset.appearances.filter(appearance => appearance.speciesId === 'species:0201')
  const alcremieAppearances = dataset.appearances.filter(appearance => appearance.speciesId === 'species:0869')
  if (unownAppearances.length !== 28) error('UNOWN_APPEARANCE_COUNT', `Expected 28 Unown Appearances, received ${unownAppearances.length}`)
  if (alcremieAppearances.length !== 63) error('ALCREMIE_APPEARANCE_COUNT', `Expected 63 Alcremie Appearances, received ${alcremieAppearances.length}`)
  if (dataset.forms.filter(candidate => candidate.speciesId === 'species:0201').length !== 1) {
    error('UNOWN_FORM_BOUNDARY', 'Unown glyphs must share one mechanics Form')
  }
  if (dataset.forms.filter(candidate => candidate.speciesId === 'species:0869').length !== 2) {
    error('ALCREMIE_FORM_BOUNDARY', 'Alcremie must keep base and G-Max as two Forms')
  }
  const glyphValues = new Set(unownAppearances.flatMap(appearance => appearance.aspects.filter(aspect => aspect.dimension === 'glyph').map(aspect => aspect.value)))
  if (glyphValues.size !== 28 || unownAppearances.some(appearance => appearance.aspects.length !== 1)) {
    error('UNOWN_GLYPH_COVERAGE', 'Unown must have 28 unique one-dimensional glyph Appearances')
  }
  const creams = new Set(alcremieAppearances.flatMap(appearance => appearance.aspects.filter(aspect => aspect.dimension === 'cream').map(aspect => aspect.value)))
  const sweets = new Set(alcremieAppearances.flatMap(appearance => appearance.aspects.filter(aspect => aspect.dimension === 'sweet').map(aspect => aspect.value)))
  if (creams.size !== 9 || sweets.size !== 7 || alcremieAppearances.length !== creams.size * sweets.size) {
    error('ALCREMIE_CARTESIAN_PRODUCT', `Expected complete 9x7 Alcremie aspects, received ${creams.size}x${sweets.size}`)
  }
  if (unownAppearances.filter(appearance => appearance.isDefault).map(appearance => appearance.appearanceId).join() !== 'appearance:0201:a') {
    error('UNOWN_DEFAULT_APPEARANCE', 'Showdown baseForme A must be the sole Unown default Appearance')
  }
  if (alcremieAppearances.some(appearance => appearance.isDefault)) {
    error('ALCREMIE_DEFAULT_APPEARANCE', 'No Alcremie combination may be guessed as default without sweet evidence')
  }

  const referenceIds = new Set(sourceReferences.map(reference => reference.sourceReferenceId))
  for (const duplicate of duplicateValues(sourceReferences.map(reference => reference.sourceReferenceId))) {
    error('DUPLICATE_SOURCE_REFERENCE', `Source reference ID is not unique: ${duplicate}`)
  }
  for (const match of identityMatches) {
    if (!referenceIds.has(match.sourceReferenceId)) error('ORPHAN_IDENTITY_PROVENANCE', `${match.entityId} identity source does not resolve`)
  }
  for (const value of valueProvenance) {
    if (!referenceIds.has(value.sourceReferenceId)) error('ORPHAN_VALUE_PROVENANCE', `${value.entityId}${value.fieldPath} source does not resolve`)
  }
  const matchedEntities = new Set(identityMatches.map(match => match.entityId))
  for (const entityId of allEntityIds) {
    if (!entityId.startsWith('dex:') && !matchedEntities.has(entityId)) error('MISSING_IDENTITY_PROVENANCE', `${entityId} has no IdentityMatch`)
  }
  const provenanceKeys = new Set(valueProvenance.map(value => `${value.entityId}${value.fieldPath}`))
  const requiredFields = new Map<string, string[]>([
    ['type', ['/canonicalName/en', '/damageTaken']],
    ['nature', ['/canonicalName/en', '/plusStat', '/minusStat', '/neutral']],
    ['species', ['/speciesId', '/nationalDexNumber', '/canonicalName/en', '/defaultFormId', '/generation', '/growthRate/id', '/growthRate/status']],
    ['form', ['/formId', '/speciesId', '/canonicalName/en', '/types', '/baseStats', '/abilities', '/generation']],
    ['ability', ['/abilityId', '/officialNumber', '/canonicalName/en', '/generation']],
    ['move', ['/moveId', '/officialNumber', '/showdownId', '/canonicalName/en', '/typeId', '/category', '/basePower', '/accuracy', '/pp', '/priority', '/target', '/generation', '/availability']],
    ['appearance', ['/appearanceId', '/speciesId', '/formId', '/isDefault', '/aspects', '/availability', '/dataStatus']],
    ['evolution', ['/evolutionId', '/source', '/target', '/methodToken', '/conditionTextKey']],
    ['dex', ['/dexId', '/regionId', '/gameIds', '/versionIds', '/subdex', '/scope', '/dataStatus']],
  ])
  for (const entityId of allEntityIds) {
    const kind = entityId.slice(0, entityId.indexOf(':'))
    for (const field of requiredFields.get(kind) ?? []) {
      if (!provenanceKeys.has(`${entityId}${field}`)) error('MISSING_VALUE_PROVENANCE', `${entityId}${field} has no ValueProvenance`)
    }
  }
  for (const entry of dataset.dexEntries) {
    const prefix = `${entry.dexId}/entries/${entry.regionalNumber}/${entry.speciesId}`
    for (const field of ['/regionalNumber', '/speciesId', '/formId']) {
      if (!provenanceKeys.has(`${prefix}${field}`)) error('MISSING_DEX_ENTRY_PROVENANCE', `${prefix}${field} has no ValueProvenance`)
    }
  }
  for (const form of dataset.forms.filter(candidate => candidate.growthRateOverride !== null)) {
    for (const field of ['/growthRateOverride/id', '/growthRateOverride/status']) {
      if (!provenanceKeys.has(`${form.formId}${field}`)) {
        error('MISSING_GROWTH_RATE_PROVENANCE', `${form.formId}${field} has no ValueProvenance`)
      }
    }
  }
  for (const evolution of dataset.evolutions) {
    for (const index of evolution.conditions.keys()) {
      if (!provenanceKeys.has(`${evolution.evolutionId}/conditions/${index}`)) {
        error('MISSING_EVOLUTION_CONDITION_PROVENANCE', `${evolution.evolutionId}/conditions/${index} has no ValueProvenance`)
      }
    }
    if (evolution.resultAppearanceId && !provenanceKeys.has(`${evolution.evolutionId}/resultAppearanceId`)) {
      error('MISSING_EVOLUTION_APPEARANCE_PROVENANCE', `${evolution.evolutionId}/resultAppearanceId has no ValueProvenance`)
    }
  }
  for (const value of valueProvenance.filter(item => item.fieldPath.startsWith('/growthRate'))) {
    if (!value.selected) error('UNSELECTED_GROWTH_RATE_PROVENANCE', `${value.entityId}${value.fieldPath} is not selected`)
    if (!value.sourcePointer?.endsWith('/experience_100')) {
      error('MISSING_GROWTH_RATE_SOURCE_POINTER', `${value.entityId}${value.fieldPath} lacks an experience_100 locator`)
    }
  }

  if (localization) {
    const locale = SmokeLocalizationSchema.parse(localization)
    const canonicalIds = new Set(allEntityIds)
    const localeEntries = [...locale.core.entries, ...locale.abilities.entries, ...locale.moves.entries, ...locale.evolutions.entries, ...locale.appearances.entries, ...locale.dexes.entries]
    for (const id of duplicateValues(localeEntries.map(entry => entry.entityId))) {
      error('DUPLICATE_LOCALIZATION_KEY', `Localization entity occurs more than once: ${id}`)
    }
    for (const entry of localeEntries) {
      if (!canonicalIds.has(entry.entityId)) {
        error('ORPHAN_LOCALIZATION_KEY', `Localization references missing canonical entity ${entry.entityId}`)
      }
    }
    const coreById = new Map(locale.core.entries.map(entry => [entry.entityId, entry]))
    for (const species of dataset.species) {
      const entry = coreById.get(species.speciesId)
      if (!entry?.name) error('MISSING_REQUIRED_SPECIES_LOCALIZATION', `${species.speciesId} requires a zh-CN name`)
    }
    for (const entry of locale.core.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/name`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN name has no ValueProvenance`)
      }
      if (entry.formLabel !== null && !provenanceKeys.has(`${entry.entityId}/localization/zh-CN/formLabel`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN formLabel has no ValueProvenance`)
      }
    }
    for (const entry of locale.abilities.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/name`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN name has no ValueProvenance`)
      }
      if (entry.shortDescription && !provenanceKeys.has(`${entry.entityId}/localization/zh-CN/shortDescription`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN shortDescription has no ValueProvenance`)
      }
    }
    for (const entry of locale.moves.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/name`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN name has no ValueProvenance`)
      }
      if (entry.shortDescription && !provenanceKeys.has(`${entry.entityId}/localization/zh-CN/shortDescription`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN shortDescription has no ValueProvenance`)
      }
    }
    for (const entry of locale.evolutions.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/conditionText`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN condition text has no ValueProvenance`)
      }
    }
    for (const entry of locale.appearances.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/name`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN appearance name has no ValueProvenance`)
      }
      if (entry.shortLabel && !provenanceKeys.has(`${entry.entityId}/localization/zh-CN/shortLabel`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN short label has no ValueProvenance`)
      }
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/aspectLabels`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN aspect labels have no ValueProvenance`)
      }
    }
    for (const entry of locale.dexes.entries) {
      if (!provenanceKeys.has(`${entry.entityId}/localization/zh-CN/name`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN Dex name has no ValueProvenance`)
      }
      if (entry.shortLabel && !provenanceKeys.has(`${entry.entityId}/localization/zh-CN/shortLabel`)) {
        error('MISSING_LOCALIZATION_PROVENANCE', `${entry.entityId} zh-CN Dex short label has no ValueProvenance`)
      }
    }
    for (const value of valueProvenance.filter(item => item.fieldPath.startsWith('/localization/'))) {
      if (!value.selected) error('UNSELECTED_LOCALIZATION_PROVENANCE', `${value.entityId}${value.fieldPath} is not selected`)
      if (!value.sourcePointer) error('MISSING_LOCALIZATION_SOURCE_POINTER', `${value.entityId}${value.fieldPath} has no JSON Pointer`)
    }
  }

  const errors = issues.filter(issue => issue.severity === 'error')
  if (errors.length > 0) {
    throw new Error(errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
  }
  return { issues }
}
