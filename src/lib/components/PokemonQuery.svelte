<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import { adjustDefensiveMatchup, selectAbilityForForm } from '../runtime-data/ability-mechanics'
  import { baseStatTotal, orderedSpeciesForms, resolveSearchResult, searchPokemon } from '../runtime-data/pokemon-search'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import LearnsetExplorer from './LearnsetExplorer.svelte'
  import type { LearnsetRuntimeData, PokemonRuntimeData, RuntimeAbility, RuntimeEvolution, RuntimeForm, RuntimeSpecies } from '../runtime-data/types'
  import { formatLabel, statLabel, typeLabel } from '../presentation/labels'
  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null = null
  export let selectedForm: RuntimeForm | null = null
  export let learnsets: LearnsetRuntimeData | null = null
  export let learnsetsLoading = false
  export let learnsetsError = ''
  export let onRequestLearnsets: () => void = () => {}
  let query = ''
  let selectedAbilityId: string | null = null
  let learnsetOpen = false
  const tagLabels: Record<string, string> = { 'tag:starter': '御三家', 'tag:major-legendary': '一级神', 'tag:minor-legendary': '二级神', 'tag:mythical': '幻兽', 'tag:pseudo-legendary': '准神', 'tag:fossil': '化石', 'tag:ultra-beast': '究极异兽', 'tag:paradox': '悖谬种', 'tag:mega': 'Mega', 'tag:primal': '原始回归' }
  const statIds = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
  const formName = (form: RuntimeForm) => form.zhName ?? form.canonicalName
  const typeName = (typeId: string) => { const type = data.types.find(candidate => candidate.typeId === typeId); return formatLabel(typeLabel(typeId, type?.canonicalName ?? typeId)) }
  const stageLabel = (slot: RuntimeForm['abilities'][number]['slot']) => slot === 'H' ? '隐藏特性' : slot === 'S' ? '特殊特性' : `特性 ${slot}`
  function selectForm(form: RuntimeForm): void { selectedSpecies = data.species.find(species => species.speciesId === form.speciesId) ?? null; selectedForm = form; selectedAbilityId = null }
  function selectResult(result: ReturnType<typeof searchPokemon>[number]): void { const resolved = resolveSearchResult(result); selectedSpecies = resolved.species; selectedForm = data.forms.find(form => form.formId === resolved.formId) ?? null; selectedAbilityId = null }
  function formLabel(formId: string): string { const form = data.forms.find(candidate => candidate.formId === formId); const species = form ? data.species.find(candidate => candidate.speciesId === form.speciesId) : null; if (!form || !species) return formId; return formName(form) === species.zhName ? species.zhName : `${species.zhName}（${formName(form)}）` }
  function condition(edge: RuntimeEvolution): string { const method = edge.method ? ({ level: '升级', levelFriendship: '亲密度升级', levelExtra: '满足额外条件后升级', useItem: '使用道具', trade: '通信交换', other: '其他条件' })[edge.method] ?? edge.method : null; const parts = [method, edge.level !== null ? `等级 ${edge.level}` : null, edge.item, edge.rawCondition].filter((value): value is string => value !== null); return `${parts.join('；') || '条件未提供'}${edge.dataStatus === 'partial' ? '（条件信息不完整）' : ''}` }
  $: normalized = query.trim()
  $: results = searchPokemon(normalized, data.species, data.forms).slice(0, 24)
  $: forms = selectedSpecies ? orderedSpeciesForms(selectedSpecies, data.forms) : []
  $: compactForms = forms.length > 12
  $: abilities = selectedForm ? selectedForm.abilities.flatMap(slot => { const ability = data.abilities.find(candidate => candidate.abilityId === slot.abilityId); return ability ? [{ slot: slot.slot, ability }] : [] }) as Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> : []
  $: rawMatchupEntries = selectedForm ? calculateDefensiveMatchup(data.types, selectedForm.types[0], selectedForm.types[1]) : []
  $: matchup = groupDefensiveMatchup(rawMatchupEntries)
  $: selectedAbility = selectedForm ? selectAbilityForForm(selectedForm, data.abilities, selectedAbilityId) : null
  $: adjustedMatchup = adjustDefensiveMatchup(rawMatchupEntries, selectedAbility).filter(entry => entry.adjustedMultiplier !== entry.rawMultiplier)
  $: previous = selectedForm ? data.evolutions.filter(edge => edge.targetFormId === selectedForm!.formId) : []
  $: next = selectedForm ? data.evolutions.filter(edge => edge.sourceFormId === selectedForm!.formId) : []
  $: tagIds = selectedSpecies && selectedForm ? [...new Set([...selectedSpecies.tagIds, ...selectedForm.tagIds])] : []
  $: effectiveMoveCount = selectedForm && learnsets ? resolveEffectiveLearnsetMoveIds(learnsets, selectedForm.formId).length : null
</script>

<section class="pokemon-query">
  <label class="search"><span>搜索宝可梦或形态</span><input bind:value={query} placeholder="例如：妙蛙种子、Charizard、Mega X、6" /></label>
  {#if normalized}<section class="results" aria-label="搜索结果">{#if results.length}{#each results as result (`${result.kind}:${result.form?.formId ?? result.species.speciesId}`)}<button class:active={result.form ? selectedForm?.formId === result.form.formId : selectedSpecies?.speciesId === result.species.speciesId} onclick={() => selectResult(result)}><span>#{result.species.nationalDexNumber.toString().padStart(4, '0')} · {result.kind === 'form' ? '形态' : '宝可梦'}</span><strong>{result.form ? formName(result.form) : result.species.zhName}</strong> <small>{result.form?.canonicalName ?? result.species.canonicalName}</small>{#if result.form}<em>{result.species.zhName}</em>{/if}</button>{/each}{:else}<p class="status">没有找到匹配项。支持中文、英文、全国图鉴编号及明确的前缀/片段匹配。</p>{/if}</section>{:else}<p class="status">输入中文名、英文名、全国图鉴编号或明确的形态名称开始查询。</p>{/if}
  {#if selectedSpecies && selectedForm}<section class="detail" aria-live="polite">
    <header class="detail-identity"><p class="dex">全国图鉴 #{selectedSpecies.nationalDexNumber.toString().padStart(4, '0')} · Species</p><h2>{selectedSpecies.zhName} <small>{selectedSpecies.canonicalName}</small></h2><p>当前形态 / Form：<strong>{selectedForm.zhName ?? '暂无中文'}</strong> <small>{selectedForm.canonicalName}</small></p></header>
    <section><h3>形态</h3>{#if compactForms}<label>此宝可梦共有 {forms.length} 个稳定 Form。<select aria-label="选择形态" value={selectedForm.formId} onchange={(event) => selectForm(data.forms.find(form => form.formId === (event.currentTarget as HTMLSelectElement).value)!)}>{#each forms as form (form.formId)}<option value={form.formId}>{formName(form)} · {form.canonicalName}</option>{/each}</select></label>{:else}<div class="forms" aria-label="形态">{#each forms as form (form.formId)}<button class:active={selectedForm.formId === form.formId} onclick={() => selectForm(form)}>{formName(form)}</button>{/each}</div>{/if}</section>
    <section><h3>属性与分类</h3><p><strong>属性：</strong>{selectedForm.types.map(typeName).join(' / ')}</p>{#if tagIds.length}<div class="tag-list" aria-label="已有分类标签">{#each tagIds as tagId}<span>{tagLabels[tagId] ?? tagId}</span>{/each}</div>{:else}<p>当前没有已接受的分类标签。</p>{/if}{#if selectedSpecies.growthRate.status === 'unresolved'}<p class="status">成长率资料在当前运行时数据中仍为未解决状态。</p>{/if}</section>
    <section><h3>种族值 <small>Base Stats</small></h3><div class="stats" aria-label="种族值">{#each statIds as stat}<span>{formatLabel(statLabel(stat))} <b>{selectedForm.baseStats[stat]}</b></span>{/each}<span class="bst">总和 / BST <b>{baseStatTotal(selectedForm)}</b></span></div></section>
    <section><h3>特性</h3><ul>{#each abilities as { slot, ability } (ability.abilityId)}<li><strong>{stageLabel(slot)}</strong>：{ability.zhName ?? '未本地化'} <small>{ability.canonicalName}</small> · <em>{ability.mechanics.status === 'supported' ? '当前计算器支持' : '当前计算器未建模'}</em>{#if ability.zhDescription}<br />{ability.zhDescription}{/if}</li>{/each}</ul><label>用于防御相性预览的特性<select bind:value={selectedAbilityId}><option value={null}>不启用特性效果</option>{#each abilities as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>{#if selectedAbility?.mechanics.status === 'unsupported'}<p class="status">已选择的特性仍可能在游戏中有效；这里只表示当前计算器未建模。</p>{/if}</section>
    <section><h3>防御属性相性</h3><div class="matchup-groups">{#each matchup as group (group.multiplier)}<p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>{/each}</div>{#if adjustedMatchup.length}<p>特性预览变化：</p><ul>{#each adjustedMatchup as entry (entry.attackingTypeId)}<li><strong>{typeName(entry.attackingTypeId)}</strong>：原始 {entry.rawMultiplier}× → 特性后 {entry.adjustedMultiplier}×</li>{/each}</ul>{/if}</section>
    <section class="evolutions"><h3>进化</h3>{#if previous.length || next.length}{#if previous.length}<h4>由以下 Form 进化而来</h4><ul>{#each previous as edge (edge.evolutionId)}<li><strong>{formLabel(edge.sourceFormId)}</strong> → 当前 Form：{condition(edge)}</li>{/each}</ul>{/if}{#if next.length}<h4>可进化为</h4><ul>{#each next as edge (edge.evolutionId)}<li>当前 Form → <strong>{formLabel(edge.targetFormId)}</strong>：{condition(edge)}</li>{/each}</ul>{/if}{:else}<p>当前稳定进化图中没有该 Form 的进化关系。</p>{/if}</section>
    <section class="learnset-entry"><h3>可学招式 <small>Learnsets</small></h3>{#if effectiveMoveCount === null}<p>打开可学招式后加载。<small>Load on demand.</small></p>{:else}<p>当前 Form 有 {effectiveMoveCount} 个固定来源关联招式；跨世代关联不代表当前游戏合法性。</p>{/if}{#if !learnsetOpen}<button type="button" onclick={() => learnsetOpen = true}>打开可学招式 <small>Open Learnsets</small></button>{/if}</section>
    {#if learnsetOpen}<LearnsetExplorer {data} {selectedForm} {learnsets} {learnsetsLoading} {learnsetsError} {onRequestLearnsets} />{/if}
  </section>{/if}
</section>
