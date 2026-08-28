<script lang="ts">
  import { onMount } from 'svelte'
  import { loadPokemonRuntimeData } from './lib/runtime-data/loader'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeForm, RuntimeSpecies } from './lib/runtime-data/types'
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from './lib/runtime-data/type-matchup'

  let data: PokemonRuntimeData | null = null
  let error = ''
  let query = ''
  let selectedSpecies: RuntimeSpecies | null = null
  let selectedForm: RuntimeForm | null = null
  let calculatorPrimaryTypeId = 'type:normal'
  let calculatorSecondaryTypeId = ''

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

  function matchupGroups(primaryTypeId: string, secondaryTypeId?: string) {
    return data ? groupDefensiveMatchup(calculateDefensiveMatchup(data.types, primaryTypeId, secondaryTypeId)) : []
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
  {/if}
</main>
