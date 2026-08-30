import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abilitySlotLabel, categoryLabel, entityLabel, growthRateLabel, growthRatePresentationOrder, moveCategoryPresentation, pokemonDetailStatLabel, pokemonTypePresentation, statLabel, traceLabel, typeLabel } from '../../../src/lib/presentation/labels.ts'

test('presentation labels map canonical IDs without changing runtime values', () => {
  assert.deepEqual(typeLabel('type:fire', 'Fire'), { zh: '火', en: 'Fire' })
  assert.deepEqual(statLabel('spa'), { zh: '特攻', en: 'Special Attack' })
  assert.deepEqual(categoryLabel('physical'), { zh: '物理', en: 'Physical' })
  assert.deepEqual(growthRateLabel('growth:medium-fast', 'Medium Fast'), { zh: '较快', en: 'Medium Fast' })
  assert.deepEqual(growthRatePresentationOrder.map(id => growthRateLabel(id, id).zh), ['最快', '快', '较快', '较慢', '慢', '最慢'])
})

test('Pokemon detail presentation uses compact Chinese stats, corrected ability slots, and all type colors', () => {
  assert.deepEqual(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(id => pokemonDetailStatLabel(id as Parameters<typeof pokemonDetailStatLabel>[0])), ['HP', '攻击', '防御', '特攻', '特防', '速度'])
  assert.deepEqual(['0', '1', 'H', 'S'].map(slot => abilitySlotLabel(slot as Parameters<typeof abilitySlotLabel>[0])), ['特性1', '特性2', '隐藏特性', '特殊特性'])
  const typeIds = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'].map(id => `type:${id}`)
  assert.equal(typeIds.every(id => /^#[0-9A-F]{6}$/.test(pokemonTypePresentation(id).background)), true)
  assert.equal(typeIds.every(id => pokemonTypePresentation(id).foreground === '#FFFFFF'), true)
  assert.deepEqual(typeIds.map(id => pokemonTypePresentation(id).label), ['一般', '火', '水', '草', '电', '冰', '格斗', '毒', '地面', '飞行', '超能', '虫', '岩石', '幽灵', '龙', '恶', '钢', '妖精'])
  assert.deepEqual(['physical', 'special', 'status'].map(id => moveCategoryPresentation(id)), [
    { label: '物理', background: '#EB5427', foreground: '#FFFFFF' },
    { label: '特殊', background: '#3665C5', foreground: '#FFFFFF' },
    { label: '变化', background: '#999999', foreground: '#FFFFFF' },
  ])
})

test('unsupported entity localizations retain the canonical English name as an explicit fallback', () => {
  assert.deepEqual(entityLabel(null, 'Charizard-Mega-X'), { zh: '暂无中文', en: 'Charizard-Mega-X' })
  assert.deepEqual(traceLabel('core-base-damage'), { zh: '基础伤害', en: 'Core Base Damage' })
})
