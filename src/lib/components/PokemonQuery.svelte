<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import { adjustDefensiveMatchup, selectAbilityForForm } from '../runtime-data/ability-mechanics'
  import LearnsetExplorer from './LearnsetExplorer.svelte'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeSpecies } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null = null
  export let selectedForm: RuntimeForm | null = null
  let query = ''
  let selectedAbilityId: string | null = null
  const formName = (form: RuntimeForm) => form.zhName ?? form.canonicalName
  const typeName = (typeId: string) => data.types.find(type => type.typeId === typeId)?.canonicalName ?? typeId
  function selectSpecies(species: RuntimeSpecies): void { selectedSpecies = species; selectedForm = data.forms.find(form => form.formId === species.defaultFormId) ?? null; selectedAbilityId = null }
  function selectForm(form: RuntimeForm): void { selectedForm = form; selectedAbilityId = null }
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
  $: rawMatchupEntries = selectedForm ? calculateDefensiveMatchup(data.types, selectedForm.types[0], selectedForm.types[1]) : []
  $: matchup = groupDefensiveMatchup(rawMatchupEntries)
  $: selectedAbility = selectedForm ? selectAbilityForForm(selectedForm, data.abilities, selectedAbilityId) : null
  $: adjustedMatchup = adjustDefensiveMatchup(rawMatchupEntries, selectedAbility).filter(entry => entry.adjustedMultiplier !== entry.rawMultiplier)
  $: formId = selectedForm?.formId ?? null
  $: previous = formId ? data.evolutions.filter(edge => edge.targetFormId === formId) : []
  $: next = formId ? data.evolutions.filter(edge => edge.sourceFormId === formId) : []
</script>

<section class="pokemon-query">
  <label class="search"><span>搜索宝可梦</span><input bind:value={query} placeholder="例如：喷火龙、Charizard、6" /></label>
  {#if normalized}<section class="results" aria-label="搜索结果">{#if results.length}{#each results as species (species.speciesId)}<button class:active={selectedSpecies?.speciesId === species.speciesId} onclick={() => selectSpecies(species)}><span>#{species.nationalDexNumber.toString().padStart(4, '0')}</span>{species.zhName} <small>{species.canonicalName}</small></button>{/each}{:else}<p>没有找到匹配的宝可梦。</p>{/if}</section>{/if}
  {#if selectedSpecies && selectedForm}<section class="detail" aria-live="polite">
    <div><p class="dex">全国图鉴 #{selectedSpecies.nationalDexNumber.toString().padStart(4, '0')}</p><h2>{selectedSpecies.zhName} <small>{selectedSpecies.canonicalName}</small></h2></div>
    <div class="forms" aria-label="形态">{#each forms as form (form.formId)}<button class:active={selectedForm.formId === form.formId} onclick={() => selectForm(form)}>{formName(form)}</button>{/each}</div>
    <h3>{formName(selectedForm)} <small>{selectedForm.canonicalName}</small></h3><p><strong>属性：</strong>{selectedForm.types.map(typeName).join(' / ')}</p>
    <div class="stats" aria-label="种族值">{#each Object.entries(selectedForm.baseStats) as [stat, value]}<span>{stat.toUpperCase()} <b>{value}</b></span>{/each}</div>
    <section><h3>特性</h3><ul>{#each abilities as { slot, ability } (ability.abilityId)}<li><strong>{slot === 'H' ? '隐藏特性' : `特性 ${slot}`}</strong>：{ability.zhName ?? ability.canonicalName} <small>{ability.canonicalName}</small> · {ability.mechanics.status === 'supported' ? '本阶段支持' : '机制未建模'}{#if ability.zhDescription} — {ability.zhDescription}{/if}</li>{/each}</ul><label>用于防守相性的特性<select bind:value={selectedAbilityId}><option value={null}>不启用特性效果</option>{#each abilities as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot === 'H' ? 'H' : slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>{#if selectedAbility?.mechanics.status === 'unsupported'}<p class="status">已选择的特性机制尚未建模；下方仍显示原始属性相性。</p>{/if}</section>
    <LearnsetExplorer {data} {selectedForm} />
    <section><h3>防御属性相性</h3><p>原始属性相性：</p><div class="matchup-groups">{#each matchup as group (group.multiplier)}<p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>{/each}</div>{#if adjustedMatchup.length}<p>选择特性后的变化：</p><ul>{#each adjustedMatchup as entry (entry.attackingTypeId)}<li><strong>{typeName(entry.attackingTypeId)}</strong>：原始 {entry.rawMultiplier}× → 特性后 {entry.adjustedMultiplier}×</li>{/each}</ul>{/if}</section>
    <section class="evolutions"><h3>进化</h3>{#if previous.length || next.length}{#if previous.length}<h4>可由以下形态进化而来</h4><ul>{#each previous as edge (edge.evolutionId)}<li><strong>{formLabel(edge.sourceFormId)}</strong> → 当前形态：{condition(edge)}</li>{/each}</ul>{/if}{#if next.length}<h4>可进化为</h4><ul>{#each next as edge (edge.evolutionId)}<li><strong>{formLabel(edge.targetFormId)}</strong>：{condition(edge)}</li>{/each}</ul>{/if}{:else}<p>当前稳定进化图中没有该形态的进化关系。</p>{/if}</section>
  </section>{:else if !normalized}<p class="status">输入名称或全国图鉴编号以查询宝可梦。</p>{/if}
</section>
