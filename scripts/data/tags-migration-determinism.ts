import assert from 'node:assert/strict'
import { ExcelValidationAdapter } from './excel-validation.ts'
import { buildFullDryRun } from './full-dry-run.ts'
import { serializeJson } from './serialization.ts'
import { buildTagsFromExcel, loadCuratedTags } from './tags.ts'

const canonical = await buildFullDryRun({ skipTags: true })
const excel = await new ExcelValidationAdapter().read()
const first = buildTagsFromExcel(excel, canonical)
const second = buildTagsFromExcel(excel, canonical)
const tracked = await loadCuratedTags()
assert.equal(serializeJson(second), serializeJson(first))
assert.equal(serializeJson(tracked), serializeJson(first))
console.log(JSON.stringify({ status: 'passed', assignments: first.assignments.length, unresolved: first.unresolved.length }, null, 2))
