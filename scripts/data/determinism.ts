import { runSmokePipeline } from './pipeline.ts'

const first = await runSmokePipeline({ clean: true })
const firstHashes = { ...first.runtimeHashes }
const second = await runSmokePipeline({ clean: true })
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
