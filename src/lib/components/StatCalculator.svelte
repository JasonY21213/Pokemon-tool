<script lang="ts">
  import { calculateStats, totalEvs } from '../runtime-data/stat-calculator'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeSpecies, RuntimeStatBlock } from '../runtime-data/types'

  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null
  export let selectedForm: RuntimeForm | null

  let level = 50
  let natureId = 'nature:hardy'
  let ivs: RuntimeStatBlock = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  let evs: RuntimeStatBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  const labels: Record<keyof RuntimeStatBlock, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Special Attack', spd: 'Special Defense', spe: 'Speed' }
  const ids = Object.keys(labels) as Array<keyof RuntimeStatBlock>

  function calculate(): { stats: RuntimeStatBlock | null; error: string | null } {
    const nature = data.natures.find(candidate => candidate.natureId === natureId)
    if (!selectedSpecies || !selectedForm || !nature) return { stats: null, error: null }
    try { return { stats: calculateStats({ speciesId: selectedSpecies.speciesId, baseStats: selectedForm.baseStats, level, ivs, evs, nature }), error: null } }
    catch (cause) { return { stats: null, error: cause instanceof Error && cause.message === 'STAT_CALCULATOR_EV_TOTAL_EXCEEDED' ? '努力值总和不能超过 510。' : '等级、个体值和努力值必须为允许范围内的整数。' } }
  }
  function setAllIvs(): void { ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } }
  function clearEvs(): void { evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }

  $: result = calculate()
  $: evTotal = totalEvs(evs)
</script>

<section class="stat-calculator">
  <h2>种族值计算器</h2>
  {#if !selectedSpecies || !selectedForm}
    <p class="status">请先在“宝可梦查询”中选择一个形态。</p>
  {:else}
    <p>使用 {selectedSpecies.zhName} 的当前形态种族值。努力值单项最多 252，总和最多 510。</p>
    <div class="stat-controls">
      <label>等级 <input type="number" min="1" max="100" step="1" bind:value={level} /></label>
      <label>性格<select bind:value={natureId}>{#each data.natures as nature (nature.natureId)}<option value={nature.natureId}>{nature.canonicalName}{nature.neutral ? '（中性）' : `（+${labels[nature.plusStat!]} / -${labels[nature.minusStat!]}）`}</option>{/each}</select></label>
      <button type="button" onclick={setAllIvs}>全部 IV 设为 31</button><button type="button" onclick={clearEvs}>清空 EV</button>
    </div>
    <p class:ev-over={evTotal > 510} class="ev-total">当前 EV 总和：{evTotal} / 510</p>
    {#if result.error}<p class="status error" role="alert">{result.error}</p>
    {:else if result.stats}<div class="stat-table-wrap"><table><thead><tr><th>属性</th><th>Base</th><th>IV</th><th>EV</th><th>结果</th></tr></thead><tbody>
      {#each ids as stat}<tr><th scope="row">{labels[stat]}</th><td>{selectedForm.baseStats[stat]}</td><td><input aria-label={`${labels[stat]} IV`} type="number" min="0" max="31" step="1" bind:value={ivs[stat]} /></td><td><input aria-label={`${labels[stat]} EV`} type="number" min="0" max="252" step="1" bind:value={evs[stat]} /></td><td><strong>{result.stats[stat]}</strong></td></tr>{/each}
    </tbody></table></div>{/if}
  {/if}
</section>
