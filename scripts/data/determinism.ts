import { runSmokePipeline } from './pipeline.ts'
import { join } from 'node:path'
import { hashFile } from './serialization.ts'

const first = await runSmokePipeline({ clean: true })
const firstHashes = { ...first.runtimeHashes }
firstHashes['reports/move-mapping.json'] = await hashFile(join(first.outputRoot, 'reports', 'move-mapping.json'))
firstHashes['reports/evolution-mapping.json'] = await hashFile(join(first.outputRoot, 'reports', 'evolution-mapping.json'))
firstHashes['reports/appearance-mapping.json'] = await hashFile(join(first.outputRoot, 'reports', 'appearance-mapping.json'))
firstHashes['reports/dex-mapping.json'] = await hashFile(join(first.outputRoot, 'reports', 'dex-mapping.json'))
const second = await runSmokePipeline({ clean: true })
second.runtimeHashes['reports/move-mapping.json'] = await hashFile(join(second.outputRoot, 'reports', 'move-mapping.json'))
second.runtimeHashes['reports/evolution-mapping.json'] = await hashFile(join(second.outputRoot, 'reports', 'evolution-mapping.json'))
second.runtimeHashes['reports/appearance-mapping.json'] = await hashFile(join(second.outputRoot, 'reports', 'appearance-mapping.json'))
second.runtimeHashes['reports/dex-mapping.json'] = await hashFile(join(second.outputRoot, 'reports', 'dex-mapping.json'))
const paths = [...new Set([...Object.keys(firstHashes), ...Object.keys(second.runtimeHashes)])].sort()
const mismatches = paths.filter(path => firstHashes[path] !== second.runtimeHashes[path])

if (mismatches.length > 0) {
  throw new Error(`Determinism verification failed for: ${mismatches.join(', ')}`)
}

console.log(JSON.stringify({
  status: 'passed',
  runsCompared: 2,
  cacheMode: 'not-implemented',
  files: Object.fromEntries(paths.map(path => [path, firstHashes[path]])),
}, null, 2))
