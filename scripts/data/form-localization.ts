export interface StableFormLocalizationTarget {
  formId: string
  speciesId: string
  formLabel: string | null
  types: string[]
  abilities: Record<string, string>
}

export interface ZhFormLocalizationSource {
  name: string
  types: string[]
  abilities: Array<{ name: string }>
}

export interface ZhPokemonLocalizationSource {
  path: string
  value: { forms: ZhFormLocalizationSource[] }
}

export interface ZhAbilityLocalizationSource {
  name_zh: string
  name_en: string
}

const typeIds: Readonly<Record<string, string>> = {
  '一般': 'normal', '格斗': 'fighting', '飞行': 'flying', '毒': 'poison', '地面': 'ground', '岩石': 'rock',
  '虫': 'bug', '幽灵': 'ghost', '钢': 'steel', '火': 'fire', '水': 'water', '草': 'grass', '电': 'electric',
  '超能力': 'psychic', '冰': 'ice', '龙': 'dragon', '恶': 'dark', '妖精': 'fairy',
}

function toId(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '')
    .replaceAll('♀', 'F').replaceAll('♂', 'M').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function signature(types: string[], abilities: string[]): string {
  return `${[...types].sort().join(',')}|${[...abilities].sort().join(',')}`
}

export interface FormLocalizationBuildResult {
  entries: Array<{ entityId: string; name: string; mappingClass: 'automatic' | 'rule-based'; sourcePath: string; sourcePointer: string }>
  unresolvedFormIds: string[]
  sourceOnlyCandidates: Array<{ nationalDexNumber: number; name: string; sourcePath: string; sourcePointer: string }>
  mappingCounts: { base: number; gmax: number; mechanics: number }
}

export function buildFormLocalizations(
  forms: StableFormLocalizationTarget[],
  pokemon: ZhPokemonLocalizationSource[],
  abilities: ZhAbilityLocalizationSource[],
): FormLocalizationBuildResult {
  const abilityEnglishByChinese = new Map<string, Set<string>>()
  for (const ability of abilities) {
    const names = abilityEnglishByChinese.get(ability.name_zh) ?? new Set<string>()
    names.add(toId(ability.name_en))
    abilityEnglishByChinese.set(ability.name_zh, names)
  }
  const entries: FormLocalizationBuildResult['entries'] = []
  const unresolvedFormIds: string[] = []
  const sourceOnlyCandidates: FormLocalizationBuildResult['sourceOnlyCandidates'] = []
  const mappingCounts = { base: 0, gmax: 0, mechanics: 0 }
  for (const [index, record] of pokemon.entries()) {
    const nationalDexNumber = index + 1
    const stableForms = forms.filter(form => Number(form.speciesId.slice(8)) === nationalDexNumber)
    const candidates = record.value.forms.map((form, formIndex) => {
      const abilities = form.abilities.map(ability => abilityEnglishByChinese.get(ability.name))
      const englishAbilities = abilities.map(names => names?.size === 1 ? [...names][0] : null)
      return {
        name: form.name,
        sourcePath: record.path,
        sourcePointer: `/forms/${formIndex}/name`,
        signature: englishAbilities.every((name): name is string => name !== null)
          ? signature(form.types.map(type => typeIds[type] ?? `unknown:${type}`), englishAbilities)
          : null,
      }
    })
    const remaining = new Set(candidates)
    const add = (form: StableFormLocalizationTarget, candidate: typeof candidates[number], mappingClass: 'automatic' | 'rule-based') => {
      entries.push({ entityId: form.formId, name: candidate.name, mappingClass, sourcePath: candidate.sourcePath, sourcePointer: candidate.sourcePointer })
      remaining.delete(candidate)
      if (mappingClass === 'rule-based') mappingCounts.gmax += 1
      else if (form.formId.endsWith(':base')) mappingCounts.base += 1
      else mappingCounts.mechanics += 1
    }
    const base = stableForms.find(form => form.formId.endsWith(':base'))
    if (base && candidates[0]) add(base, candidates[0], 'automatic')
    for (const form of stableForms.filter(candidate => candidate.formLabel === 'Gmax')) {
      const matches = [...remaining].filter(candidate => candidate.name.startsWith('超极巨化'))
      if (matches.length === 1) add(form, matches[0], 'rule-based')
    }
    for (const form of stableForms.filter(form => !entries.some(entry => entry.entityId === form.formId))) {
      const formSignature = signature(form.types.map(type => type.replace(/^type:/, '')), Object.values(form.abilities).map(toId))
      const matches = [...remaining].filter(candidate => candidate.signature === formSignature)
      if (matches.length === 1) add(form, matches[0], 'automatic')
    }
    for (const form of stableForms) if (!entries.some(entry => entry.entityId === form.formId)) unresolvedFormIds.push(form.formId)
    for (const candidate of remaining) sourceOnlyCandidates.push({ nationalDexNumber, name: candidate.name, sourcePath: candidate.sourcePath, sourcePointer: candidate.sourcePointer })
  }
  return {
    entries: entries.sort((left, right) => left.entityId.localeCompare(right.entityId, 'en')),
    unresolvedFormIds: unresolvedFormIds.sort(),
    sourceOnlyCandidates: sourceOnlyCandidates.sort((left, right) => `${left.nationalDexNumber}:${left.sourcePointer}`.localeCompare(`${right.nationalDexNumber}:${right.sourcePointer}`, 'en')),
    mappingCounts,
  }
}
