/// <reference types="vite/client" />
import type { CoreRuntimeData, LearnsetRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeGrowthRate, RuntimeItem, RuntimeManifest, RuntimeMove, RuntimeNature, RuntimeSpecies, RuntimeType } from './types.ts'
import { CORE_RUNTIME_DATA_FILES, RuntimeDataIntegrityError, runtimeDataUrl, validateCoreRuntimeData, validateLearnsetRuntimeData, validateRuntimeManifest } from './integrity.ts'

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

export async function loadCoreRuntimeDataFrom(baseUrl: string, fetcher: typeof fetch = fetch): Promise<CoreRuntimeData> {
  let manifest: RuntimeManifest
  try { manifest = validateRuntimeManifest(await fetchJson('manifest.json', baseUrl, fetcher)) }
  catch (cause) {
    if (cause instanceof RuntimeDataLoadError) throw cause
    throw new RuntimeDataLoadError('INCOMPATIBLE_MANIFEST', '运行时数据版本不兼容，请重新构建并发布站点。', { cause })
  }
  const values = await Promise.all(CORE_RUNTIME_DATA_FILES.map(path => fetchJson(path, baseUrl, fetcher)))
  const [species, forms, abilities, items, types, natures, growthRates, moves, evolutions] = values as [RuntimeSpecies[], RuntimeForm[], RuntimeAbility[], RuntimeItem[], RuntimeType[], RuntimeNature[], RuntimeGrowthRate[], RuntimeMove[], RuntimeEvolution[]]
  const data = { species, forms, abilities, items, types, natures, growthRates, moves, evolutions }
  try { validateCoreRuntimeData(data, manifest) }
  catch (cause) {
    const code = cause instanceof RuntimeDataIntegrityError ? cause.code : 'UNKNOWN_INTEGRITY_FAILURE'
    throw new RuntimeDataLoadError(code, '运行时数据不完整或不兼容，请重新构建并发布站点。', { cause })
  }
  return { ...data, manifest }
}

export async function loadCoreRuntimeData(): Promise<CoreRuntimeData> {
  return await loadCoreRuntimeDataFrom(import.meta.env.BASE_URL)
}

type LearnsetCacheEntry = { baseUrl: string; fetcher: typeof fetch; promise: Promise<LearnsetRuntimeData> }
const learnsetCache = new WeakMap<RuntimeManifest, LearnsetCacheEntry>()

export function loadLearnsetsFrom(core: CoreRuntimeData, baseUrl: string, fetcher: typeof fetch = fetch): Promise<LearnsetRuntimeData> {
  const cached = learnsetCache.get(core.manifest)
  if (cached && cached.baseUrl === baseUrl && cached.fetcher === fetcher) return cached.promise
  const promise = (async () => {
    const value = await fetchJson('learnsets.json', baseUrl, fetcher) as LearnsetRuntimeData
    try { validateLearnsetRuntimeData(value, core) }
    catch (cause) {
      const code = cause instanceof RuntimeDataIntegrityError ? cause.code : 'UNKNOWN_INTEGRITY_FAILURE'
      throw new RuntimeDataLoadError(code, '可学招式数据不完整或不兼容，请重试或重新发布站点。', { cause })
    }
    return value
  })()
  learnsetCache.set(core.manifest, { baseUrl, fetcher, promise })
  void promise.catch(() => {
    if (learnsetCache.get(core.manifest)?.promise === promise) learnsetCache.delete(core.manifest)
  })
  return promise
}

export function loadLearnsets(core: CoreRuntimeData): Promise<LearnsetRuntimeData> {
  return loadLearnsetsFrom(core, import.meta.env.BASE_URL)
}
