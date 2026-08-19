import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeJson(value), { encoding: 'utf8' })
}

export async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
