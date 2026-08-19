import { runConflictResolution } from './conflict-resolution.ts'

const first = await runConflictResolution()
const second = await runConflictResolution()
if (JSON.stringify(first.hashes) !== JSON.stringify(second.hashes)) throw new Error('CONFLICT_RESOLUTION_NON_DETERMINISTIC')
console.log(JSON.stringify({ status: 'byte-identical', fileCount: Object.keys(first.hashes).length, hashes: first.hashes }, null, 2))
