import { readFile } from 'node:fs/promises'
import { runFullDryRun } from './full-dry-run.ts'

const result = await runFullDryRun()
console.log(JSON.stringify({
  status: 'completed',
  outputRoot: result.outputRoot,
  summary: result.artifacts.summary,
  performance: JSON.parse(await readFile(`${result.outputRoot}/run-metadata/performance.json`, 'utf8')) as unknown,
}, null, 2))
