<script lang="ts">
  import { expProgress, levelToTotalExp, resolveEffectiveGrowthRate } from '../runtime-data/experience-calculator'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeSpecies } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null
  export let selectedForm: RuntimeForm | null
  let mode: 'total-exp' | 'level' = 'total-exp'
  let totalExperience = 0
  let level = 50

  function calculate() {
    if (!selectedSpecies || !selectedForm) return { growthRate: null, progress: null, levelTotalExp: null, error: null }
    const growthRate = resolveEffectiveGrowthRate(selectedSpecies, selectedForm, data.growthRates)
    if (!growthRate) return { growthRate: null, progress: null, levelTotalExp: null, error: null }
    try { return mode === 'total-exp' ? { growthRate, progress: expProgress(growthRate, totalExperience), levelTotalExp: null, error: null } : { growthRate, progress: null, levelTotalExp: levelToTotalExp(growthRate, level), error: null } }
    catch { return { growthRate, progress: null, levelTotalExp: null, error: mode === 'total-exp' ? '总经验值必须是非负整数。' : '等级必须是 1 到 100 的整数。' } }
  }
  $: result = calculate()
</script>

<section class="experience-calculator calculator">
  <h2>经验与等级计算器</h2>
  {#if !selectedSpecies || !selectedForm}<p class="status">请先在“宝可梦查询”中选择一个形态。</p>
  {:else if result.growthRate}
    <p>当前形态成长曲线：{result.growthRate.canonicalName}。达到 Lv.100 共需 {result.growthRate.level100Total.toLocaleString()} EXP。</p>
    <div class="experience-modes" aria-label="计算模式"><button class:active={mode === 'total-exp'} type="button" onclick={() => mode = 'total-exp'}>总 EXP → 等级</button><button class:active={mode === 'level'} type="button" onclick={() => mode = 'level'}>等级 → 总 EXP</button></div>
    {#if mode === 'total-exp'}
      <label class="experience-input">总经验值<input type="number" min="0" step="1" bind:value={totalExperience} /></label>
      {#if result.error}<p class="status error" role="alert">{result.error}</p>
      {:else if result.progress}<div class="experience-result"><p><strong>当前等级：Lv.{result.progress.currentLevel}</strong></p><p>当前等级累计 EXP：{result.progress.currentLevelTotalExp.toLocaleString()}</p>{#if result.progress.nextLevelTotalExp !== null}<p>距 Lv.{result.progress.currentLevel + 1} 还需 {result.progress.expNeededForNextLevel?.toLocaleString()} EXP（本级进度 {((result.progress.progressFraction ?? 0) * 100).toFixed(1)}%）</p>{:else}<p>已达到最高等级；不会计算超过 Lv.100 的等级。</p>{/if}</div>{/if}
    {:else}
      <label class="experience-input">等级<input type="number" min="1" max="100" step="1" bind:value={level} /></label>
      {#if result.error}<p class="status error" role="alert">{result.error}</p>{:else if result.levelTotalExp !== null}<div class="experience-result"><p><strong>达到 Lv.{level} 所需累计 EXP：{result.levelTotalExp.toLocaleString()}</strong></p></div>{/if}
    {/if}
  {:else}<p class="status">当前形态的成长曲线仍未解析，暂时无法计算经验与等级。</p>{/if}
</section>
