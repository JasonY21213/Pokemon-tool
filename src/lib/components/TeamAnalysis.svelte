<script lang="ts">
  import { analyzeAbilityAdjustedDefenses, analyzeDefensiveTypes, analyzeOffensiveCoverage, defensiveGaps, repeatedWeaknesses } from '../runtime-data/team-analysis'
  import { formsById, type TeamMember } from '../runtime-data/team-builder'
  import type { PokemonRuntimeData } from '../runtime-data/types'
  import { pokemonTypePresentation } from '../presentation/labels'
  export let data: PokemonRuntimeData
  export let members: TeamMember[]
  function typePresentation(id: string) { return pokemonTypePresentation(id, data.types.find(candidate => candidate.typeId === id)?.canonicalName) }
  function formName(formId: string): string { const form = formMap.get(formId); if (!form) return '未知形态'; const species = data.species.find(item => item.speciesId === form.speciesId); const name = form.zhName ?? '暂无中文形态名'; return species && name !== species.zhName ? `${species.zhName}（${name}）` : name }
  $: formMap = formsById(data)
  $: defensive = analyzeDefensiveTypes(members, formMap, data.types)
  $: repeated = repeatedWeaknesses(defensive)
  $: gaps = defensiveGaps(defensive)
  $: immunities = defensive.filter(item => item.immune > 0)
  $: resistanceCoverage = defensive.filter(item => item.resist > 0)
  $: abilityAdjusted = analyzeAbilityAdjustedDefenses(members, formMap, data.abilities, data.types)
  $: offensive = analyzeOffensiveCoverage(members, data.moves, data.types)
</script>

<section class="team-analysis">
  <h3>队伍事实分析 <small>Team Analysis</small></h3><p>主要防守结论仅来自当前形态的原始属性倍率；已明确选择且受支持的特性显示在独立附加视图中。不考虑种族值、道具、生命值、太晶或实际换入安全性。</p>
  <section><h4>重复弱点 <small>Repeated Weaknesses</small>（至少 2 名成员）</h4>{#if repeated.length}<ul>{#each repeated as item (item.attackingTypeId)}{@const type = typePresentation(item.attackingTypeId)}<li><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span><span>{item.weak} 名成员为弱点，最高 {item.maxWeaknessMultiplier}×；{item.weakContributors.map(entry => `${formName(entry.formId)} ${entry.multiplier}×`).join('、')}</span></li>{/each}</ul>{:else}<p>当前没有至少两名成员共享的属性弱点。</p>{/if}</section>
  <section><h4>无防守属性抗性或免疫</h4><p>仅列出“至少一名成员为弱点，且没有成员抗性或免疫”的攻击属性；这不代表实际无法换入。</p>{#if gaps.length}<ul>{#each gaps as item (item.attackingTypeId)}{@const type = typePresentation(item.attackingTypeId)}<li><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span><span>弱 {item.weak} · 中 {item.neutral} · 抗 {item.resist} · 免 {item.immune}</span></li>{/each}</ul>{:else}<p>当前没有符合该纯属性条件的项目。</p>{/if}</section>
  <section><h4>抗性与免疫分布</h4><div class="analysis-type-list"><strong>存在抗性的属性：</strong>{#if resistanceCoverage.length}{#each resistanceCoverage as item (item.attackingTypeId)}{@const type = typePresentation(item.attackingTypeId)}<span class="type-count"><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span> {item.resist}</span>{/each}{:else}<span>无</span>{/if}</div><div class="analysis-type-list"><strong>存在免疫的属性：</strong>{#if immunities.length}{#each immunities as item (item.attackingTypeId)}{@const type = typePresentation(item.attackingTypeId)}<span class="type-count"><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span> {item.immune}</span>{/each}{:else}<span>无</span>{/if}</div></section>
  <section><h4>已选特性的防守变化</h4><p>这是原始属性分析之外的附加视图；未选择或未建模的特性不会产生变化。</p>{#if abilityAdjusted.length}<ul>{#each abilityAdjusted as item (item.attackingTypeId)}{@const type = typePresentation(item.attackingTypeId)}<li><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span><span>{item.contributors.map(entry => `${formName(entry.formId)} ${data.abilities.find(ability => ability.abilityId === entry.abilityId)?.zhName ?? '暂无中文'}，${entry.rawMultiplier}× → ${entry.adjustedMultiplier}×`).join('；')}</span></li>{/each}</ul>{:else}<p>当前没有已选择且受支持的防守特性效果。</p>{/if}</section>
  <section><h4>简单招式属性覆盖</h4><p>仅使用实际已选招式与单一防守属性的 &gt;1× 标准相性；不考虑属性一致加成、威力、命中、特性、太晶、天气或双属性组合。</p>{#if !offensive.available}<p class="status">尚未选择队伍招式，无法判断简单招式属性覆盖。</p>{:else}<div class="analysis-type-list"><strong>没有超级有效招式覆盖的属性：</strong>{#if offensive.gaps.length}{#each offensive.gaps as typeId (typeId)}{@const type = typePresentation(typeId)}<span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span>{/each}{:else}<span>无</span>{/if}</div><div class="team-summary-grid">{#each offensive.covered as item (item.defenderTypeId)}{@const type = typePresentation(item.defenderTypeId)}<div class="team-summary-entry"><span class="type-badge" style={`--type-background: ${type.background}; --type-foreground: ${type.foreground}`}>{type.label}</span><span>{item.contributors.map(entry => `${formName(entry.formId)}的${data.moves.find(move => move.moveId === entry.moveId)?.zhName ?? '暂无中文'}`).join('；')}</span></div>{/each}</div>{/if}</section>
</section>
