<script lang="ts">
  import { onMount } from 'svelte'
  import { loadPokemonRuntimeData } from './lib/runtime-data/loader'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeMove, RuntimeSpecies, RuntimeStatBlock } from './lib/runtime-data/types'
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from './lib/runtime-data/type-matchup'
  import { calculateStats, totalEvs } from './lib/runtime-data/stat-calculator'
  import { expProgress, levelToTotalExp, resolveEffectiveGrowthRate } from './lib/runtime-data/experience-calculator'

  let data: PokemonRuntimeData | null = null
  let error = ''
  let query = ''
  let selectedSpecies: RuntimeSpecies | null = null
  let selectedForm: RuntimeForm | null = null
  let calculatorPrimaryTypeId = 'type:normal'
  let calculatorSecondaryTypeId = ''
  let statLevel = 50
  let statNatureId = 'nature:hardy'
  let statIvs: RuntimeStatBlock = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  let statEvs: RuntimeStatBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  let experienceMode: 'total-exp' | 'level' = 'total-exp'
  let totalExperience = 0
  let experienceLevel = 50
  let moveQuery = ''
  let selectedMove: RuntimeMove | null = null

  const statLabels: Record<keyof RuntimeStatBlock, string> = {
    hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Special Attack', spd: 'Special Defense', spe: 'Speed',
  }
  const statIds = Object.keys(statLabels) as Array<keyof RuntimeStatBlock>

  onMount(async () => {
    try {
      data = await loadPokemonRuntimeData()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '无法加载运行时数据。'
    }
  })

  function selectSpecies(species: RuntimeSpecies): void {
    selectedSpecies = species
    selectedForm = data?.forms.find(form => form.formId === species.defaultFormId) ?? null
  }

  function selectForm(form: RuntimeForm): void {
    selectedForm = form
  }

  function displayFormName(form: RuntimeForm): string {
    return form.zhName ?? form.canonicalName
  }

  function resolveAbilities(runtime: PokemonRuntimeData | null, form: RuntimeForm | null): Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> {
    if (!runtime || !form) return []
    return form.abilities.flatMap(slot => {
      const ability = runtime.abilities.find(candidate => candidate.abilityId === slot.abilityId)
      return ability ? [{ slot: slot.slot, ability }] : []
    })
  }

  function typeName(typeId: string): string {
    return data?.types.find(type => type.typeId === typeId)?.canonicalName ?? typeId
  }

  function moveCategory(category: RuntimeMove['category']): string {
    return ({ physical: '物理', special: '特殊', status: '变化' })[category]
  }

  function numericValue(value: RuntimeMove['power']): string {
    return value.kind === 'numeric' ? String(value.value) : value.kind === 'not-applicable' ? '—' : '未知'
  }

  function accuracyValue(accuracy: RuntimeMove['accuracy']): string {
    return accuracy.kind === 'percent' ? `${accuracy.value}%` : accuracy.kind === 'always' ? '必定命中' : '未知'
  }

  function formLabel(formId: string): string {
    const form = data?.forms.find(candidate => candidate.formId === formId)
    const species = form ? data?.species.find(candidate => candidate.speciesId === form.speciesId) : null
    if (!form || !species) return formId
    const formName = displayFormName(form)
    return formName === species.zhName ? species.zhName : `${species.zhName}（${formName}）`
  }

  function evolutionCondition(edge: RuntimeEvolution): string {
    const method = edge.method ? ({ level: '升级', levelFriendship: '亲密度升级', levelExtra: '满足额外条件后升级', useItem: '使用道具', trade: '通信交换', other: '其他条件' })[edge.method] ?? edge.method : null
    const details = [method, edge.level !== null ? `等级 ${edge.level}` : null, edge.item, edge.rawCondition].filter((value): value is string => value !== null)
    return `${details.join('；') || '条件未提供'}${edge.dataStatus === 'partial' ? '（条件信息不完整）' : ''}`
  }

  function matchupGroups(primaryTypeId: string, secondaryTypeId?: string) {
    return data ? groupDefensiveMatchup(calculateDefensiveMatchup(data.types, primaryTypeId, secondaryTypeId)) : []
  }

  function statCalculation(runtime: PokemonRuntimeData | null, species: RuntimeSpecies | null, form: RuntimeForm | null, level: number, ivs: RuntimeStatBlock, evs: RuntimeStatBlock, natureId: string): { stats: RuntimeStatBlock | null; error: string | null } {
    const nature = runtime?.natures.find(candidate => candidate.natureId === natureId)
    if (!species || !form || !nature) return { stats: null, error: null }
    try {
      return { stats: calculateStats({ speciesId: species.speciesId, baseStats: form.baseStats, level, ivs, evs, nature }), error: null }
    } catch (cause) {
      return { stats: null, error: cause instanceof Error && cause.message === 'STAT_CALCULATOR_EV_TOTAL_EXCEEDED' ? '努力值总和不能超过 510。' : '等级、个体值和努力值必须为允许范围内的整数。' }
    }
  }

  function setAllIvs(): void {
    statIvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  }

  function clearEvs(): void {
    statEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  }

  function experienceCalculation(runtime: PokemonRuntimeData | null, species: RuntimeSpecies | null, form: RuntimeForm | null, mode: 'total-exp' | 'level', totalExp: number, level: number): { growthRate: ReturnType<typeof resolveEffectiveGrowthRate>; progress: ReturnType<typeof expProgress> | null; levelTotalExp: number | null; error: string | null } {
    if (!runtime || !species || !form) return { growthRate: null, progress: null, levelTotalExp: null, error: null }
    const growthRate = resolveEffectiveGrowthRate(species, form, runtime.growthRates)
    if (!growthRate) return { growthRate: null, progress: null, levelTotalExp: null, error: null }
    try {
      return mode === 'total-exp'
        ? { growthRate, progress: expProgress(growthRate, totalExp), levelTotalExp: null, error: null }
        : { growthRate, progress: null, levelTotalExp: levelToTotalExp(growthRate, level), error: null }
    } catch {
      return { growthRate, progress: null, levelTotalExp: null, error: mode === 'total-exp' ? '总经验值必须是非负整数。' : '等级必须是 1 到 100 的整数。' }
    }
  }

  $: normalizedQuery = query.trim().toLocaleLowerCase()
  $: results = data && normalizedQuery
    ? data.species.filter(species => species.zhName.includes(query.trim())
      || species.canonicalName.toLocaleLowerCase().includes(normalizedQuery)
      || String(species.nationalDexNumber) === normalizedQuery).slice(0, 20)
    : []
  $: forms = data && selectedSpecies ? selectedSpecies.formIds
    .map(id => data?.forms.find(form => form.formId === id))
    .filter((form): form is RuntimeForm => form !== undefined)
    : []
  $: abilities = resolveAbilities(data, selectedForm)
  $: selectedFormMatchup = selectedForm ? matchupGroups(selectedForm.types[0], selectedForm.types[1]) : []
  $: calculatorMatchup = calculatorPrimaryTypeId ? matchupGroups(calculatorPrimaryTypeId, calculatorSecondaryTypeId || undefined) : []
  $: statResult = statCalculation(data, selectedSpecies, selectedForm, statLevel, statIvs, statEvs, statNatureId)
  $: evTotal = totalEvs(statEvs)
  $: experienceResult = experienceCalculation(data, selectedSpecies, selectedForm, experienceMode, totalExperience, experienceLevel)
  $: normalizedMoveQuery = moveQuery.trim().toLocaleLowerCase()
  $: moveResults = data && normalizedMoveQuery
    ? data.moves.filter(move => (move.zhName?.includes(moveQuery.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalizedMoveQuery)).slice(0, 30)
    : []
  $: selectedFormId = selectedForm?.formId ?? null
  $: previousEvolutions = data && selectedFormId ? data.evolutions.filter(edge => edge.targetFormId === selectedFormId) : []
  $: nextEvolutions = data && selectedFormId ? data.evolutions.filter(edge => edge.sourceFormId === selectedFormId) : []
</script>

<main>
  <header>
    <h1>Pokémon Tool</h1>
    <p>按中文名、英文名或全国图鉴编号查询宝可梦。</p>
  </header>

  {#if error}
    <p class="status error" role="alert">{error}</p>
  {:else if !data}
    <p class="status">正在加载宝可梦数据…</p>
  {:else}
    <label class="search">
      <span>搜索宝可梦</span>
      <input bind:value={query} placeholder="例如：喷火龙、Charizard、6" />
    </label>

    {#if normalizedQuery}
      <section class="results" aria-label="搜索结果">
        {#if results.length}
          {#each results as species (species.speciesId)}
            <button class:active={selectedSpecies?.speciesId === species.speciesId} onclick={() => selectSpecies(species)}>
              <span>#{species.nationalDexNumber.toString().padStart(4, '0')}</span>
              {species.zhName} <small>{species.canonicalName}</small>
            </button>
          {/each}
        {:else}
          <p>没有找到匹配的宝可梦。</p>
        {/if}
      </section>

      <section class="stat-calculator">
        <h2>种族值计算器</h2>
        <p>使用当前所选形态的种族值。努力值单项最多 252，总和最多 510。</p>
        <div class="stat-controls">
          <label>等级 <input type="number" min="1" max="100" step="1" bind:value={statLevel} /></label>
          <label>性格
            <select bind:value={statNatureId}>
              {#each data.natures as nature (nature.natureId)}
                <option value={nature.natureId}>{nature.canonicalName}{nature.neutral ? '（中性）' : `（+${statLabels[nature.plusStat!]} / -${statLabels[nature.minusStat!]}）`}</option>
              {/each}
            </select>
          </label>
          <button type="button" onclick={setAllIvs}>全部 IV 设为 31</button>
          <button type="button" onclick={clearEvs}>清空 EV</button>
        </div>
        <p class:ev-over={evTotal > 510} class="ev-total">当前 EV 总和：{evTotal} / 510</p>
        {#if statResult.error}
          <p class="status error" role="alert">{statResult.error}</p>
        {:else if statResult.stats}
          <div class="stat-table-wrap">
            <table>
              <thead><tr><th>属性</th><th>Base</th><th>IV</th><th>EV</th><th>结果</th></tr></thead>
              <tbody>
                {#each statIds as stat}
                  <tr>
                    <th scope="row">{statLabels[stat]}</th>
                    <td>{selectedForm ? selectedForm.baseStats[stat] : '—'}</td>
                    <td><input aria-label={`${statLabels[stat]} IV`} type="number" min="0" max="31" step="1" bind:value={statIvs[stat]} /></td>
                    <td><input aria-label={`${statLabels[stat]} EV`} type="number" min="0" max="252" step="1" bind:value={statEvs[stat]} /></td>
                    <td><strong>{statResult.stats[stat]}</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/if}

    {#if selectedSpecies && selectedForm}
      <section class="detail" aria-live="polite">
        <div>
          <p class="dex">全国图鉴 #{selectedSpecies.nationalDexNumber.toString().padStart(4, '0')}</p>
          <h2>{selectedSpecies.zhName} <small>{selectedSpecies.canonicalName}</small></h2>
        </div>
        <div class="forms" aria-label="形态">
          {#each forms as form (form.formId)}
            <button class:active={selectedForm.formId === form.formId} onclick={() => selectForm(form)}>{displayFormName(form)}</button>
          {/each}
        </div>
        <h3>{displayFormName(selectedForm)} <small>{selectedForm.canonicalName}</small></h3>
        <p><strong>属性：</strong>{selectedForm.types.map(typeName).join(' / ')}</p>
        <div class="stats" aria-label="种族值">
          {#each Object.entries(selectedForm.baseStats) as [stat, value]}
            <span>{stat.toUpperCase()} <b>{value}</b></span>
          {/each}
        </div>
        <section>
          <h3>特性</h3>
          <ul>
            {#each abilities as { slot, ability } (ability.abilityId)}
              <li><strong>{slot === 'H' ? '隐藏特性' : `特性 ${slot}`}</strong>：{ability.zhName ?? ability.canonicalName} <small>{ability.canonicalName}</small>{#if ability.zhDescription} — {ability.zhDescription}{/if}</li>
            {/each}
          </ul>
        </section>
        <section>
          <h3>防御属性相性</h3>
          <div class="matchup-groups">
            {#each selectedFormMatchup as group (group.multiplier)}
              <p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>
            {/each}
          </div>
        </section>
        <section class="experience-calculator">
          <h3>经验与等级计算器</h3>
          {#if experienceResult.growthRate}
            <p>当前形态成长曲线：{experienceResult.growthRate.canonicalName}。达到 Lv.100 共需 {experienceResult.growthRate.level100Total.toLocaleString()} EXP。</p>
            <div class="experience-modes" aria-label="计算模式">
              <button class:active={experienceMode === 'total-exp'} type="button" onclick={() => experienceMode = 'total-exp'}>总 EXP → 等级</button>
              <button class:active={experienceMode === 'level'} type="button" onclick={() => experienceMode = 'level'}>等级 → 总 EXP</button>
            </div>
            {#if experienceMode === 'total-exp'}
              <label class="experience-input">总经验值
                <input type="number" min="0" step="1" bind:value={totalExperience} />
              </label>
              {#if experienceResult.error}
                <p class="status error" role="alert">{experienceResult.error}</p>
              {:else if experienceResult.progress}
                <div class="experience-result">
                  <p><strong>当前等级：Lv.{experienceResult.progress.currentLevel}</strong></p>
                  <p>当前等级累计 EXP：{experienceResult.progress.currentLevelTotalExp.toLocaleString()}</p>
                  {#if experienceResult.progress.nextLevelTotalExp !== null}
                    <p>距 Lv.{experienceResult.progress.currentLevel + 1} 还需 {experienceResult.progress.expNeededForNextLevel?.toLocaleString()} EXP（本级进度 {((experienceResult.progress.progressFraction ?? 0) * 100).toFixed(1)}%）</p>
                  {:else}
                    <p>已达到最高等级；不会计算超过 Lv.100 的等级。</p>
                  {/if}
                </div>
              {/if}
            {:else}
              <label class="experience-input">等级
                <input type="number" min="1" max="100" step="1" bind:value={experienceLevel} />
              </label>
              {#if experienceResult.error}
                <p class="status error" role="alert">{experienceResult.error}</p>
              {:else if experienceResult.levelTotalExp !== null}
                <div class="experience-result"><p><strong>达到 Lv.{experienceLevel} 所需累计 EXP：{experienceResult.levelTotalExp.toLocaleString()}</strong></p></div>
              {/if}
            {/if}
          {:else}
            <p class="status">当前形态的成长曲线仍未解析，暂时无法计算经验与等级。</p>
          {/if}
        </section>
        <section class="evolutions">
          <h3>进化</h3>
          {#if previousEvolutions.length || nextEvolutions.length}
            {#if previousEvolutions.length}
              <h4>可由以下形态进化而来</h4>
              <ul>
                {#each previousEvolutions as edge (edge.evolutionId)}
                  <li><strong>{formLabel(edge.sourceFormId)}</strong> → 当前形态：{evolutionCondition(edge)}</li>
                {/each}
              </ul>
            {/if}
            {#if nextEvolutions.length}
              <h4>可进化为</h4>
              <ul>
                {#each nextEvolutions as edge (edge.evolutionId)}
                  <li><strong>{formLabel(edge.targetFormId)}</strong>：{evolutionCondition(edge)}</li>
                {/each}
              </ul>
            {/if}
          {:else}
            <p>当前稳定进化图中没有该形态的进化关系。</p>
          {/if}
        </section>
      </section>
    {/if}

    <section class="calculator">
      <h2>属性相性计算器</h2>
      <p>计算指定防守属性受到各攻击属性时的标准倍率。</p>
      <div class="type-selects">
        <label>属性 1
          <select bind:value={calculatorPrimaryTypeId}>
            {#each data.types as type (type.typeId)}
              <option value={type.typeId}>{type.canonicalName}</option>
            {/each}
          </select>
        </label>
        <label>属性 2（可选）
          <select bind:value={calculatorSecondaryTypeId}>
            <option value="">无</option>
            {#each data.types.filter(type => type.typeId !== calculatorPrimaryTypeId) as type (type.typeId)}
              <option value={type.typeId}>{type.canonicalName}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="matchup-groups">
        {#each calculatorMatchup as group (group.multiplier)}
          <p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>
        {/each}
      </div>
    </section>

    <section class="move-browser">
      <h2>招式查询</h2>
      <p>按中文名或英文名查询已验证的稳定招式数据。当前没有可验证的宝可梦可学招式关系，因此不会在宝可梦详情中推测招式列表。</p>
      <label class="search">
        <span>搜索招式</span>
        <input bind:value={moveQuery} placeholder="例如：拍击、Pound、高速星星、Swift" />
      </label>
      {#if normalizedMoveQuery}
        <div class="move-results" aria-label="招式搜索结果">
          {#if moveResults.length}
            {#each moveResults as move (move.moveId)}
              <button class:active={selectedMove?.moveId === move.moveId} onclick={() => selectedMove = move}>{move.zhName ?? '未本地化'} <small>{move.canonicalName}</small></button>
            {/each}
          {:else}
            <p>没有找到匹配的稳定招式。</p>
          {/if}
        </div>
      {/if}
      {#if selectedMove}
        <div class="move-detail" aria-live="polite">
          <h3>{selectedMove.zhName ?? '未本地化'} <small>{selectedMove.canonicalName}</small></h3>
          <p>{selectedMove.zhDescription ?? '暂无中文简介。'}</p>
          <div class="move-mechanics">
            <span>属性 <b>{typeName(selectedMove.typeId)}</b></span>
            <span>分类 <b>{moveCategory(selectedMove.category)}</b></span>
            <span>威力 <b>{numericValue(selectedMove.power)}</b></span>
            <span>命中 <b>{accuracyValue(selectedMove.accuracy)}</b></span>
            <span>PP <b>{numericValue(selectedMove.pp)}</b></span>
            <span>优先度 <b>{selectedMove.priority}</b></span>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</main>
