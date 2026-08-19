import { emitRegistryReview, serializeRegistryDocument } from './registry-review.ts'

const first = await emitRegistryReview(false)
const second = await emitRegistryReview(false)
if (JSON.stringify(first.hashes) !== JSON.stringify(second.hashes)) throw new Error('REGISTRY_REVIEW_REPORTS_NON_DETERMINISTIC')
if (serializeRegistryDocument(first.artifacts.registryAfter) !== serializeRegistryDocument(second.artifacts.registryAfter)) throw new Error('REGISTRY_OUTPUT_NON_DETERMINISTIC')
console.log(JSON.stringify({ status: 'byte-identical', fileCount: Object.keys(first.hashes).length, hashes: first.hashes }, null, 2))
