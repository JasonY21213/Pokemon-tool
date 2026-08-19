import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  ExcelValidationAdapter, assertExcelFingerprint, classifyAppearanceAsForm, classifyKnownAnomaly,
  classifyMoveDash, classifyScopeDifference, fingerprintExcel, runExcelCrossValidation,
} from '../excel-validation.ts'

const root = resolve(import.meta.dirname, '../../..')

test('Excel fingerprint mismatch fails closed', () => {
  assert.throws(() => assertExcelFingerprint({ size: 1, sha256: 'bad', mtimeNs: 1n }), /EXCEL_FINGERPRINT_MISMATCH/)
})

test('read-only adapter exposes no save capability', async () => {
  const adapter = new ExcelValidationAdapter()
  assert.equal(adapter.readOnly, true); assert.equal(adapter.saveCapability, false)
  const source = await readFile(resolve(root, 'scripts/data/excel/read_workbook.py'), 'utf8')
  assert.doesNotMatch(source, /\.save\s*\(/); assert.match(source, /read_only=True/)
})

test('Species and Form rows remain distinct', async () => {
  const result = await runExcelCrossValidation()
  assert.equal(result.reports.species.summary.canonicalSpecies, 1025)
  assert.equal(result.reports.forms.summary.canonicalForms, 1380)
})

test('type and stat comparisons are emitted independently', async () => {
  const result = await runExcelCrossValidation()
  assert.equal(result.reports.mechanics.summary.typeComparisons, 1025)
  assert.ok(Number(result.reports.mechanics.summary.statComparisons) >= 6150)
})

test('Ability slots retain slot semantics', async () => {
  const result = await runExcelCrossValidation()
  assert.ok(Number(result.reports.mechanics.summary.abilitySlotComparisons) >= 3075)
  assert.ok(result.reports.mechanics.comparisons.some(item => item.canonicalField === 'abilities.H'))
})

test('Move dash is representation evidence, never zero or always', () => assert.equal(classifyMoveDash(), 'representation-difference'))
test('Dex scope mismatch is a representation difference', () => assert.equal(classifyScopeDifference(), 'representation-difference'))
test('Appearance represented as Form remains a representation difference', () => assert.equal(classifyAppearanceAsForm(), 'representation-difference'))
test('known Excel anomalies receive explicit classifications', () => {
  assert.deepEqual(classifyKnownAnomaly(true), { classification: 'suspected-legacy-error', status: 'confirmed' })
  assert.deepEqual(classifyKnownAnomaly(false), { classification: 'unverifiable', status: 'not reproduced' })
})

test('stable Excel reports are deterministic within one process', async () => {
  const first = await runExcelCrossValidation(); const second = await runExcelCrossValidation()
  assert.deepEqual(first.stableHashes, second.stableHashes)
})

test('Excel fingerprint remains unchanged after cross-validation', async () => {
  const before = await fingerprintExcel(); await runExcelCrossValidation(); assert.deepEqual(await fingerprintExcel(), before)
})
