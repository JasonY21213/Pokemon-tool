import type { PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeGrowthRate, RuntimeManifest, RuntimeMove, RuntimeNature, RuntimeSpecies, RuntimeType } from './types'

const dataRoot = `${import.meta.env.BASE_URL}data`

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${dataRoot}/${path}`)
  if (!response.ok) throw new Error(`无法加载运行时数据：${path}（${response.status}）`)
  return await response.json() as T
}

export async function loadPokemonRuntimeData(): Promise<PokemonRuntimeData> {
  const [species, forms, abilities, types, natures, growthRates, moves, evolutions, manifest] = await Promise.all([
    fetchJson<RuntimeSpecies[]>('species.json'),
    fetchJson<RuntimeForm[]>('forms.json'),
    fetchJson<RuntimeAbility[]>('abilities.json'),
    fetchJson<RuntimeType[]>('types.json'),
    fetchJson<RuntimeNature[]>('natures.json'),
    fetchJson<RuntimeGrowthRate[]>('growth-rates.json'),
    fetchJson<RuntimeMove[]>('moves.json'),
    fetchJson<RuntimeEvolution[]>('evolutions.json'),
    fetchJson<RuntimeManifest>('manifest.json'),
  ])
  return { species, forms, abilities, types, natures, growthRates, moves, evolutions, manifest }
}
