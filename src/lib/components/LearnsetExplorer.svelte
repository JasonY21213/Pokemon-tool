<script lang="ts">
  import { onMount } from 'svelte'
  import MoveDetail from './MoveDetail.svelte'
  import { addMoveToMoveset, filterLearnsetMoves, removeMoveFromMoveset, revalidateMoveset, sortLearnsetMoves, type LearnsetCategoryFilter, type LearnsetSort, type LearnsetSupportFilter } from '../runtime-data/learnset-explorer'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import type { LearnsetRuntimeData, PokemonRuntimeData, RuntimeForm, RuntimeMove } from '../runtime-data/types'
  import { moveCategoryPresentation, pokemonTypePresentation, typeLabel } from '../presentation/labels'

  export let data: PokemonRuntimeData
  export let selectedForm: RuntimeForm
  export let learnsets: LearnsetRuntimeData | null = null
  export let learnsetsLoading = false
  export let learnsetsError = ''
  export let onRequestLearnsets: () => void = () => {}
  export let movesetIds: string[] = []
  let query = ''
  let typeId = ''
  let category: LearnsetCategoryFilter = 'all'
  let support: LearnsetSupportFilter = 'all'
  let sort: LearnsetSort = 'name'
  let selectedMove: RuntimeMove | null = null
  let removalNotice = ''
  let previousFormId = selectedForm.formId

  function sameIds(left: string[], right: string[]): boolean { return left.length === right.length && left.every((id, index) => id === right[index]) }
  function add(moveId: string): void { movesetIds = addMoveToMoveset(movesetIds, moveId, allowedIds) }
  function remove(moveId: string): void { movesetIds = removeMoveFromMoveset(movesetIds, moveId) }
  const numeric = (value: RuntimeMove['power']) => value.kind === 'numeric' ? String(value.value) : value.kind === 'not-applicable' ? '—' : '未知'
  const accuracy = (value: RuntimeMove['accuracy']) => value.kind === 'percent' ? `${value.value}%` : value.kind === 'always' ? '—' : '未知'
  onMount(() => { if (!learnsets) onRequestLearnsets() })
  $: effectiveIds = learnsets ? resolveEffectiveLearnsetMoveIds(learnsets, selectedForm.formId) : []
  $: allowedIds = new Set(effectiveIds)
  $: effectiveMoves = effectiveIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined)
  $: filteredMoves = sortLearnsetMoves(filterLearnsetMoves(effectiveMoves, { query, typeId, category, minimumPower: 0, support }), sort)
  $: moveset = movesetIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined)
  $: if (learnsets && previousFormId !== selectedForm.formId) {
    const revalidated = revalidateMoveset(movesetIds, allowedIds)
    removalNotice = revalidated.length < movesetIds.length ? '已移除不属于新形态 Learnset 的临时招式。' : ''
    movesetIds = revalidated
    previousFormId = selectedForm.formId
  }
</script>

<section class="learnset">
  <h3>可学招式 / Learnset Explorer</h3>
  <p>固定 Showdown 来源中与当前形态关联的已知招式（跨世代汇总），不代表任何当前游戏中的可用性、获取方式或合法性。</p>
  {#if learnsets}
  <div class="learnset-filters">
    <label class="learnset-name-filter">名称<input bind:value={query} placeholder="中文名或英文名" /></label>
    <label class="learnset-type-filter">属性<select bind:value={typeId}><option value="">全部</option>{#each data.types as type (type.typeId)}<option value={type.typeId}>{typeLabel(type.typeId, type.canonicalName).zh}</option>{/each}</select></label>
    <label class="learnset-category-filter">分类<select bind:value={category}><option value="all">全部</option><option value="damaging">伤害招式</option><option value="status">变化招式</option></select></label>
    <label>伤害支持<select bind:value={support}><option value="all">全部</option><option value="supported">仅普通公式支持</option></select></label>
    <label>排序<select bind:value={sort}><option value="name">名称</option><option value="type">属性</option><option value="category">分类</option><option value="power-desc">威力（高到低）</option><option value="pp">PP</option></select></label>
  </div>
  <p>当前形态共 {effectiveIds.length} 个关联招式，筛选后 {filteredMoves.length} 个。非数值威力不会被当成 0。</p>
  <div class="learnset-list explorer-list" aria-label="当前形态可学招式">
    {#each filteredMoves as move (move.moveId)}
      {@const typePresentation = pokemonTypePresentation(move.typeId, data.types.find(type => type.typeId === move.typeId)?.canonicalName)}
      {@const categoryPresentation = moveCategoryPresentation(move.category)}
      <article><button class:active={selectedMove?.moveId === move.moveId} type="button" onclick={() => selectedMove = move}><strong>{move.zhName ?? '暂无中文'}</strong> <small>{move.canonicalName}</small></button><div class="move-summary"><div class="move-classification"><span class="type-badge" style={`--type-background: ${typePresentation.background}; --type-foreground: ${typePresentation.foreground}`}>{typePresentation.label}</span><span class="move-category-badge" style={`--category-background: ${categoryPresentation.background}; --category-foreground: ${categoryPresentation.foreground}`}>{categoryPresentation.label}</span></div><div class="move-numbers"><span>威力 <b>{numeric(move.power)}</b></span><span>命中 <b>{accuracy(move.accuracy)}</b></span><span>PP <b>{numeric(move.pp)}</b></span></div></div><button type="button" disabled={movesetIds.includes(move.moveId) || movesetIds.length >= 4} onclick={() => add(move.moveId)}>{movesetIds.includes(move.moveId) ? '已加入' : movesetIds.length >= 4 ? '最多 4 个' : '加入临时招式组'}</button></article>
    {/each}
  </div>
  <section class="moveset-summary"><h4>临时 4 招式组（{moveset.length} / 4）</h4>{#if removalNotice}<p class="status">{removalNotice}</p>{/if}{#if moveset.length}<ul>{#each moveset as move (move.moveId)}{@const typePresentation = pokemonTypePresentation(move.typeId, data.types.find(type => type.typeId === move.typeId)?.canonicalName)}{@const categoryPresentation = moveCategoryPresentation(move.category)}<li><strong>{move.zhName ?? move.canonicalName}</strong>：<span class="type-badge" style={`--type-background: ${typePresentation.background}; --type-foreground: ${typePresentation.foreground}`}>{typePresentation.label}</span><span class="move-category-badge" style={`--category-background: ${categoryPresentation.background}; --category-foreground: ${categoryPresentation.foreground}`}>{categoryPresentation.label}</span><span>威力 {move.power.kind === 'numeric' ? move.power.value : '—'}</span><span>{move.damageSupport.status === 'supported' ? '普通伤害公式支持' : move.damageSupport.status === 'non-damaging' ? '变化招式' : '普通公式暂不支持'}</span><button type="button" onclick={() => remove(move.moveId)}>移除</button></li>{/each}</ul>{:else}<p>从当前形态 Learnset 中选择最多四个招式；仅保存在本次页面使用期间。</p>{/if}</section>
  {#if selectedMove}<MoveDetail {data} move={selectedMove} />{/if}
  {:else if learnsetsLoading}<p class="status" role="status" aria-live="polite"><strong>正在加载可学招式</strong> <small>Loading Learnsets</small></p>
  {:else if learnsetsError}<div class="status error" role="alert"><strong>可学招式加载失败</strong> <small>Failed to Load Learnsets</small><p>{learnsetsError}</p><button type="button" onclick={onRequestLearnsets}>重试 <small>Retry</small></button></div>
  {:else}<p class="status" role="status">正在准备可学招式… <small>Preparing Learnsets…</small></p>
  {/if}
</section>
