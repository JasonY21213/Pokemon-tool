<script lang="ts">
  import { onMount } from 'svelte'
  import TeamAnalysis from './TeamAnalysis.svelte'
  import { abilitySlotLabel, moveCategoryPresentation, natureLabel, pokemonTypePresentation, statLabel } from '../presentation/labels'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import { addTeamMember, defensiveSummary, formsById, offensiveCoverage, removeTeamMember, updateMemberAbility, updateMemberMoves, updateMemberNature, validateTeamMembers, type TeamMember } from '../runtime-data/team-builder'
  import type { LearnsetRuntimeData, PokemonRuntimeData, RuntimeAbility, RuntimeForm, RuntimeMove, RuntimeNature } from '../runtime-data/types'

  export let data: PokemonRuntimeData
  export let selectedForm: RuntimeForm | null
  export let learnsets: LearnsetRuntimeData | null = null
  export let learnsetsLoading = false
  export let learnsetsError = ''
  export let onRequestLearnsets: () => void = () => {}
  export let members: TeamMember[] = []
  export let onMembersChange: (members: TeamMember[]) => void = () => {}
  export let onClearSavedTeam: () => void = () => {}
  export let onCopyShareLink: () => void = () => {}
  export let shareStatus = ''
  let natureQueryByMember: Record<string, string> = {}
  let moveQueryByMember: Record<string, string> = {}

  function formDisplay(form: RuntimeForm): string { const species = data.species.find(item => item.speciesId === form.speciesId); const name = form.zhName ?? '暂无中文形态名'; return species && species.zhName !== name ? `${species.zhName}（${name}）` : name }
  function setMembers(updated: TeamMember[]): void { onMembersChange(updated) }
  function nextMemberId(): string { let number = 1; while (members.some(member => member.memberId === `team-member-${number}`)) number += 1; return `team-member-${number}` }
  function addCurrent(): void { if (!selectedForm) return; setMembers(addTeamMember(members, { memberId: nextMemberId(), formId: selectedForm.formId, abilityId: null, natureId: null, itemId: null, moveIds: [] }, new Set(formMap.keys()))) }
  function addMove(member: TeamMember, moveId: string): void { if (!learnsets) return; const allowed = new Set(resolveEffectiveLearnsetMoveIds(learnsets, member.formId)); setMembers(members.map(item => item.memberId === member.memberId ? updateMemberMoves(item, [...item.moveIds, moveId], allowed) : item)); moveQueryByMember = { ...moveQueryByMember, [member.memberId]: '' } }
  function removeMove(member: TeamMember, moveId: string): void { setMembers(members.map(item => item.memberId === member.memberId ? { ...item, moveIds: item.moveIds.filter(id => id !== moveId) } : item)) }
  function removeMember(memberId: string): void { setMembers(removeTeamMember(members, memberId)) }
  function movesForForm(formId: string): RuntimeMove[] { return learnsets ? resolveEffectiveLearnsetMoveIds(learnsets, formId).map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined) : [] }
  function selectedMoves(member: TeamMember): RuntimeMove[] { return member.moveIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined) }
  function abilitiesFor(form: RuntimeForm): Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> { return form.abilities.flatMap(slot => { const ability = data.abilities.find(candidate => candidate.abilityId === slot.abilityId); return ability ? [{ slot: slot.slot, ability }] : [] }) }
  function setAbility(member: TeamMember, form: RuntimeForm, abilityId: string | null): void { setMembers(members.map(item => item.memberId === member.memberId ? updateMemberAbility(item, abilityId, form) : item)) }
  function setNature(member: TeamMember, natureId: string | null): void { const ids = new Set(data.natures.map(nature => nature.natureId)); setMembers(members.map(item => item.memberId === member.memberId ? updateMemberNature(item, natureId, ids) : item)) }
  function natureEffect(nature: RuntimeNature): string { return nature.neutral ? '无能力修正' : `${statLabel(nature.plusStat!).zh}+ · ${statLabel(nature.minusStat!).zh}-` }
  function natureOption(nature: RuntimeNature): string { return `${natureLabel(nature.natureId, nature.canonicalName).zh}（${natureEffect(nature)}）` }
  function selectedNature(member: TeamMember): RuntimeNature | null { return data.natures.find(nature => nature.natureId === member.natureId) ?? null }
  function natureInputValue(member: TeamMember): string { return natureQueryByMember[member.memberId] ?? (selectedNature(member) ? natureOption(selectedNature(member)!) : '') }
  function handleNatureInput(member: TeamMember, value: string): void { natureQueryByMember = { ...natureQueryByMember, [member.memberId]: value }; const match = data.natures.find(nature => natureOption(nature) === value); if (match) setNature(member, match.natureId); else if (!value.trim()) setNature(member, null) }
  function natureSuggestions(member: TeamMember): RuntimeNature[] { const query = natureInputValue(member).trim().toLocaleLowerCase('zh-CN'); if (!query) return []; return data.natures.filter(nature => natureOption(nature).toLocaleLowerCase('zh-CN').includes(query)) }
  function handleNatureKeydown(event: KeyboardEvent, member: TeamMember): void { if (event.key !== 'Enter') return; const first = natureSuggestions(member)[0]; if (!first) return; event.preventDefault(); natureQueryByMember = { ...natureQueryByMember, [member.memberId]: natureOption(first) }; setNature(member, first.natureId) }
  function moveSuggestions(member: TeamMember, formId: string, queryValue: string): RuntimeMove[] { const query = queryValue.trim().toLocaleLowerCase('zh-CN'); if (!query) return []; return movesForForm(formId).filter(move => !member.moveIds.includes(move.moveId) && `${move.zhName ?? ''} ${move.canonicalName}`.toLocaleLowerCase('zh-CN').includes(query)).slice(0, 8) }
  function setMoveQuery(memberId: string, value: string): void { moveQueryByMember = { ...moveQueryByMember, [memberId]: value } }
  function handleMoveKeydown(event: KeyboardEvent, member: TeamMember, formId: string): void { const results = moveSuggestions(member, formId, moveQueryByMember[member.memberId] ?? ''); if (event.key === 'Escape') setMoveQuery(member.memberId, ''); else if (event.key === 'Enter' && results.length) { event.preventDefault(); addMove(member, results[0].moveId) } }
  function typePresentation(typeId: string) { return pokemonTypePresentation(typeId, data.types.find(type => type.typeId === typeId)?.canonicalName) }
  onMount(() => { if (!learnsets) onRequestLearnsets() })
  $: formMap = formsById(data)
  $: resolvedMembers = members.flatMap(member => { const form = formMap.get(member.formId); return form ? [{ member, form }] : [] })
  $: memberForms = resolvedMembers.map(item => item.form)
  $: defensive = defensiveSummary(memberForms, data.types)
  $: coverage = offensiveCoverage(members, data.moves, data.types)
  $: validateTeamMembers(data, members)
</script>

<section class="team-builder">
  <h2>队伍构建 <small>Team Builder</small></h2>
  <p>队伍会自动保存在此浏览器中；不进行推荐、合法性判断或战术评分。</p>
  {#if learnsetsLoading}<p class="status" role="status" aria-live="polite">正在加载可学招式；队伍成员和已保存招式仍可使用。</p>{:else if learnsetsError}<div class="status error" role="alert"><strong>可学招式加载失败</strong><p>队伍结构与已保存招式已保留；加入新招式暂不可用。</p><button type="button" onclick={onRequestLearnsets}>重试</button></div>{/if}
  <div class="team-state-actions"><button type="button" disabled={!members.length} onclick={onCopyShareLink}>复制分享链接</button><button type="button" onclick={onClearSavedTeam}>清除已保存队伍</button>{#if shareStatus}<p class="status" aria-live="polite">{shareStatus}</p>{/if}</div>
  <div class="team-add"><p>当前队伍：{members.length} / 6</p>{#if selectedForm}<p>当前选择：{formDisplay(selectedForm)}</p><button type="button" disabled={members.length >= 6} onclick={addCurrent}>{members.length >= 6 ? '队伍已满' : '加入当前形态'}</button>{:else}<p>请先在“宝可梦查询”中选择一个形态。</p>{/if}</div>
  {#if resolvedMembers.length}
    <div class="team-members">
      {#each resolvedMembers as { member, form } (member.memberId)}
        <article class="team-member">
          <header class="team-member-header"><div><h3>{formDisplay(form)}</h3><div class="type-badges">{#each form.types as typeId (typeId)}{@const type = typePresentation(typeId)}<span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span>{/each}</div></div><button type="button" onclick={() => removeMember(member.memberId)}>移除</button></header>
          <section class="team-card-field"><strong>携带道具</strong><p class="team-data-note">当前运行时数据没有中文道具名称，暂不开放选择。</p></section>
          <label class="team-card-field">性格<input type="search" list={`nature-options-${member.memberId}`} value={natureInputValue(member)} oninput={(event) => handleNatureInput(member, (event.currentTarget as HTMLInputElement).value)} onkeydown={(event) => handleNatureKeydown(event, member)} placeholder="输入或选择性格" /><datalist id={`nature-options-${member.memberId}`}>{#each data.natures as nature (nature.natureId)}<option value={natureOption(nature)}></option>{/each}</datalist>{#if selectedNature(member)}<small>{natureEffect(selectedNature(member)!)}</small>{/if}</label>
          <label class="team-card-field">特性<select value={member.abilityId ?? ''} onchange={(event) => setAbility(member, form, (event.currentTarget as HTMLSelectElement).value || null)}><option value="">未选择</option>{#each abilitiesFor(form) as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{abilitySlotLabel(slot)} · {ability.zhName ?? '暂无中文'}</option>{/each}</select></label>
          {#if member.abilityId && data.abilities.find(ability => ability.abilityId === member.abilityId)?.mechanics.status === 'unsupported'}<p class="status">该特性机制尚未建模，不会改变事实分析。</p>{/if}
          <section class="team-card-field team-moves"><strong>招式（{member.moveIds.length} / 4）</strong>{#if learnsets}<div class="team-move-search"><input type="search" role="combobox" aria-label={`${formDisplay(form)}检索招式`} aria-controls={`move-options-${member.memberId}`} aria-expanded={moveSuggestions(member, form.formId, moveQueryByMember[member.memberId] ?? '').length > 0} value={moveQueryByMember[member.memberId] ?? ''} oninput={(event) => setMoveQuery(member.memberId, (event.currentTarget as HTMLInputElement).value)} onkeydown={(event) => handleMoveKeydown(event, member, form.formId)} disabled={member.moveIds.length >= 4} placeholder={member.moveIds.length >= 4 ? '四个招式已满' : '输入招式名称'} />{#if moveSuggestions(member, form.formId, moveQueryByMember[member.memberId] ?? '').length}<div id={`move-options-${member.memberId}`} class="team-move-suggestions" role="listbox">{#each moveSuggestions(member, form.formId, moveQueryByMember[member.memberId] ?? '') as move (move.moveId)}<button type="button" role="option" aria-selected="false" onclick={() => addMove(member, move.moveId)}>{move.zhName ?? '暂无中文'}</button>{/each}</div>{/if}</div>{:else}<p class="status">可学招式尚未加载。</p>{/if}
            <ul class="team-move-slots">{#each selectedMoves(member) as move (move.moveId)}{@const moveType = typePresentation(move.typeId)}{@const moveCategory = moveCategoryPresentation(move.category)}<li><span class="team-move-name">{move.zhName ?? '暂无中文'}</span><span class="type-badge" style={`--type-background: ${moveType.background}; --type-foreground: ${moveType.foreground}`}>{moveType.label}</span><span class="move-category-badge" style={`--category-background: ${moveCategory.background}; --category-foreground: ${moveCategory.foreground}`}>{moveCategory.label}</span><button type="button" aria-label={`移除${move.zhName ?? '招式'}`} onclick={() => removeMove(member, move.moveId)}>移除</button></li>{/each}{#each Array(4 - member.moveIds.length) as _, index}<li class="empty" aria-label={`空招式位${index + 1}`}>空招式位</li>{/each}</ul>
          </section>
        </article>
      {/each}
    </div>
    <section class="team-summary"><h3>防守属性汇总 <small>Defensive Summary</small></h3><p>按成员当前形态的实际属性统计：弱点（&gt;1×）、中性（1×）、抗性或免疫（&lt;1×）。</p><div class="team-summary-grid">{#each defensive as entry (entry.attackingTypeId)}{@const type = typePresentation(entry.attackingTypeId)}<div class="team-summary-entry"><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span><span>弱点 {entry.weak}（4× {entry.fourTimesWeak} / 2× {entry.twoTimesWeak}）· 中性 {entry.neutral} · 抗性或免疫 {entry.resistOrImmune}</span></div>{/each}</div></section>
    <section class="team-summary"><h3>简单招式属性覆盖</h3><p>仅按已选招式属性与单一防守属性的标准相性；不考虑属性一致加成、特性、太晶、天气、道具或双属性组合。</p>{#if coverage.length}<div class="team-summary-grid">{#each coverage as entry (entry.defenderTypeId)}{@const defender = typePresentation(entry.defenderTypeId)}<div class="team-summary-entry"><span class="type-badge" style={`--type-background: ${defender.background}; --type-foreground: ${defender.foreground}`}>{defender.label}</span><span>可被</span>{#each entry.moveTypeIds as typeId (typeId)}{@const moveType = typePresentation(typeId)}<span class="type-badge" style={`--type-background: ${moveType.background}; --type-foreground: ${moveType.foreground}`}>{moveType.label}</span>{/each}<span>克制</span></div>{/each}</div>{:else}<p>当前已选招式没有可显示的单属性克制覆盖。</p>{/if}</section>
    <TeamAnalysis {data} {members} />
  {:else}<p class="status">从“宝可梦查询”加入形态和临时招式，开始构建队伍。</p>{/if}
</section>
