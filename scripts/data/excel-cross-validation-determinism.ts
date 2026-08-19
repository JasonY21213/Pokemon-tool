import { runExcelCrossValidation } from './excel-validation.ts'

const first = await runExcelCrossValidation()
const second = await runExcelCrossValidation()
if (JSON.stringify(first.stableHashes) !== JSON.stringify(second.stableHashes)) throw new Error('EXCEL_CROSS_VALIDATION_NON_DETERMINISTIC')
console.log(JSON.stringify({ status: 'byte-identical', fileCount: Object.keys(first.stableHashes).length, hashes: first.stableHashes }, null, 2))
