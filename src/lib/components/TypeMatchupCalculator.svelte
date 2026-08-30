<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import type { PokemonRuntimeData } from '../runtime-data/types'
  import { pokemonTypePresentation } from '../presentation/labels'
  export let data: PokemonRuntimeData
  let primaryTypeId = 'type:normal'
  let secondaryTypeId = ''
  let primaryQuery = '一般'
  let secondaryQuery = '无'
  function typePresentation(typeId: string) { return pokemonTypePresentation(typeId, data.types.find(type => type.typeId === typeId)?.canonicalName) }
  function matchingTypes(query: string, excludedTypeId = '') { const normalized = query.trim().toLocaleLowerCase('zh-CN'); if (!normalized) return []; return data.types.filter(type => type.typeId !== excludedTypeId && typePresentation(type.typeId).label.toLocaleLowerCase('zh-CN').includes(normalized)) }
  function selectPrimary(typeId: string): void { primaryTypeId = typeId; primaryQuery = typePresentation(typeId).label; if (secondaryTypeId === typeId) { secondaryTypeId = ''; secondaryQuery = '无' } }
  function selectSecondary(typeId: string): void { secondaryTypeId = typeId; secondaryQuery = typeId ? typePresentation(typeId).label : '无' }
  function handlePrimaryInput(value: string): void { primaryQuery = value; const match = data.types.find(type => typePresentation(type.typeId).label === value); if (match) selectPrimary(match.typeId) }
  function handleSecondaryInput(value: string): void { secondaryQuery = value; if (!value.trim() || value === '无') selectSecondary(''); else { const match = data.types.find(type => type.typeId !== primaryTypeId && typePresentation(type.typeId).label === value); if (match) selectSecondary(match.typeId) } }
  function handlePrimaryKeydown(event: KeyboardEvent): void { if (event.key !== 'Enter') return; const first = matchingTypes(primaryQuery)[0]; if (!first) return; event.preventDefault(); selectPrimary(first.typeId) }
  function handleSecondaryKeydown(event: KeyboardEvent): void { if (event.key !== 'Enter') return; if (!secondaryQuery.trim() || secondaryQuery === '无') { event.preventDefault(); selectSecondary(''); return } const first = matchingTypes(secondaryQuery, primaryTypeId)[0]; if (!first) return; event.preventDefault(); selectSecondary(first.typeId) }
  $: groups = groupDefensiveMatchup(calculateDefensiveMatchup(data.types, primaryTypeId, secondaryTypeId || undefined))
</script>
<section class="calculator">
  <h2>属性相性 <small>Type Matchup</small></h2><p>计算指定防守属性受到各攻击属性时的标准倍率。</p>
  <div class="type-selects"><label>属性 1<input type="search" list="primary-type-options" value={primaryQuery} oninput={(event) => handlePrimaryInput((event.currentTarget as HTMLInputElement).value)} onkeydown={handlePrimaryKeydown} placeholder="输入或选择属性" /><datalist id="primary-type-options">{#each data.types as type (type.typeId)}<option value={typePresentation(type.typeId).label}></option>{/each}</datalist></label><label>属性 2（可选）<input type="search" list="secondary-type-options" value={secondaryQuery} oninput={(event) => handleSecondaryInput((event.currentTarget as HTMLInputElement).value)} onkeydown={handleSecondaryKeydown} placeholder="输入或选择属性" /><datalist id="secondary-type-options"><option value="无"></option>{#each data.types.filter(type => type.typeId !== primaryTypeId) as type (type.typeId)}<option value={typePresentation(type.typeId).label}></option>{/each}</datalist></label></div>
  <div class="matchup-groups">{#each groups as group (group.multiplier)}<div class="matchup-row"><strong>{group.multiplier}×</strong><div class="type-badges">{#each group.entries as entry (entry.attackingTypeId)}{@const presentation = typePresentation(entry.attackingTypeId)}<span class="type-badge" style={`--type-background: ${presentation.background}; --type-foreground: ${presentation.foreground}`}>{presentation.label}</span>{/each}</div></div>{/each}</div>
</section>
