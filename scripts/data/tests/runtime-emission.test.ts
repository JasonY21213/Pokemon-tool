import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData, emitRuntimeData } from '../runtime-emission.ts'

const artifactsPromise = buildFullDryRun()

test('runtime projection preserves stable Species, Form, Ability, and tag references', async () => {
  const runtime = buildRuntimeData(await artifactsPromise)
  assert.equal(runtime.species.length, 1025)
  assert.equal(runtime.forms.length, 1380)
  assert.equal(runtime.abilities.length, 316)
  assert.equal(runtime.items.length, 567)
  assert.equal(runtime.itemLocalizations.length, 567)
  assert.equal(runtime.types.length, 18)
  assert.equal(runtime.natures.length, 25)
  assert.equal(runtime.growthRates.length, 6)
  assert.equal(runtime.moves.length, 950)
  assert.equal(runtime.evolutions.length, 529)
  assert.equal(runtime.learnsets.entries.length, 1380)
  const charizard = runtime.species.find(species => species.speciesId === 'species:0006')
  assert.deepEqual(charizard?.formIds, ['form:0006:base', 'form:0006:gmax', 'form:0006:mega-x', 'form:0006:mega-y'])
  assert.equal(runtime.forms.find(form => form.formId === 'form:0006:mega-x')?.tagIds.includes('tag:mega'), true)
  assert.equal(runtime.forms.every(form => runtime.species.some(species => species.speciesId === form.speciesId)), true)
  assert.equal(runtime.forms.every(form => form.abilities.every(slot => runtime.abilities.some(ability => ability.abilityId === slot.abilityId))), true)
})

test('runtime projection keeps localization gaps explicit instead of guessing', async () => {
  const runtime = buildRuntimeData(await artifactsPromise)
  assert.equal(runtime.species.every(species => species.zhName.length > 0), true)
  assert.equal(runtime.forms.filter(form => form.zhName === null).length, 152)
  assert.equal(runtime.abilities.filter(ability => ability.zhName === null).length, 6)
  assert.equal(runtime.abilities.find(ability => ability.abilityId === 'ability:0181')?.zhDescription, '接触到对手的招式威力会提高。')
})

test('runtime public/data emission is deterministic byte-for-byte', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pokemon-runtime-emission-'))
  try {
    const artifacts = await artifactsPromise
    const outputRoot = join(temporaryRoot, 'public', 'data')
    await emitRuntimeData(artifacts, outputRoot)
    const first = await Promise.all(['species.json', 'forms.json', 'abilities.json', 'items.json', 'item-localization.json', 'types.json', 'natures.json', 'growth-rates.json', 'moves.json', 'evolutions.json', 'learnsets.json', 'manifest.json'].map(file => readFile(join(temporaryRoot, 'public', 'data', file))))
    await emitRuntimeData(artifacts, outputRoot)
    const second = await Promise.all(['species.json', 'forms.json', 'abilities.json', 'items.json', 'item-localization.json', 'types.json', 'natures.json', 'growth-rates.json', 'moves.json', 'evolutions.json', 'learnsets.json', 'manifest.json'].map(file => readFile(join(temporaryRoot, 'public', 'data', file))))
    assert.deepEqual(second, first)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
