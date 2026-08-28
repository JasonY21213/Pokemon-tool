<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeMove, RuntimeSpecies } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null = null
  export let selectedForm: RuntimeForm | null = null
  let query = ''
  let learnsetQuery = ''
  const formName = (form: RuntimeForm) => form.zhName ?? form.canonicalName
  const typeName = (typeId: string) => data.types.find(type => type.typeId === typeId)?.canonicalName ?? typeId
  const category = (value: RuntimeMove['category']) => ({ physical: '物理', special: '特殊', status: '变化' })[value]
  function selectSpecies(species: RuntimeSpecies): void { selectedSpecies = species; selectedForm = data.forms.find(form => form.formId === species.defaultFormId) ?? null; learnsetQuery = '' }
  function selectForm(form: RuntimeForm): void { selectedForm = form; learnsetQuery = '' }
  function formLabel(formId: string): string {
    const form = data.forms.find(candidate => candidate.formId === formId); const species = form ? data.species.find(candidate => candidate.speciesId === form.speciesId) : null
    if (!form || !species) return formId; const name = formName(form); return name === species.zhName ? species.zhName : `${species.zhName}（${name}）`
  }
  function condition(edge: RuntimeEvolution): string {
    const method = edge.method ? ({ level: '升级', levelFriendship: '亲密度升级', levelExtra: '满足额外条件后升级', useItem: '使用道具', trade: '通信交换', other: '其他条件' })[edge.method] ?? edge.method : null
    const parts = [method, edge.level !== null ? `等级 ${edge.level}` : null, edge.item, edge.rawCondition].filter((value): value is string => value !== null)
    return `${parts.join('；') || '条件未提供'}${edge.dataStatus === 'partial' ? '（条件信息不完整）' : ''}`
  }
  $: normalized = query.trim().toLocaleLowerCase()
  $: results = normalized ? data.species.filter(species => species.zhName.includes(query.trim()) || species.canonicalName.toLocaleLowerCase().includes(normalized) || String(species.nationalDexNumber) === normalized).slice(0, 20) : []
  $: forms = selectedSpecies ? selectedSpecies.formIds.flatMap(id => { const form = data.forms.find(candidate => candidate.formId === id); return form ? [form] : [] }) : []
  $: abilities = selectedForm ? selectedForm.abilities.flatMap(slot => { const ability = data.abilities.find(candidate => candidate.abilityId === slot.abilityId); return ability ? [{ slot: slot.slot, ability }] : [] }) as Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> : []
  $: matchup = selectedForm ? groupDefensiveMatchup(calculateDefensiveMatchup(data.types, selectedForm.types[0], selectedForm.types[1])) : []
  $: formId = selectedForm?.formId ?? null
  $: previous = formId ? data.evolutions.filter(edge => edge.targetFormId === formId) : []
  $: next = formId ? data.evolutions.filter(edge => edge.sourceFormId === formId) : []
  $: knownIds = formId ? resolveEffectiveLearnsetMoveIds(data.learnsets, formId) : []
  $: normalizedLearnset = learnsetQuery.trim().toLocaleLowerCase()
  $: learnset = knownIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined).filter(move => !normalizedLearnset || (move.zhName?.includes(learnsetQuery.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalizedLearnset))
</script>

<section class="pokemon-query">
  <label class="search"><span>搜索宝可梦</span><input bind:value={query} placeholder="例如：喷火龙、Charizard、6" /></label>
  {#if normalized}<section class="results" aria-label="搜索结果">{#if results.length}{#each results as species (species.speciesId)}<button class:active={selectedSpecies?.speciesId === species.speciesId} onclick={() => selectSpecies(species)}><span>#{species.nationalDexNumber.toString().padStart(4, '0')}</span>{species.zhName} <small>{species.canonicalName}</small></button>{/each}{:else}<p>没有找到匹配的宝可梦。</p>{/if}</section>{/if}
  {#if selectedSpecies && selectedForm}<section class="detail" aria-live="polite">
    <div><p class="dex">全国图鉴 #{selectedSpecies.nationalDexNumber.toString().padStart(4, '0')}</p><h2>{selectedSpecies.zhName} <small>{selectedSpecies.canonicalName}</small></h2></div>
    <div class="forms" aria-label="形态">{#each forms as form (form.formId)}<button class:active={selectedForm.formId === form.formId} onclick={() => selectForm(form)}>{formName(form)}</button>{/each}</div>
    <h3>{formName(selectedForm)} <small>{selectedForm.canonicalName}</small></h3><p><strong>属性：</strong>{selectedForm.types.map(typeName).join(' / ')}</p>
    <div class="stats" aria-label="种族值">{#each Object.entries(selectedForm.baseStats) as [stat, value]}<span>{stat.toUpperCase()} <b>{value}</b></span>{/each}</div>
    <section><h3>特性</h3><ul>{#each abilities as { slot, ability } (ability.abilityId)}<li><strong>{slot === 'H' ? '隐藏特性' : `特性 ${slot}`}</strong>：{ability.zhName ?? ability.canonicalName} <small>{ability.canonicalName}</small>{#if ability.zhDescription} — {ability.zhDescription}{/if}</li>{/each}</ul></section>
    <section class="learnset"><h3>可学招式 / Learnset</h3><p>固定 Showdown 来源中与当前形态关联的已知招式（跨世代汇总），不表示每种获取方式在当前游戏中仍然可用。</p><label class="search"><span>筛选当前形态的 {knownIds.length} 个关联招式</span><input bind:value={learnsetQuery} placeholder="输入中文名或英文名" /></label>{#if learnset.length}<div class="learnset-list" aria-label="当前形态可学招式">{#each learnset as move (move.moveId)}<article><strong>{move.zhName ?? '未本地化'}</strong><small>{move.canonicalName}</small><span>{typeName(move.typeId)} · {category(move.category)}</span></article>{/each}</div>{:else if normalizedLearnset}<p>当前形态的关联招式中没有匹配项。</p>{:else}<p>固定来源中没有该形态的可解析关联招式。</p>{/if}</section>
    <section><h3>防御属性相性</h3><div class="matchup-groups">{#each matchup as group (group.multiplier)}<p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>{/each}</div></section>
    <section class="evolutions"><h3>进化</h3>{#if previous.length || next.length}{#if previous.length}<h4>可由以下形态进化而来</h4><ul>{#each previous as edge (edge.evolutionId)}<li><strong>{formLabel(edge.sourceFormId)}</strong> → 当前形态：{condition(edge)}</li>{/each}</ul>{/if}{#if next.length}<h4>可进化为</h4><ul>{#each next as edge (edge.evolutionId)}<li><strong>{formLabel(edge.targetFormId)}</strong>：{condition(edge)}</li>{/each}</ul>{/if}{:else}<p>当前稳定进化图中没有该形态的进化关系。</p>{/if}</section>
  </section>{:else if !normalized}<p class="status">输入名称或全国图鉴编号以查询宝可梦。</p>{/if}
</section>
