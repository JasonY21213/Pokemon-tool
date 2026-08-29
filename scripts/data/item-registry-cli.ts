import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { itemRegistryEntities } from './items.ts'
import { getProjectRoot, loadShowdownSource, verifySource } from './source.ts'

const source = await verifySource()
const showdown = await loadShowdownSource(source)
const registryPath = join(getProjectRoot(), 'data-curated', 'id-registry.json')
const text = await readFile(registryPath, 'utf8')
const registry = JSON.parse(text) as { entities: Array<{ kind: string; projectId: string }> }
const additions = itemRegistryEntities(showdown.items, source.commit)
const existing = registry.entities.filter(entity => entity.kind === 'item')
if (existing.length > 0) {
  if (JSON.stringify(existing) !== JSON.stringify(additions)) throw new Error('ITEM_REGISTRY_EXISTING_MISMATCH')
  console.log(JSON.stringify({ verified: existing.length, changed: false }))
} else {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const marker = text.match(/\r?\n  \]\r?\n}\r?\n?$/)
  if (!marker || marker.index === undefined) throw new Error('ITEM_REGISTRY_FORMAT')
  const insertion = additions.map(entry => `    ${JSON.stringify(entry)}`).join(`,${newline}`)
  await writeFile(registryPath, `${text.slice(0, marker.index)},${newline}${insertion}${marker[0]}`, 'utf8')
  console.log(JSON.stringify({ added: additions.length, first: additions[0]?.projectId, last: additions.at(-1)?.projectId }))
}
