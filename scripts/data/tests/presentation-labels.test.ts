import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryLabel, entityLabel, growthRateLabel, statLabel, traceLabel, typeLabel } from '../../../src/lib/presentation/labels.ts'

test('presentation labels map canonical IDs without changing runtime values', () => {
  assert.deepEqual(typeLabel('type:fire', 'Fire'), { zh: '火', en: 'Fire' })
  assert.deepEqual(statLabel('spa'), { zh: '特攻', en: 'Special Attack' })
  assert.deepEqual(categoryLabel('physical'), { zh: '物理', en: 'Physical' })
  assert.deepEqual(growthRateLabel('growth:medium-fast', 'Medium Fast'), { zh: '较快', en: 'Medium Fast' })
})

test('unsupported entity localizations retain the canonical English name as an explicit fallback', () => {
  assert.deepEqual(entityLabel(null, 'Charizard-Mega-X'), { zh: '暂无中文', en: 'Charizard-Mega-X' })
  assert.deepEqual(traceLabel('core-base-damage'), { zh: '基础伤害', en: 'Core Base Damage' })
})
