import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runRuntimeEmission } from './runtime-emission.ts'

const result = await runRuntimeEmission()
const files = await Promise.all(result.manifest.files.map(async file => ({
  path: file.path,
  bytes: (await readFile(join(result.outputRoot, file.path))).length,
})))
console.log(JSON.stringify({ status: 'completed', outputRoot: result.outputRoot, files }, null, 2))
