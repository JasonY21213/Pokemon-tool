import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseStatTotal, resolveSearchResult, searchPokemon } from '../../../src/lib/runtime-data/pokemon-search.ts'
import type { RuntimeForm, RuntimeSpecies } from '../../../src/lib/runtime-data/types.ts'

const growthRate = { status: 'resolved', id: 'growth-rate:medium-fast' } as RuntimeSpecies['growthRate']
const species = [
  { speciesId: 'species:0001', nationalDexNumber: 1, canonicalName: 'Bulbasaur', zhName: '妙蛙种子', defaultFormId: 'form:0001:base', formIds: ['form:0001:base'], growthRate, tagIds: ['tag:starter'] },
  { speciesId: 'species:0006', nationalDexNumber: 6, canonicalName: 'Charizard', zhName: '喷火龙', defaultFormId: 'form:0006:base', formIds: ['form:0006:base', 'form:0006:mega-x'], growthRate, tagIds: [] },
  { speciesId: 'species:0999', nationalDexNumber: 999, canonicalName: 'Achar', zhName: '甲查', defaultFormId: 'form:0999:base', formIds: ['form:0999:base'], growthRate, tagIds: [] },
] as RuntimeSpecies[]
const forms = [
  { formId: 'form:0001:base', speciesId: 'species:0001', canonicalName: 'Bulbasaur', zhName: '妙蛙种子', types: ['type:grass'], baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 }, abilities: [], growthRateOverride: null, tagIds: [] },
  { formId: 'form:0006:base', speciesId: 'species:0006', canonicalName: 'Charizard', zhName: '喷火龙', types: ['type:fire', 'type:flying'], baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, abilities: [], growthRateOverride: null, tagIds: [] },
  { formId: 'form:0006:mega-x', speciesId: 'species:0006', canonicalName: 'Charizard-Mega-X', zhName: '超级喷火龙Ｘ', types: ['type:fire', 'type:dragon'], baseStats: { hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 }, abilities: [], growthRateOverride: null, tagIds: ['tag:mega'] },
  { formId: 'form:0999:base', speciesId: 'species:0999', canonicalName: 'Achar', zhName: '甲查', types: ['type:normal'], baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, abilities: [], growthRateOverride: null, tagIds: [] },
] as RuntimeForm[]

test('Pokemon search ranks exact Chinese and English matches, English case-insensitively, and National Dex exactly', () => {
  assert.equal(searchPokemon('喷火龙', species, forms)[0].species.speciesId, 'species:0006')
  assert.equal(searchPokemon('bulbasaur', species, forms)[0].species.speciesId, 'species:0001')
  assert.equal(searchPokemon('CHARIZARD', species, forms)[0].species.speciesId, 'species:0006')
  assert.equal(searchPokemon('6', species, forms)[0].species.speciesId, 'species:0006')
})

test('Pokemon search ranks prefixes before substrings, resolves Form results, and is deterministic without fuzzy matches', () => {
  const results = searchPokemon('mega', species, forms)
  assert.deepEqual(results.map(result => result.form?.formId), ['form:0006:mega-x'])
  assert.deepEqual(resolveSearchResult(results[0]), { species: species[1], formId: 'form:0006:mega-x' })
  assert.deepEqual(searchPokemon('char', species, forms).map(result => `${result.kind}:${result.form?.formId ?? result.species.speciesId}`), ['species:species:0006', 'form:form:0006:mega-x', 'species:species:0999'])
  assert.deepEqual(searchPokemon('char', species, forms), searchPokemon('char', species, forms))
  assert.equal(searchPokemon('Mega X', species, forms)[0].form?.formId, 'form:0006:mega-x')
  assert.deepEqual(searchPokemon('charizrd', species, forms), [])
  assert.equal(baseStatTotal(forms[1]), 534)
})
