<script lang="ts">
  import MoveDetail from './MoveDetail.svelte'
  import { addMoveToMoveset, filterLearnsetMoves, removeMoveFromMoveset, revalidateMoveset, sortLearnsetMoves, type LearnsetCategoryFilter, type LearnsetSort, type LearnsetSupportFilter } from '../runtime-data/learnset-explorer'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeMove } from '../runtime-data/types'

  export let data: PokemonRuntimeData
  export let selectedForm: RuntimeForm
  let query = ''
  let typeId = ''
  let category: LearnsetCategoryFilter = 'all'
  let minimumPower = 0
  let support: LearnsetSupportFilter = 'all'
  let sort: LearnsetSort = 'name'
  let selectedMove: RuntimeMove | null = null
  let movesetIds: string[] = []
  let removalNotice = ''
  let previousFormId = selectedForm.formId

  function sameIds(left: string[], right: string[]): boolean { return left.length === right.length && left.every((id, index) => id === right[index]) }
  function add(moveId: string): void { movesetIds = addMoveToMoveset(movesetIds, moveId, allowedIds) }
  function remove(moveId: string): void { movesetIds = removeMoveFromMoveset(movesetIds, moveId) }
  $: effectiveIds = resolveEffectiveLearnsetMoveIds(data.learnsets, selectedForm.formId)
  $: allowedIds = new Set(effectiveIds)
  $: effectiveMoves = effectiveIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined)
  $: filteredMoves = sortLearnsetMoves(filterLearnsetMoves(effectiveMoves, { query, typeId, category, minimumPower, support }), sort)
  $: moveset = movesetIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined)
  $: if (previousFormId !== selectedForm.formId) {
    const revalidated = revalidateMoveset(movesetIds, allowedIds)
    removalNotice = revalidated.length < movesetIds.length ? '已移除不属于新形态 Learnset 的临时招式。' : ''
    movesetIds = revalidated
    previousFormId = selectedForm.formId
  }
</script>

<section class="learnset">
  <h3>可学招式 / Learnset Explorer</h3>
  <p>固定 Showdown 来源中与当前形态关联的已知招式（跨世代汇总），不代表任何当前游戏中的可用性、获取方式或合法性。</p>
  <div class="learnset-filters">
    <label>名称<input bind:value={query} placeholder="中文名或英文名" /></label>
    <label>属性<select bind:value={typeId}><option value="">全部</option>{#each data.types as type (type.typeId)}<option value={type.typeId}>{type.canonicalName}</option>{/each}</select></label>
    <label>分类<select bind:value={category}><option value="all">全部</option><option value="damaging">伤害招式</option><option value="status">变化招式</option></select></label>
    <label>最低威力<input type="number" min="0" step="1" bind:value={minimumPower} /></label>
    <label>伤害支持<select bind:value={support}><option value="all">全部</option><option value="supported">仅普通公式支持</option></select></label>
    <label>排序<select bind:value={sort}><option value="name">名称</option><option value="type">属性</option><option value="category">分类</option><option value="power-desc">威力（高到低）</option><option value="pp">PP</option></select></label>
  </div>
  <p>当前形态共 {effectiveIds.length} 个关联招式，筛选后 {filteredMoves.length} 个。非数值威力不会被当成 0。</p>
  <div class="learnset-list explorer-list" aria-label="当前形态可学招式">
    {#each filteredMoves as move (move.moveId)}
      <article><button class:active={selectedMove?.moveId === move.moveId} type="button" onclick={() => selectedMove = move}><strong>{move.zhName ?? '未本地化'}</strong> <small>{move.canonicalName}</small></button><span>{data.types.find(type => type.typeId === move.typeId)?.canonicalName ?? move.typeId} · {move.category === 'physical' ? '物理' : move.category === 'special' ? '特殊' : '变化'} · 威力 {move.power.kind === 'numeric' ? move.power.value : move.power.kind === 'not-applicable' ? '—' : '未知'}</span><button type="button" disabled={movesetIds.includes(move.moveId) || movesetIds.length >= 4} onclick={() => add(move.moveId)}>{movesetIds.includes(move.moveId) ? '已加入' : movesetIds.length >= 4 ? '最多 4 个' : '加入临时招式组'}</button></article>
    {/each}
  </div>
  <section class="moveset-summary"><h4>临时 4 招式组（{moveset.length} / 4）</h4>{#if removalNotice}<p class="status">{removalNotice}</p>{/if}{#if moveset.length}<ul>{#each moveset as move (move.moveId)}<li><strong>{move.zhName ?? move.canonicalName}</strong>：{data.types.find(type => type.typeId === move.typeId)?.canonicalName ?? move.typeId} · {move.category} · 威力 {move.power.kind === 'numeric' ? move.power.value : '—'} · {move.damageSupport.status === 'supported' ? '普通伤害公式支持' : move.damageSupport.status === 'non-damaging' ? '变化招式' : '普通公式暂不支持'} <button type="button" onclick={() => remove(move.moveId)}>移除</button></li>{/each}</ul>{:else}<p>从当前形态 Learnset 中选择最多四个招式；仅保存在本次页面使用期间。</p>{/if}</section>
  {#if selectedMove}<MoveDetail {data} move={selectedMove} />{/if}
</section>
