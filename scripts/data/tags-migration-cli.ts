import { resolve } from 'node:path'
import { ExcelValidationAdapter, fingerprintExcel } from './excel-validation.ts'
import { buildFullDryRun } from './full-dry-run.ts'
import { writeJson } from './serialization.ts'
import { buildTagsFromExcel } from './tags.ts'
import { getProjectRoot } from './source.ts'

const before = await fingerprintExcel()
const canonical = await buildFullDryRun({ skipTags: true })
const excel = await new ExcelValidationAdapter().read()
const tags = buildTagsFromExcel(excel, canonical)
await writeJson(resolve(getProjectRoot(), 'data-curated', 'tags.json'), tags)
const after = await fingerprintExcel()
if (after.size !== before.size || after.sha256 !== before.sha256 || after.mtimeNs !== before.mtimeNs) throw new Error('TAG_EXCEL_MUTATED')

console.log(JSON.stringify({
  status: 'written',
  output: 'data-curated/tags.json',
  definitions: tags.definitions.length,
  assignments: tags.assignments.length,
  unresolved: tags.unresolved.length,
  sourceFingerprint: excel.fingerprint,
}, null, 2))
