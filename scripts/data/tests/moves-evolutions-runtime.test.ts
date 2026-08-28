import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFullDryRun } from '../full-dry-run.ts'
import { buildRuntimeData } from '../runtime-emission.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

test('runtime Moves retain localized mechanics and exclude the Nihil Light quarantine', async () => {
  const runtime = await runtimePromise
  const pound = runtime.moves.find(move => move.moveId === 'move:0001')
  const swordsDance = runtime.moves.find(move => move.moveId === 'move:0014')
  const swift = runtime.moves.find(move => move.moveId === 'move:0129')
  assert.deepEqual(pound, {
    moveId: 'move:0001', canonicalName: 'Pound', zhName: '拍击',
    zhDescription: '使用长长的尾巴或手等拍打对手进行攻击。', typeId: 'type:normal', category: 'physical',
    power: { kind: 'numeric', value: 40 }, accuracy: { kind: 'percent', value: 100 }, pp: { kind: 'numeric', value: 35 }, priority: 0,
    damageSupport: { status: 'supported' },
  })
  assert.deepEqual(swordsDance?.power, { kind: 'not-applicable' })
  assert.deepEqual(swordsDance?.accuracy, { kind: 'always' })
  assert.deepEqual(swift?.accuracy, { kind: 'always' })
  assert.equal(runtime.moves.some(move => move.moveId === 'move:0920'), false)
  assert.equal(runtime.moves.every(move => runtime.types.some(type => type.typeId === move.typeId)), true)
  assert.equal(runtime.moves.every(move => !('provenance' in move) && !('conflicts' in move)), true)
})

test('runtime Evolution graph keeps stable Form links and explicit partial conditions', async () => {
  const runtime = await runtimePromise
  const edge = (sourceFormId: string, targetFormId: string) => runtime.evolutions.find(candidate => candidate.sourceFormId === sourceFormId && candidate.targetFormId === targetFormId)
  assert.deepEqual(edge('form:0001:base', 'form:0002:base'), {
    evolutionId: 'evolution:bulbasaur:ivysaur:16', sourceFormId: 'form:0001:base', targetFormId: 'form:0002:base',
    method: null, level: 16, item: null, rawCondition: null, dataStatus: 'complete',
  })
  assert.equal(runtime.evolutions.filter(candidate => candidate.sourceFormId === 'form:0133:base').length, 8)
  assert.deepEqual(edge('form:0064:base', 'form:0065:base'), {
    evolutionId: 'evolution:kadabra:alakazam:trade', sourceFormId: 'form:0064:base', targetFormId: 'form:0065:base',
    method: 'trade', level: null, item: null, rawCondition: null, dataStatus: 'complete',
  })
  assert.deepEqual(edge('form:0079:galar', 'form:0199:galar'), {
    evolutionId: 'evolution:slowpokegalar:slowkinggalar:useitem-galarica-wreath', sourceFormId: 'form:0079:galar', targetFormId: 'form:0199:galar',
    method: 'useItem', level: null, item: 'Galarica Wreath', rawCondition: null, dataStatus: 'complete',
  })
  const milcery = edge('form:0868:base', 'form:0869:base')
  assert.equal(milcery?.dataStatus, 'partial')
  assert.equal(milcery?.rawCondition, 'spin while holding a Sweet')
  assert.equal(runtime.evolutions.every(candidate => runtime.forms.some(form => form.formId === candidate.sourceFormId) && runtime.forms.some(form => form.formId === candidate.targetFormId)), true)
})
