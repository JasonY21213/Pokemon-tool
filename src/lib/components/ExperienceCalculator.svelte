<script lang="ts">
  import { EXPERIENCE_CANDY_MAX_COUNT, EXPERIENCE_CANDY_VALUES, expProgress, experienceBetweenLevels, levelToTotalExp, maxCandyCountForTarget, resolveEffectiveGrowthRate, totalExperienceCandyValue, type ExperienceCandyCounts, type ExperienceCandySize } from '../runtime-data/experience-calculator'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeSpecies } from '../runtime-data/types'
  import { growthRateLabel, growthRatePresentationOrder } from '../presentation/labels'
  import { editableInteger, normalizeEditableInteger } from '../presentation/editable-number'

  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null
  export let selectedForm: RuntimeForm | null

  let mode: 'planning' | 'total' = 'planning'
  let currentLevel = 50
  let targetLevel = 100
  let currentLevelDraft = '50'
  let targetLevelDraft = '100'
  let totalExperience = 0
  let totalExperienceDraft = '0'
  let lookupLevel = 50
  let lookupLevelDraft = '50'
  let candyCounts: ExperienceCandyCounts = { xs: 0, s: 0, m: 0, l: 0, xl: 0 }
  let candyDrafts: Record<ExperienceCandySize, string> = { xs: '0', s: '0', m: '0', l: '0', xl: '0' }
  const candyRows: Array<{ size: ExperienceCandySize; label: string }> = [
    { size: 'xs', label: '经验糖果 XS' },
    { size: 's', label: '经验糖果 S' },
    { size: 'm', label: '经验糖果 M' },
    { size: 'l', label: '经验糖果 L' },
    { size: 'xl', label: '经验糖果 XL' },
  ]

  function editCurrentLevel(raw: string): void { currentLevelDraft = raw; const value = editableInteger(raw, 1, 100); if (value !== null) { currentLevel = value; if (targetLevel < value) { targetLevel = value; targetLevelDraft = String(value) } } }
  function commitCurrentLevel(): void { currentLevel = normalizeEditableInteger(currentLevelDraft, 1, 100, currentLevel); currentLevelDraft = String(currentLevel); if (targetLevel < currentLevel) { targetLevel = currentLevel; targetLevelDraft = String(targetLevel) } }
  function editTargetLevel(raw: string): void { targetLevelDraft = raw; const value = editableInteger(raw, currentLevel, 100); if (value !== null) targetLevel = value }
  function commitTargetLevel(): void { targetLevel = normalizeEditableInteger(targetLevelDraft, currentLevel, 100, targetLevel); targetLevelDraft = String(targetLevel) }
  function editCandyCount(size: ExperienceCandySize, raw: string): void { candyDrafts = { ...candyDrafts, [size]: raw }; const value = editableInteger(raw, 0, EXPERIENCE_CANDY_MAX_COUNT); if (value !== null) candyCounts = { ...candyCounts, [size]: value } }
  function commitCandyCount(size: ExperienceCandySize): void { const value = normalizeEditableInteger(candyDrafts[size], 0, EXPERIENCE_CANDY_MAX_COUNT, candyCounts[size]); candyCounts = { ...candyCounts, [size]: value }; candyDrafts = { ...candyDrafts, [size]: String(value) } }
  function editTotalExperience(raw: string): void { totalExperienceDraft = raw; const value = editableInteger(raw, 0, Number.MAX_SAFE_INTEGER); if (value !== null) totalExperience = value }
  function commitTotalExperience(): void { totalExperience = normalizeEditableInteger(totalExperienceDraft, 0, Number.MAX_SAFE_INTEGER, totalExperience); totalExperienceDraft = String(totalExperience) }
  function editLookupLevel(raw: string): void { lookupLevelDraft = raw; const value = editableInteger(raw, 1, 100); if (value !== null) lookupLevel = value }
  function commitLookupLevel(): void { lookupLevel = normalizeEditableInteger(lookupLevelDraft, 1, 100, lookupLevel); lookupLevelDraft = String(lookupLevel) }
  function commitOnEnter(event: KeyboardEvent, commit: () => void): void { if (event.key === 'Enter') { event.preventDefault(); commit() } }
  function setCandyMax(size: ExperienceCandySize): void { if (selectedRequiredExperience === null) return; const otherExperience = candyTotal - candyCounts[size] * EXPERIENCE_CANDY_VALUES[size]; const count = maxCandyCountForTarget(selectedRequiredExperience, EXPERIENCE_CANDY_VALUES[size], otherExperience); candyCounts = { ...candyCounts, [size]: count }; candyDrafts = { ...candyDrafts, [size]: String(count) } }
  function clearCandies(): void { candyCounts = { xs: 0, s: 0, m: 0, l: 0, xl: 0 }; candyDrafts = { xs: '0', s: '0', m: '0', l: '0', xl: '0' } }

  $: selectedGrowthRate = selectedSpecies && selectedForm ? resolveEffectiveGrowthRate(selectedSpecies, selectedForm, data.growthRates) : null
  $: growthRows = growthRatePresentationOrder.flatMap(growthRateId => { const growthRate = data.growthRates.find(candidate => candidate.growthRateId === growthRateId); return growthRate ? [{ growthRate, requiredExperience: experienceBetweenLevels(growthRate, currentLevel, targetLevel) }] : [] })
  $: selectedRequiredExperience = selectedGrowthRate ? experienceBetweenLevels(selectedGrowthRate, currentLevel, targetLevel) : null
  $: candyTotal = totalExperienceCandyValue(candyCounts)
  $: remainingExperience = selectedRequiredExperience === null ? null : Math.max(0, selectedRequiredExperience - candyTotal)
  $: totalProgress = selectedGrowthRate ? expProgress(selectedGrowthRate, totalExperience) : null
  $: lookupLevelTotal = selectedGrowthRate ? levelToTotalExp(selectedGrowthRate, lookupLevel) : null
</script>

<section class="experience-calculator calculator">
  <h2>经验与等级 <small>Experience</small></h2>
  <div class="experience-mode-switch" aria-label="经验计算模式"><button type="button" class:active={mode === 'planning'} aria-pressed={mode === 'planning'} onclick={() => mode = 'planning'}>等级规划</button><button type="button" class:active={mode === 'total'} aria-pressed={mode === 'total'} onclick={() => mode = 'total'}>总经验查询</button></div>
  {#if mode === 'planning'}
    <p>当前等级按刚达到该等级计算；目标等级不能低于当前等级。</p>
    <div class="experience-workspace">
    <section class="experience-level-panel">
      <h3>等级区间</h3>
      <div class="experience-level-inputs">
        <label>当前等级<input type="number" min="1" max="100" step="1" value={currentLevelDraft} oninput={(event) => editCurrentLevel((event.currentTarget as HTMLInputElement).value)} onblur={commitCurrentLevel} onkeydown={(event) => commitOnEnter(event, commitCurrentLevel)} /></label>
        <span aria-hidden="true">→</span>
        <label>目标等级<input type="number" min={currentLevel} max="100" step="1" value={targetLevelDraft} oninput={(event) => editTargetLevel((event.currentTarget as HTMLInputElement).value)} onblur={commitTargetLevel} onkeydown={(event) => commitOnEnter(event, commitTargetLevel)} /></label>
      </div>
      {#if selectedGrowthRate && selectedSpecies}
        <p class="experience-selection">当前选择：<strong>{selectedSpecies.zhName}</strong>，对应<strong>{growthRateLabel(selectedGrowthRate.growthRateId, selectedGrowthRate.canonicalName).zh}</strong>成长曲线。</p>
      {:else if selectedSpecies}
        <p class="status">当前宝可梦的成长曲线仍未解析，无法高亮对应行或使用MAX。</p>
      {:else}
        <p class="status">尚未选择宝可梦；六条曲线仍可比较，选择宝可梦后会高亮对应行并启用MAX。</p>
      {/if}
      <div class="experience-table-wrap"><table class="experience-growth-table"><thead><tr><th>成长曲线</th><th>还需经验</th></tr></thead><tbody>{#each growthRows as row (row.growthRate.growthRateId)}<tr class:selected-growth={selectedGrowthRate?.growthRateId === row.growthRate.growthRateId}><th scope="row">{growthRateLabel(row.growthRate.growthRateId, row.growthRate.canonicalName).zh}</th><td>{row.requiredExperience.toLocaleString()}</td></tr>{/each}</tbody></table></div>
    </section>
    <aside class="experience-candy-panel">
      <header><div><h3>经验糖果</h3><p>每种最多999颗。</p></div><button type="button" onclick={clearCandies}>清空</button></header>
      <div class="experience-candy-list">{#each candyRows as candy (candy.size)}<div class="experience-candy-row"><div><strong>{candy.label}</strong><small>每颗 {EXPERIENCE_CANDY_VALUES[candy.size].toLocaleString()} EXP</small></div><input aria-label={`${candy.label}数量`} type="number" min="0" max={EXPERIENCE_CANDY_MAX_COUNT} step="1" value={candyDrafts[candy.size]} oninput={(event) => editCandyCount(candy.size, (event.currentTarget as HTMLInputElement).value)} onblur={() => commitCandyCount(candy.size)} onkeydown={(event) => commitOnEnter(event, () => commitCandyCount(candy.size))} /><button type="button" disabled={selectedRequiredExperience === null} onclick={() => setCandyMax(candy.size)}>MAX</button></div>{/each}</div>
      <div class="experience-candy-summary"><p>糖果总经验<strong>{candyTotal.toLocaleString()}</strong></p>{#if selectedRequiredExperience !== null}<p>目标所需经验<strong>{selectedRequiredExperience.toLocaleString()}</strong></p><p class:complete={remainingExperience === 0}>尚缺经验<strong>{remainingExperience?.toLocaleString()}</strong></p>{:else}<p class="status">先在“宝可梦查询”选择成长曲线已解析的宝可梦，才能使用MAX。</p>{/if}</div>
    </aside>
    </div>
  {:else}
    <p>使用当前选择宝可梦的成长曲线查询累计经验、等级和当前等级内进度。</p>
    {#if selectedGrowthRate && selectedSpecies}
      <p class="experience-selection">当前选择：<strong>{selectedSpecies.zhName}</strong>，对应<strong>{growthRateLabel(selectedGrowthRate.growthRateId, selectedGrowthRate.canonicalName).zh}</strong>成长曲线。</p>
      <div class="experience-total-grid">
        <section class="experience-level-panel">
          <h3>总 EXP → 等级</h3>
          <label class="experience-total-input">总 EXP<input type="number" min="0" step="1" value={totalExperienceDraft} oninput={(event) => editTotalExperience((event.currentTarget as HTMLInputElement).value)} onblur={commitTotalExperience} onkeydown={(event) => commitOnEnter(event, commitTotalExperience)} /></label>
          {#if totalProgress}<div class="experience-query-results"><p>对应等级<strong>Lv.{totalProgress.currentLevel}</strong></p><p>当前等级累计 EXP<strong>{totalProgress.currentLevelTotalExp.toLocaleString()}</strong></p>{#if totalProgress.currentLevel === 100}<p class="complete"><strong>已达到 Lv.100</strong>，等级已封顶。</p>{:else}<p>下一等级累计 EXP<strong>{totalProgress.nextLevelTotalExp?.toLocaleString()}</strong></p><p>当前等级内进度<strong>{totalProgress.expIntoCurrentLevel.toLocaleString()} / {(totalProgress.nextLevelTotalExp! - totalProgress.currentLevelTotalExp).toLocaleString()}（{Math.floor((totalProgress.progressFraction ?? 0) * 100)}%）</strong></p><p>距离下一等级<strong>{totalProgress.expNeededForNextLevel?.toLocaleString()}</strong></p>{/if}</div>{/if}
        </section>
        <section class="experience-level-panel">
          <h3>等级 → 总 EXP</h3>
          <label class="experience-total-input">等级<input type="number" min="1" max="100" step="1" value={lookupLevelDraft} oninput={(event) => editLookupLevel((event.currentTarget as HTMLInputElement).value)} onblur={commitLookupLevel} onkeydown={(event) => commitOnEnter(event, commitLookupLevel)} /></label>
          <div class="experience-query-results"><p>达到 Lv.{lookupLevel} 所需总 EXP<strong>{lookupLevelTotal?.toLocaleString()}</strong></p>{#if lookupLevel === 100}<p class="complete">Lv.100 为等级上限。</p>{/if}</div>
        </section>
      </div>
    {:else}<p class="status">请先在“宝可梦查询”选择成长曲线已解析的宝可梦。</p>{/if}
  {/if}
</section>
