import { runExcelCrossValidation } from './excel-validation.ts'

const result = await runExcelCrossValidation()
console.log(JSON.stringify({ status: 'completed', outputRoot: result.outputRoot, summary: result.summary, performance: result.performance }, null, 2))
