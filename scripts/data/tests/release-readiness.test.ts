import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { RuntimeDataIntegrityError, runtimeDataUrl } from '../../../src/lib/runtime-data/integrity.ts'
import { loadCoreRuntimeDataFrom, loadLearnsetsFrom, RuntimeDataLoadError } from '../../../src/lib/runtime-data/loader.ts'
import { serializeJson } from '../serialization.ts'
import { validateRuntimeDataDirectory } from '../../release/runtime-data-validation.ts'

const root = resolve(import.meta.dirname, '..', '..', '..')
const publicData = join(root, 'public', 'data')
const tagsPath = join(root, 'data-curated', 'tags.json')

async function runtimeResponses(): Promise<Map<string, string>> {
  const manifest = JSON.parse(await readFile(join(publicData, 'manifest.json'), 'utf8')) as { files: Array<{ path: string }> }
  return new Map(await Promise.all(['manifest.json', ...manifest.files.map(file => file.path)].map(async path => [path, await readFile(join(publicData, path), 'utf8')] as const)))
}

function mockFetch(responses: Map<string, string>, requested: string[], overrides: Partial<Record<string, string | null>> = {}): typeof fetch {
  return (async input => {
    const url = String(input)
    requested.push(url)
    const path = url.split('/').at(-1) ?? ''
    const body = Object.hasOwn(overrides, path) ? overrides[path] : responses.get(path)
    return body === null || body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

test('runtime data URLs preserve root and repository base paths', () => {
  assert.equal(runtimeDataUrl('/', 'manifest.json'), '/data/manifest.json')
  assert.equal(runtimeDataUrl('/Pokemon-tool/', 'forms.json'), '/Pokemon-tool/data/forms.json')
  assert.equal(runtimeDataUrl('/Pokemon-tool', 'moves.json'), '/Pokemon-tool/data/moves.json')
})

test('production runtime directory passes manifest hashes, counts, stable references, and Tags', async () => {
  const summary = await validateRuntimeDataDirectory(publicData, tagsPath)
  assert.equal(summary.schemaVersion, 2)
  assert.equal(summary.files, 12)
  assert.equal(summary.records, 6763)
  assert.ok(summary.bytes > 3_000_000)
})

test('core loader validates the manifest and loads every core file without requesting learnsets', async () => {
  const responses = await runtimeResponses()
  const requested: string[] = []
  const data = await loadCoreRuntimeDataFrom('/Pokemon-tool/', mockFetch(responses, requested))
  assert.equal(requested[0], '/Pokemon-tool/data/manifest.json')
  assert.equal(requested.length, 11)
  assert.equal(requested.includes('/Pokemon-tool/data/learnsets.json'), false)
  assert.equal(data.species.length, 1025)
  assert.equal(data.forms.length, 1380)
})

test('schema 1 manifests are rejected by the schema 2 exact file-set contract', async () => {
  const responses = await runtimeResponses()
  await assert.rejects(
    loadCoreRuntimeDataFrom('/', mockFetch(responses, [], { 'manifest.json': JSON.stringify({ schemaVersion: 1, files: [] }) })),
    error => error instanceof RuntimeDataLoadError && error.code === 'INCOMPATIBLE_MANIFEST' && /版本不兼容/.test(error.message),
  )
})

test('core loader returns stable user-facing failures for missing, malformed, incompatible, and unreachable data', async () => {
  const responses = await runtimeResponses()
  const cases: Array<{ overrides: Partial<Record<string, string | null>>; code: string; message: RegExp }> = [
    { overrides: { 'manifest.json': null }, code: 'HTTP', message: /数据清单/ },
    { overrides: { 'manifest.json': '{' }, code: 'MALFORMED_JSON', message: /格式损坏/ },
    { overrides: { 'manifest.json': JSON.stringify({ schemaVersion: 3, files: [] }) }, code: 'INCOMPATIBLE_MANIFEST', message: /版本不兼容/ },
    { overrides: { 'forms.json': null }, code: 'HTTP', message: /数据不完整/ },
    { overrides: { 'moves.json': '{' }, code: 'MALFORMED_JSON', message: /格式损坏/ },
  ]
  for (const entry of cases) {
    await assert.rejects(loadCoreRuntimeDataFrom('/', mockFetch(responses, [], entry.overrides)), error => error instanceof RuntimeDataLoadError && error.code === entry.code && entry.message.test(error.message))
  }
  const unreachable = (async () => { throw new TypeError('offline') }) as typeof fetch
  await assert.rejects(loadCoreRuntimeDataFrom('/', unreachable), error => error instanceof RuntimeDataLoadError && error.code === 'NETWORK' && /静态托管/.test(error.message))
})

test('lazy learnsets use one base-path-aware request and reuse successful and concurrent loads', async () => {
  const responses = await runtimeResponses()
  const core = await loadCoreRuntimeDataFrom('/Pokemon-tool/', mockFetch(responses, []))
  const requested: string[] = []
  const fetcher = mockFetch(responses, requested)
  const first = loadLearnsetsFrom(core, '/Pokemon-tool/', fetcher)
  const concurrent = loadLearnsetsFrom(core, '/Pokemon-tool/', fetcher)
  assert.equal(first, concurrent)
  const learnsets = await first
  assert.equal(learnsets.entries.length, 1380)
  assert.equal(await loadLearnsetsFrom(core, '/Pokemon-tool/', fetcher), learnsets)
  assert.deepEqual(requested, ['/Pokemon-tool/data/learnsets.json'])
})

test('lazy learnset failures stay isolated, reject malformed or mismatched data, and allow retry', async () => {
  const responses = await runtimeResponses()
  for (const [override, code] of [[null, 'HTTP'], ['{', 'MALFORMED_JSON']] as const) {
    const core = await loadCoreRuntimeDataFrom('/', mockFetch(responses, []))
    await assert.rejects(loadLearnsetsFrom(core, '/', mockFetch(responses, [], { 'learnsets.json': override })), error => error instanceof RuntimeDataLoadError && error.code === code)
    assert.equal(core.species.length, 1025)
  }
  const manifest = JSON.parse(responses.get('manifest.json')!) as { files: Array<{ path: string; recordCount: number }> }
  manifest.files.find(file => file.path === 'learnsets.json')!.recordCount -= 1
  const mismatchedResponses = new Map(responses).set('manifest.json', JSON.stringify(manifest))
  const mismatchCore = await loadCoreRuntimeDataFrom('/', mockFetch(mismatchedResponses, []))
  await assert.rejects(loadLearnsetsFrom(mismatchCore, '/', mockFetch(mismatchedResponses, [])), error => error instanceof RuntimeDataLoadError && error.code === 'DATA_RECORD_COUNT')

  const retryCore = await loadCoreRuntimeDataFrom('/', mockFetch(responses, []))
  let attempts = 0
  const retryFetcher = (async input => {
    attempts += 1
    return attempts === 1 ? new Response('missing', { status: 404 }) : mockFetch(responses, [])(input)
  }) as typeof fetch
  await assert.rejects(loadLearnsetsFrom(retryCore, '/', retryFetcher), error => error instanceof RuntimeDataLoadError && error.code === 'HTTP')
  assert.equal((await loadLearnsetsFrom(retryCore, '/', retryFetcher)).entries.length, 1380)
  assert.equal(attempts, 2)
})

test('production gate rejects a missing file, hash drift, and dangling stable reference', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pokemon-release-data-'))
  const dataRoot = join(temporaryRoot, 'data')
  try {
    await cp(publicData, dataRoot, { recursive: true })
    await unlink(join(dataRoot, 'forms.json'))
    await assert.rejects(validateRuntimeDataDirectory(dataRoot, tagsPath))
    await cp(join(publicData, 'forms.json'), join(dataRoot, 'forms.json'))
    await writeFile(join(dataRoot, 'forms.json'), `${await readFile(join(dataRoot, 'forms.json'), 'utf8')} `)
    await assert.rejects(validateRuntimeDataDirectory(dataRoot, tagsPath), /RUNTIME_HASH_MISMATCH/)
    await cp(join(publicData, 'forms.json'), join(dataRoot, 'forms.json'))
    const forms = JSON.parse(await readFile(join(dataRoot, 'forms.json'), 'utf8')) as Array<Record<string, unknown>>
    forms[0].speciesId = 'species:missing'
    const formsText = serializeJson(forms)
    await writeFile(join(dataRoot, 'forms.json'), formsText)
    const manifest = JSON.parse(await readFile(join(dataRoot, 'manifest.json'), 'utf8')) as { files: Array<{ path: string; sha256: string }> }
    manifest.files.find(file => file.path === 'forms.json')!.sha256 = createHash('sha256').update(formsText).digest('hex')
    await writeFile(join(dataRoot, 'manifest.json'), serializeJson(manifest))
    await assert.rejects(validateRuntimeDataDirectory(dataRoot, tagsPath), error => error instanceof RuntimeDataIntegrityError && error.code === 'FORM_REFERENCE')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
