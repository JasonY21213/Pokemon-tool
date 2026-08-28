<script lang="ts">
  import type { PokemonRuntimeData, RuntimeMove } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  let query = ''
  let selectedMove: RuntimeMove | null = null
  const category = (value: RuntimeMove['category']) => ({ physical: '物理', special: '特殊', status: '变化' })[value]
  const numeric = (value: RuntimeMove['power']) => value.kind === 'numeric' ? String(value.value) : value.kind === 'not-applicable' ? '—' : '未知'
  const accuracy = (value: RuntimeMove['accuracy']) => value.kind === 'percent' ? `${value.value}%` : value.kind === 'always' ? '必定命中' : '未知'
  $: normalized = query.trim().toLocaleLowerCase()
  $: results = normalized ? data.moves.filter(move => (move.zhName?.includes(query.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalized)).slice(0, 30) : []
</script>
<section class="move-browser">
  <h2>招式查询</h2><p>按中文名或英文名查询已验证的稳定招式数据。</p>
  <label class="search"><span>搜索招式</span><input bind:value={query} placeholder="例如：拍击、Pound、高速星星、Swift" /></label>
  {#if normalized}<div class="move-results" aria-label="招式搜索结果">{#if results.length}{#each results as move (move.moveId)}<button class:active={selectedMove?.moveId === move.moveId} onclick={() => selectedMove = move}>{move.zhName ?? '未本地化'} <small>{move.canonicalName}</small></button>{/each}{:else}<p>没有找到匹配的稳定招式。</p>{/if}</div>{/if}
  {#if selectedMove}<div class="move-detail" aria-live="polite"><h3>{selectedMove.zhName ?? '未本地化'} <small>{selectedMove.canonicalName}</small></h3><p>{selectedMove.zhDescription ?? '暂无中文简介。'}</p><div class="move-mechanics"><span>属性 <b>{data.types.find(type => type.typeId === selectedMove?.typeId)?.canonicalName ?? selectedMove.typeId}</b></span><span>分类 <b>{category(selectedMove.category)}</b></span><span>威力 <b>{numeric(selectedMove.power)}</b></span><span>命中 <b>{accuracy(selectedMove.accuracy)}</b></span><span>PP <b>{numeric(selectedMove.pp)}</b></span><span>优先度 <b>{selectedMove.priority}</b></span></div></div>{/if}
</section>
