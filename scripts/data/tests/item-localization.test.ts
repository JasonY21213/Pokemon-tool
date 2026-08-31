import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { firstSearchableOption, type SearchableOption } from '../../../src/lib/presentation/searchable-select-state.ts'
import { itemSearchLabel } from '../../../src/lib/presentation/item-localization.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'
import { itemLocalizationCoverage, ITEM_LOCALIZATION_SOURCE_WORKBOOK, ITEM_LOCALIZATION_SOURCE_WORKBOOK_SHA256, loadItemLocalizationSource } from '../item-localization.ts'
import { normalizeTeamState, parseSerializedTeamState, serializeTeamState } from '../../../src/lib/runtime-data/team-persistence.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

test('Item localization covers the existing 567 stable Items without changing Item identity', async () => {
  const data = await runtimePromise
  const source = loadItemLocalizationSource()
  assert.equal(source.source.copiedAt, '2026-08-31')
  assert.equal(source.source.transportEvidence.sourceWorkbook, ITEM_LOCALIZATION_SOURCE_WORKBOOK)
  assert.equal(source.source.transportEvidence.sourceWorkbookSha256, ITEM_LOCALIZATION_SOURCE_WORKBOOK_SHA256)
  assert.equal(source.source.transportEvidence.primarySheet, '道具列表')
  assert.equal(source.source.transportEvidence.secondarySheet, '道具列表2')
  assert.match(source.source.provenanceMode, /manual list snapshot/)
  const coverage = itemLocalizationCoverage(data.items, source)
  assert.deepEqual(coverage, { activeItems: 567, localizedItems: 567, automatic: 565, ownerOverrides: 2, missing: 0, ambiguous: 0, duplicateStableIds: 0, danglingReferences: 0 })
  assert.equal(data.itemLocalizations.length, 567)
  assert.equal(new Set(data.itemLocalizations.map(item => item.itemId)).size, 567)
  assert.equal(data.itemLocalizations.every(item => /^item:\d{4}$/.test(item.itemId) && item.zhHansName.length > 0), true)
  assert.deepEqual(data.itemLocalizations.map(item => item.itemId), data.items.map(item => item.itemId))
  assert.equal(data.itemLocalizations.some(item => Object.hasOwn(item, 'description')), false)

  const baselineItems = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../public/data/items.json'), 'utf8')) as Array<{ itemId: string }>
  assert.deepEqual(data.items.map(item => item.itemId), baselineItems.map(item => item.itemId))
})

test('formal Item names preserve automatic mappings, explicit overrides, and reviewed samples', async () => {
  const data = await runtimePromise
  const names = new Map(data.itemLocalizations.map(item => [item.canonicalName, item.zhHansName]))
  assert.equal(names.get('Snowball'), '雪球')
  assert.equal(names.get('Mail'), '邮件')
  assert.equal(names.get('Spell Tag'), '诅咒之符')
  assert.equal(names.get('Mimikium Z'), '谜拟ＱＺ')
  assert.equal(names.get('Garchompite Z'), '烈咬陆鲨进化石Z')
  assert.equal(names.get('Choice Band'), '讲究头带')
  assert.equal(names.get('Life Orb'), '生命宝珠')
  assert.equal(names.get('Booster Energy'), '驱劲能量')
  assert.equal(names.get('Wellspring Mask'), '水井面具')
  assert.equal(data.itemLocalizations.filter(item => item.mappingClass === 'automatic').length, 565)
  assert.equal(data.itemLocalizations.filter(item => item.mappingClass === 'owner-override').length, 2)
})

test('Team Builder Item options search by Chinese or English names and retain stable values', async () => {
  const data = await runtimePromise
  const options: SearchableOption[] = [{ value: '', label: '未选择', keywords: '清除' }, ...data.items.map(item => ({ value: item.itemId, label: itemSearchLabel(item, data.itemLocalizations), keywords: `${item.canonicalName} ${itemSearchLabel(item, data.itemLocalizations)}` }))]
  assert.equal(firstSearchableOption(options, '生命宝珠')?.value, 'item:0270')
  assert.equal(firstSearchableOption(options, 'Life Orb')?.value, 'item:0270')
  assert.equal(firstSearchableOption(options, 'item:0270')?.value, undefined)
  assert.equal(firstSearchableOption(options, '清除')?.value, '')
})

test('Team persistence saves valid Item IDs and safely clears invalid Item IDs on restore', async () => {
  const data = await runtimePromise
  const valid = { memberId: 'team-member-1', formId: 'form:0006:base', abilityId: null, natureId: null, itemId: 'item:0270', moveIds: [] }
  assert.equal(parseSerializedTeamState(serializeTeamState([valid]), data)?.team[0].itemId, 'item:0270')
  const restored = normalizeTeamState({ version: 1, team: [{ ...valid, itemId: 'item:9999' }] }, data)
  assert.equal(restored?.team[0].itemId, null)
})
