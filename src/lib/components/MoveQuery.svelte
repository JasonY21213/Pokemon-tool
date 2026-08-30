<script lang="ts">
  import MoveDetail from './MoveDetail.svelte'
  import type { PokemonRuntimeData, RuntimeMove } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  let query = ''
  let selectedMove: RuntimeMove | null = null
  $: normalized = query.trim().toLocaleLowerCase()
  $: results = normalized ? data.moves.filter(move => (move.zhName?.includes(query.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalized)).slice(0, 30) : []
  function selectMove(move: RuntimeMove): void { selectedMove = move }
  function handleSearchKeydown(event: KeyboardEvent): void { if (event.key !== 'Enter' || !results.length) return; event.preventDefault(); selectMove(results[0]) }
</script>
<section class="move-browser">
  <h2>招式查询</h2><p>按中文名或英文名查询已验证的稳定招式数据。</p>
  <label class="search"><span>搜索招式</span><input bind:value={query} onkeydown={handleSearchKeydown} placeholder="例如：拍击、Pound、高速星星、Swift" /></label>
  {#if normalized}<div class="move-results" aria-label="招式搜索结果">{#if results.length}{#each results as move (move.moveId)}<button class:active={selectedMove?.moveId === move.moveId} onclick={() => selectMove(move)}>{move.zhName ?? '未本地化'} <small>{move.canonicalName}</small></button>{/each}{:else}<p>没有找到匹配的稳定招式。</p>{/if}</div>{/if}
  {#if selectedMove}<MoveDetail {data} move={selectedMove} />{/if}
</section>
