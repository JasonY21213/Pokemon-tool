import { runMechanicsResolution } from './mechanics-resolution.ts'

const result = await runMechanicsResolution()
console.log(JSON.stringify({ status: 'completed', outputRoot: result.outputRoot, summary: result.artifacts.summary }, null, 2))
