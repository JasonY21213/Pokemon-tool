import { emitRegistryReview } from './registry-review.ts'

const apply = process.argv.includes('--apply')
const result = await emitRegistryReview(apply)
console.log(JSON.stringify({ status: apply ? 'applied' : 'planned', outputRoot: result.outputRoot, summary: result.artifacts.summary }, null, 2))
