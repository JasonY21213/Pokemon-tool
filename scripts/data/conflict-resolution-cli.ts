import { runConflictResolution } from './conflict-resolution.ts'

const result = await runConflictResolution()
console.log(JSON.stringify({ status: 'completed', outputRoot: result.outputRoot, summary: result.artifacts.summary }, null, 2))
