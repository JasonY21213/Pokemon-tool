import { emitFormReviewRound1 } from './form-review-round1.ts'

const mode = process.argv[2]
if (mode !== '--plan' && mode !== '--apply') throw new Error('Usage: form-review-round1-cli.ts --plan|--apply')
const result = await emitFormReviewRound1(mode === '--apply')
console.log(JSON.stringify({ status: mode === '--apply' ? 'applied' : 'planned', outputRoot: result.outputRoot, summary: result.artifacts.summary }, null, 2))
