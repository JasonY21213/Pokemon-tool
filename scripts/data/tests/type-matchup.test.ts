import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRuntimeData } from '../runtime-emission.ts'
import { buildFullDryRun } from '../full-dry-run.ts'
import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../../../src/lib/runtime-data/type-matchup.ts'

const runtimePromise = buildFullDryRun().then(buildRuntimeData)

async function matchup(primary: string, secondary?: string) {
  return calculateDefensiveMatchup((await runtimePromise).types, `type:${primary}`, secondary ? `type:${secondary}` : undefined)
}

function value(entries: Awaited<ReturnType<typeof matchup>>, attacking: string): number {
  const entry = entries.find(item => item.attackingTypeId === `type:${attacking}`)
  assert.ok(entry, `missing ${attacking}`)
  return entry.multiplier
}

test('runtime type projection contains the complete canonical chart exactly once', async () => {
  const runtime = await runtimePromise
  assert.equal(runtime.types.length, 18)
  assert.equal(new Set(runtime.types.map(type => type.typeId)).size, 18)
  assert.equal(runtime.types.every(type => type.damageTaken.length === 18 && new Set(type.damageTaken.map(entry => entry.attackingTypeId)).size === 18), true)
})

test('single-type defensive matchup preserves canonical Fire, Normal, and Ghost mechanics', async () => {
  assert.equal(value(await matchup('fire'), 'water'), 2)
  assert.equal(value(await matchup('normal'), 'ghost'), 0)
  assert.equal(value(await matchup('ghost'), 'normal'), 0)
})

test('dual-type defensive matchup multiplies canonical relationships without artifacts', async () => {
  const fireFlying = await matchup('fire', 'flying')
  assert.equal(value(fireFlying, 'rock'), 4)
  assert.equal(value(fireFlying, 'ground'), 0)
  assert.equal(value(fireFlying, 'grass'), 0.25)
  assert.equal(value(await matchup('water', 'ground'), 'electric'), 0)
  assert.equal(value(await matchup('bug', 'steel'), 'fire'), 4)
  const normalGhost = await matchup('normal', 'ghost')
  assert.equal(value(normalGhost, 'fighting'), 0)
  assert.equal(value(normalGhost, 'ghost'), 0)
  assert.deepEqual(groupDefensiveMatchup(fireFlying).map(group => group.multiplier), [4, 2, 1, 0.5, 0.25, 0])
})

test('Water attacking Flying remains canonically neutral at runtime', async () => {
  assert.equal(value(await matchup('flying'), 'water'), 1)
})
