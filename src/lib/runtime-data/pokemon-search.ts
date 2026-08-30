import type { RuntimeForm, RuntimeSpecies } from './types.js'

export type PokemonSearchResult = {
  kind: 'species' | 'form'
  species: RuntimeSpecies
  form: RuntimeForm | null
  rank: number
}

type SearchData = Pick<RuntimeSpecies, 'speciesId' | 'nationalDexNumber' | 'canonicalName' | 'zhName' | 'defaultFormId' | 'formIds' | 'growthRate' | 'tagIds'>[]

function textRank(value: string | null, query: string): number | null {
  if (!value) return null
  const normalized = value.toLocaleLowerCase()
  if (normalized === query) return 0
  if (normalized.startsWith(query)) return 1
  if (normalized.includes(query)) return 2
  // English Form names are commonly written with spaces while canonical names
  // use hyphens. Normalize only separators, never edit or fuzz name letters.
  const compactValue = normalized.replace(/[\s_-]/g, '')
  const compactQuery = query.replace(/[\s_-]/g, '')
  if (compactQuery && compactValue.includes(compactQuery)) return 2
  return null
}

function resultRank(species: RuntimeSpecies, form: RuntimeForm | null, query: string): number | null {
  const dexRank = String(species.nationalDexNumber) === query ? 0 : null
  const names = form ? [form.zhName, form.canonicalName, species.zhName, species.canonicalName] : [species.zhName, species.canonicalName]
  const ranks = names.map(name => textRank(name, query)).filter((rank): rank is number => rank !== null)
  return [dexRank, ...ranks].filter((rank): rank is number => rank !== null).sort((left, right) => left - right)[0] ?? null
}

export function searchPokemon(query: string, species: SearchData, forms: RuntimeForm[]): PokemonSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return []
  const formsBySpecies = new Map<string, RuntimeForm[]>()
  for (const form of forms) formsBySpecies.set(form.speciesId, [...(formsBySpecies.get(form.speciesId) ?? []), form])
  const results: PokemonSearchResult[] = []
  for (const item of species as RuntimeSpecies[]) {
    const speciesRank = resultRank(item, null, normalized)
    if (speciesRank !== null) results.push({ kind: 'species', species: item, form: null, rank: speciesRank })
    for (const form of formsBySpecies.get(item.speciesId) ?? []) {
      if (form.formId === item.defaultFormId) continue
      const formRank = resultRank(item, form, normalized)
      if (formRank !== null) results.push({ kind: 'form', species: item, form, rank: formRank })
    }
  }
  return results.sort((left, right) => left.rank - right.rank
    || (left.kind === right.kind ? 0 : left.kind === 'species' ? -1 : 1)
    || left.species.nationalDexNumber - right.species.nationalDexNumber
    || (left.form?.canonicalName ?? left.species.canonicalName).localeCompare(right.form?.canonicalName ?? right.species.canonicalName, 'en'))
}

export function resolveSearchResult(result: PokemonSearchResult): { species: RuntimeSpecies; formId: string } {
  return { species: result.species, formId: result.form?.formId ?? result.species.defaultFormId }
}

export function orderedSpeciesForms(species: RuntimeSpecies, forms: RuntimeForm[]): RuntimeForm[] {
  const byId = new Map(forms.map(form => [form.formId, form]))
  return species.formIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []).sort((left, right) =>
    (left.formId === species.defaultFormId ? -1 : right.formId === species.defaultFormId ? 1 : left.canonicalName.localeCompare(right.canonicalName, 'en')))
}

export function baseStatTotal(form: RuntimeForm): number {
  return Object.values(form.baseStats).reduce((total, value) => total + value, 0)
}
