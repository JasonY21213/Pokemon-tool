/// <reference types="vite/client" />
import type { PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeGrowthRate, RuntimeItem, RuntimeLearnsets, RuntimeManifest, RuntimeMove, RuntimeNature, RuntimeSpecies, RuntimeType } from './types.ts'
import { RUNTIME_DATA_FILES, RuntimeDataIntegrityError, runtimeDataUrl, validateLoadedRuntimeData, validateRuntimeManifest } from './integrity.ts'

export class RuntimeDataLoadError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RuntimeDataLoadError'
    this.code = code
  }
}

async function fetchJson(path: string, baseUrl: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response
  try { response = await fetcher(runtimeDataUrl(baseUrl, path)) }
  catch (cause) { throw new RuntimeDataLoadError('NETWORK', '无法连接到站点数据，请检查网络或静态托管配置。', { cause }) }
  if (!response.ok) {
    const message = path === 'manifest.json'
      ? '无法加载数据清单，请确认站点已完整发布。'
      : '运行时数据不完整，请重新发布完整的 data 目录。'
    throw new RuntimeDataLoadError('HTTP', message, { cause: new Error(`${path}: HTTP ${response.status}`) })
  }
  try { return await response.json() }
  catch (cause) { throw new RuntimeDataLoadError('MALFORMED_JSON', '运行时数据格式损坏，请重新生成并发布数据。', { cause }) }
}

export async function loadPokemonRuntimeDataFrom(baseUrl: string, fetcher: typeof fetch = fetch): Promise<PokemonRuntimeData> {
  let manifest: RuntimeManifest
  try { manifest = validateRuntimeManifest(await fetchJson('manifest.json', baseUrl, fetcher)) }
  catch (cause) {
    if (cause instanceof RuntimeDataLoadError) throw cause
    throw new RuntimeDataLoadError('INCOMPATIBLE_MANIFEST', '运行时数据版本不兼容，请重新构建并发布站点。', { cause })
  }
  const values = await Promise.all(RUNTIME_DATA_FILES.map(path => fetchJson(path, baseUrl, fetcher)))
  const [species, forms, abilities, items, types, natures, growthRates, moves, evolutions, learnsets] = values as [RuntimeSpecies[], RuntimeForm[], RuntimeAbility[], RuntimeItem[], RuntimeType[], RuntimeNature[], RuntimeGrowthRate[], RuntimeMove[], RuntimeEvolution[], RuntimeLearnsets]
  const data = { species, forms, abilities, items, types, natures, growthRates, moves, evolutions, learnsets }
  try { validateLoadedRuntimeData(data, manifest) }
  catch (cause) {
    const code = cause instanceof RuntimeDataIntegrityError ? cause.code : 'UNKNOWN_INTEGRITY_FAILURE'
    throw new RuntimeDataLoadError(code, '运行时数据不完整或不兼容，请重新构建并发布站点。', { cause })
  }
  return { ...data, manifest }
}

export async function loadPokemonRuntimeData(): Promise<PokemonRuntimeData> {
  return await loadPokemonRuntimeDataFrom(import.meta.env.BASE_URL)
}
