import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DAMAGE_MODIFIER_TRACE_ORDER, calculateCoreDamage } from '../../../src/lib/runtime-data/damage-calculator.ts'
import { resolveAttackerItem, resolveCombatantConfiguration, terastallizationState, validateDamageCalculatorContext } from '../../../src/lib/runtime-data/damage-calculator-state.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)
const statBlock = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
const evBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

test('Damage Calculator state resolution validates Form Ability Item Tera and stat inputs centrally', async () => {
  const data = await runtimePromise
  const resolved = resolveCombatantConfiguration(data, { speciesId: 'species:0006', formId: 'form:0006:base', level: 50, natureId: 'nature:hardy', ivs: statBlock, evs: evBlock, abilityId: 'ability:0066', teraTypeId: 'type:fire' })
  assert.equal(resolved.form.formId, 'form:0006:base')
  assert.equal(resolved.ability?.abilityId, 'ability:0066')
  assert.deepEqual(resolved.terastallization, { active: true, teraType: 'type:fire' })
  assert.equal(resolveAttackerItem(data, 'item:0270')?.itemId, 'item:0270')
  assert.throws(() => resolveCombatantConfiguration(data, { speciesId: 'species:0006', formId: 'form:0006:base', level: 50, natureId: 'nature:hardy', ivs: statBlock, evs: evBlock, abilityId: 'ability:0026', teraTypeId: '' }), /ABILITY_NOT_AVAILABLE_FOR_FORM/)
  assert.throws(() => resolveAttackerItem(data, 'item:9999'), /DAMAGE_STATE_INVALID_ITEM/)
  assert.throws(() => terastallizationState('type:stellar' as never), /DAMAGE_STATE_INVALID_TERA_TYPE/)
  assert.throws(() => validateDamageCalculatorContext({ weather: 'hail' as never, terrain: 'none', attackerBurned: false, criticalHit: false, reflect: false, lightScreen: false, attackerStatStages: { atk: 0, spa: 0 }, defenderStatStages: { def: 0, spd: 0 } }), /BATTLE_CONTEXT_INVALID_WEATHER/)
})

test('Damage modifier trace is deterministic and follows the audited calculation order', async () => {
  const data = await runtimePromise
  const filter = data.abilities.find(ability => ability.abilityId === 'ability:0111')!
  const lifeOrb = data.items.find(item => item.itemId === 'item:0270')!
  const result = calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveTypeId: 'type:fire', moveCategory: 'physical',
    attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:grass'], types: data.types,
    defenderAbility: filter, attackerItem: lifeOrb,
    battleContext: { weather: 'sun', terrain: 'none', attackerBurned: true, criticalHit: false, reflect: true, lightScreen: false, attackerStatStages: { atk: 1, spa: 0 }, defenderStatStages: { def: -1, spd: 0 } },
  })
  const categories = result.modifierTrace.map(entry => entry.category)
  assert.deepEqual(categories, ['stat-stage', 'stat-stage', 'core-base-damage', 'weather', 'random', 'stab', 'type-effectiveness', 'burn', 'screen', 'ability-final', 'item-final'])
  assert.equal(categories.every((category, index) => index === 0 || DAMAGE_MODIFIER_TRACE_ORDER.indexOf(category) >= DAMAGE_MODIFIER_TRACE_ORDER.indexOf(categories[index - 1])), true)
  assert.deepEqual(result.modifierTrace, calculateCoreDamage({
    level: 50, attack: 100, defense: 100, basePower: 50, moveTypeId: 'type:fire', moveCategory: 'physical', attackerTypeIds: ['type:fire'], defenderTypeIds: ['type:grass'], types: data.types, defenderAbility: filter, attackerItem: lifeOrb,
    battleContext: { weather: 'sun', terrain: 'none', attackerBurned: true, criticalHit: false, reflect: true, lightScreen: false, attackerStatStages: { atk: 1, spa: 0 }, defenderStatStages: { def: -1, spd: 0 } },
  }).modifierTrace)
})
