<script lang="ts">
  import { addTeamMember, defensiveSummary, formsById, offensiveCoverage, removeTeamMember, updateMemberAbility, updateMemberMoves, validateTeamMembers, type TeamMember } from '../runtime-data/team-builder'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeForm, RuntimeMove } from '../runtime-data/types'
  import TeamAnalysis from './TeamAnalysis.svelte'
  export let data: PokemonRuntimeData
  export let selectedForm: RuntimeForm | null
  export let members: TeamMember[] = []
  export let onMembersChange: (members: TeamMember[]) => void = () => {}
  export let onClearSavedTeam: () => void = () => {}
  export let onCopyShareLink: () => void = () => {}
  export let shareStatus = ''
  let selectedMoveByMember: Record<string, string> = {}
  const typeName = (typeId: string) => data.types.find(type => type.typeId === typeId)?.canonicalName ?? typeId
  function formDisplay(form: RuntimeForm): string { const species = data.species.find(item => item.speciesId === form.speciesId); const name = form.zhName ?? form.canonicalName; return species && species.zhName !== name ? `${species.zhName}（${name}）` : name }
  function setMembers(updated: TeamMember[]): void { onMembersChange(updated) }
  function nextMemberId(): string { let number = 1; while (members.some(member => member.memberId === `team-member-${number}`)) number += 1; return `team-member-${number}` }
  function addCurrent(): void { if (!selectedForm) return; const updated = addTeamMember(members, { memberId: nextMemberId(), formId: selectedForm.formId, abilityId: null, moveIds: [] }, new Set(formMap.keys())); setMembers(updated) }
  function addMove(member: TeamMember): void { const moveId = selectedMoveByMember[member.memberId]; if (!moveId) return; const allowed = new Set(resolveEffectiveLearnsetMoveIds(data.learnsets, member.formId)); setMembers(members.map(item => item.memberId === member.memberId ? updateMemberMoves(item, [...item.moveIds, moveId], allowed) : item)) }
  function removeMove(member: TeamMember, moveId: string): void { setMembers(members.map(item => item.memberId === member.memberId ? { ...item, moveIds: item.moveIds.filter(id => id !== moveId) } : item)) }
  function removeMember(memberId: string): void { setMembers(removeTeamMember(members, memberId)) }
  function movesForForm(formId: string): RuntimeMove[] { return resolveEffectiveLearnsetMoveIds(data.learnsets, formId).map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined) }
  function selectedMoves(member: TeamMember): RuntimeMove[] { return member.moveIds.map(id => data.moves.find(move => move.moveId === id)).filter((move): move is RuntimeMove => move !== undefined) }
  function abilitiesFor(form: RuntimeForm): Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> { return form.abilities.flatMap(slot => { const ability = data.abilities.find(candidate => candidate.abilityId === slot.abilityId); return ability ? [{ slot: slot.slot, ability }] : [] }) }
  function setAbility(member: TeamMember, form: RuntimeForm, abilityId: string | null): void { setMembers(members.map(item => item.memberId === member.memberId ? updateMemberAbility(item, abilityId, form) : item)) }
  $: formMap = formsById(data)
  $: resolvedMembers = members.flatMap(member => { const form = formMap.get(member.formId); return form ? [{ member, form }] : [] })
  $: memberForms = resolvedMembers.map(item => item.form)
  $: defensive = defensiveSummary(memberForms, data.types)
  $: coverage = offensiveCoverage(members, data.moves, data.types)
  $: validateTeamMembers(data, members)
</script>

<section class="team-builder">
  <h2>队伍构建器</h2><p>队伍会自动保存在此浏览器中；不进行推荐、合法性判断或战术评分。</p>
  <div class="team-state-actions"><button type="button" disabled={!members.length} onclick={onCopyShareLink}>复制分享链接</button><button type="button" onclick={onClearSavedTeam}>清除已保存队伍</button>{#if shareStatus}<p class="status" aria-live="polite">{shareStatus}</p>{/if}</div>
  <div class="team-add"><p>当前队伍：{members.length} / 6</p>{#if selectedForm}<p>当前选择：{formDisplay(selectedForm)}</p><button type="button" disabled={members.length >= 6} onclick={addCurrent}>{members.length >= 6 ? '队伍已满' : '加入当前形态'}</button>{:else}<p>请先在“宝可梦查询”中选择一个形态。</p>{/if}</div>
  {#if resolvedMembers.length}<div class="team-members">{#each resolvedMembers as { member, form } (member.memberId)}<article class="team-member"><div><h3>{formDisplay(form)} <small>{form.canonicalName}</small></h3><p>属性：{form.types.map(typeName).join(' / ')}</p></div><button type="button" onclick={() => removeMember(member.memberId)}>移除成员</button><label>特性效果<select value={member.abilityId} onchange={(event) => setAbility(member, form, (event.currentTarget as HTMLSelectElement).value || null)}><option value="">不启用</option>{#each abilitiesFor(form) as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>{#if member.abilityId && data.abilities.find(ability => ability.abilityId === member.abilityId)?.mechanics.status === 'unsupported'}<p class="status">该特性机制未建模，不会改变事实分析。</p>{/if}<label>从该形态 Learnset 加入招式<select bind:value={selectedMoveByMember[member.memberId]}><option value="">选择招式</option>{#each movesForForm(form.formId) as move (move.moveId)}<option value={move.moveId}>{move.zhName ?? move.canonicalName} · {move.canonicalName}</option>{/each}</select></label><button type="button" disabled={!selectedMoveByMember[member.memberId] || member.moveIds.length >= 4} onclick={() => addMove(member)}>加入招式（{member.moveIds.length} / 4）</button>{#if member.moveIds.length}<ul>{#each selectedMoves(member) as move (move.moveId)}<li>{move.zhName ?? move.canonicalName} <small>{move.canonicalName}</small> <button type="button" onclick={() => removeMove(member, move.moveId)}>移除</button></li>{/each}</ul>{:else}<p>尚未选择招式；该成员不会计入下方的简单招式属性覆盖。</p>{/if}</article>{/each}</div>
    <section class="team-summary"><h3>防守属性汇总</h3><p>按成员当前 Form 的实际属性统计：弱点（&gt;1×）、中性（1×）、抗性或免疫（&lt;1×）。</p><div class="team-summary-grid">{#each defensive as entry (entry.attackingTypeId)}<span><strong>{typeName(entry.attackingTypeId)}</strong> 弱 {entry.weak}（4× {entry.fourTimesWeak} / 2× {entry.twoTimesWeak}）· 中 {entry.neutral} · 抗/免 {entry.resistOrImmune}</span>{/each}</div></section>
    <section class="team-summary"><h3>简单招式属性覆盖</h3><p>仅按已选招式属性与单一防守属性的标准相性；不考虑 STAB、特性、太晶、天气、道具或双属性组合。</p>{#if coverage.length}<div class="team-summary-grid">{#each coverage as entry (entry.defenderTypeId)}<span><strong>{typeName(entry.defenderTypeId)}</strong>：{entry.moveTypeIds.map(typeName).join('、')}</span>{/each}</div>{:else}<p>当前已选招式没有可显示的单属性克制覆盖。</p>{/if}</section>
    <TeamAnalysis {data} {members} />
  {:else}<p class="status">加入一个当前选择的形态，开始查看队伍事实汇总。</p>{/if}
</section>
