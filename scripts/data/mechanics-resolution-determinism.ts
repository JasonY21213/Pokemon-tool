import { runMechanicsResolution } from './mechanics-resolution.ts'

const first = await runMechanicsResolution()
const second = await runMechanicsResolution()
if (JSON.stringify(first.hashes) !== JSON.stringify(second.hashes)) throw new Error('MECHANICS_RESOLUTION_NON_DETERMINISTIC')
console.log(JSON.stringify({ status: 'byte-identical', fileCount: Object.keys(first.hashes).length, hashes: first.hashes }, null, 2))
