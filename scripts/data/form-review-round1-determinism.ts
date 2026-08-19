import { emitFormReviewRound1 } from './form-review-round1.ts'

const first = await emitFormReviewRound1(false)
const second = await emitFormReviewRound1(false)
if (JSON.stringify(first.hashes) !== JSON.stringify(second.hashes)) throw new Error('FORM_REVIEW_NONDETERMINISTIC_REPORTS')
console.log(JSON.stringify({ status: 'byte-identical', fileCount: Object.keys(first.hashes).length, hashes: first.hashes }, null, 2))
