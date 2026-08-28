<script lang="ts">
  import { analyzeDefensiveTypes, analyzeOffensiveCoverage, defensiveGaps, repeatedWeaknesses } from '../runtime-data/team-analysis'
  import { formsById, type TeamMember } from '../runtime-data/team-builder'
  import type { PokemonRuntimeData, RuntimeForm } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  export let members: TeamMember[]
  const typeName = (id: string) => data.types.find(type => type.typeId === id)?.canonicalName ?? id
  function formName(formId: string): string { const form = formMap.get(formId); if (!form) return formId; const species = data.species.find(item => item.speciesId === form.speciesId); const name = form.zhName ?? form.canonicalName; return species && name !== species.zhName ? `${species.zhName}（${name}）` : name }
  $: formMap = formsById(data)
  $: defensive = analyzeDefensiveTypes(members, formMap, data.types)
  $: repeated = repeatedWeaknesses(defensive)
  $: gaps = defensiveGaps(defensive)
  $: immunities = defensive.filter(item => item.immune > 0)
  $: resistanceCoverage = defensive.filter(item => item.resist > 0)
  $: offensive = analyzeOffensiveCoverage(members, data.moves, data.types)
</script>

<section class="team-analysis">
  <h3>队伍事实分析</h3><p>所有防守结论仅来自当前 Form 的属性倍率；不考虑种族值、特性、道具、HP、太晶或实际换入安全性。</p>
  <section><h4>重复弱点（至少 2 名成员）</h4>{#if repeated.length}<ul>{#each repeated as item (item.attackingTypeId)}<li><strong>{typeName(item.attackingTypeId)}</strong>：{item.weak} 名成员弱点，最高 {item.maxWeaknessMultiplier}×；{item.weakContributors.map(entry => `${formName(entry.formId)} ${entry.multiplier}×`).join('、')}</li>{/each}</ul>{:else}<p>当前没有至少两名成员共享的属性弱点。</p>{/if}</section>
  <section><h4>无防守属性抗性/免疫</h4><p>仅列出“至少一名成员弱点，且没有成员抗性或免疫”的攻击属性；这不代表实际无法换入。</p>{#if gaps.length}<ul>{#each gaps as item (item.attackingTypeId)}<li><strong>{typeName(item.attackingTypeId)}</strong>：弱 {item.weak} · 中 {item.neutral} · 抗 {item.resist} · 免 {item.immune}</li>{/each}</ul>{:else}<p>当前没有符合该纯属性条件的项目。</p>{/if}</section>
  <section><h4>抗性与免疫分布</h4><p>存在抗性的属性：{resistanceCoverage.length ? resistanceCoverage.map(item => `${typeName(item.attackingTypeId)}（${item.resist}）`).join('、') : '无'}。</p><p>存在免疫的属性：{immunities.length ? immunities.map(item => `${typeName(item.attackingTypeId)}（${item.immune}）`).join('、') : '无'}。</p></section>
  <section><h4>简单招式属性覆盖</h4><p>仅使用实际已选招式与单一防守属性的 &gt;1× 标准相性；不考虑 STAB、威力、命中、特性、太晶、天气或双属性组合。</p>{#if !offensive.available}<p class="status">尚未选择队伍招式，无法判断简单招式属性覆盖。</p>{:else}<p>没有超级有效已选招式覆盖的单一属性：{offensive.gaps.length ? offensive.gaps.map(typeName).join('、') : '无'}。</p><div class="team-summary-grid">{#each offensive.covered as item (item.defenderTypeId)}<span><strong>{typeName(item.defenderTypeId)}</strong>：{item.contributors.map(entry => `${formName(entry.formId)} / ${data.moves.find(move => move.moveId === entry.moveId)?.zhName ?? entry.moveId}`).join('；')}</span>{/each}</div>{/if}</section>
</section>
