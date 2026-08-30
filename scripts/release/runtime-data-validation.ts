import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RUNTIME_DATA_FILES, validateLoadedRuntimeData, validateRuntimeManifest } from '../../src/lib/runtime-data/integrity.ts'
import type { RuntimeDataWithLearnsets } from '../../src/lib/runtime-data/types.ts'

type ValidationSummary = { schemaVersion: number; files: number; bytes: number; records: number }

function parseJson(text: string, path: string): unknown {
  try { return JSON.parse(text) as unknown }
  catch (cause) { throw new Error(`RUNTIME_JSON_INVALID: ${path}`, { cause }) }
}

function asTagIds(value: unknown): Set<string> {
  if (!value || typeof value !== 'object' || !('definitions' in value) || !Array.isArray(value.definitions)) throw new Error('TAG_DEFINITIONS_INVALID')
  const ids = value.definitions.map(definition => definition && typeof definition === 'object' && 'tagId' in definition ? definition.tagId : null)
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('TAG_DEFINITIONS_INVALID')
  return new Set(ids as string[])
}

export async function validateRuntimeDataDirectory(dataRoot: string, tagsPath: string): Promise<ValidationSummary> {
  const manifestText = await readFile(join(dataRoot, 'manifest.json'), 'utf8')
  const manifest = validateRuntimeManifest(parseJson(manifestText, 'manifest.json'))
  const values = new Map<string, unknown>()
  let bytes = Buffer.byteLength(manifestText)
  for (const file of manifest.files) {
    const text = await readFile(join(dataRoot, file.path), 'utf8')
    bytes += Buffer.byteLength(text)
    const hash = createHash('sha256').update(text).digest('hex')
    if (hash !== file.sha256) throw new Error(`RUNTIME_HASH_MISMATCH: ${file.path}`)
    values.set(file.path, parseJson(text, file.path))
  }
  const data = {
    species: values.get('species.json'), forms: values.get('forms.json'), abilities: values.get('abilities.json'), items: values.get('items.json'),
    types: values.get('types.json'), natures: values.get('natures.json'), growthRates: values.get('growth-rates.json'), moves: values.get('moves.json'),
    evolutions: values.get('evolutions.json'), learnsets: values.get('learnsets.json'),
  } as Omit<RuntimeDataWithLearnsets, 'manifest'>
  validateLoadedRuntimeData(data, manifest)
  const tagIds = asTagIds(parseJson(await readFile(tagsPath, 'utf8'), tagsPath))
  const referencedTagIds = [...data.species.flatMap(record => record.tagIds), ...data.forms.flatMap(record => record.tagIds)]
  if (!referencedTagIds.every(tagId => tagIds.has(tagId))) throw new Error('RUNTIME_TAG_REFERENCE')
  return { schemaVersion: manifest.schemaVersion, files: RUNTIME_DATA_FILES.length + 1, bytes, records: manifest.files.reduce((sum, file) => sum + file.recordCount, 0) }
}
