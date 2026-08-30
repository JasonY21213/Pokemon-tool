<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import type { PokemonRuntimeData } from '../runtime-data/types'
  import { formatLabel, typeLabel } from '../presentation/labels'
  export let data: PokemonRuntimeData
  let primaryTypeId = 'type:normal'
  let secondaryTypeId = ''
  function typeName(typeId: string): string { const type = data.types.find(candidate => candidate.typeId === typeId); return formatLabel(typeLabel(typeId, type?.canonicalName ?? typeId)) }
  $: groups = groupDefensiveMatchup(calculateDefensiveMatchup(data.types, primaryTypeId, secondaryTypeId || undefined))
</script>
<section class="calculator">
  <h2>属性相性 <small>Type Matchup</small></h2><p>计算指定防守属性受到各攻击属性时的标准倍率。</p>
  <div class="type-selects"><label>属性 1 <small>Primary Type</small><select bind:value={primaryTypeId}>{#each data.types as type (type.typeId)}<option value={type.typeId}>{formatLabel(typeLabel(type.typeId, type.canonicalName))}</option>{/each}</select></label><label>属性 2（可选） <small>Secondary Type</small><select bind:value={secondaryTypeId}><option value="">无 / None</option>{#each data.types.filter(type => type.typeId !== primaryTypeId) as type (type.typeId)}<option value={type.typeId}>{formatLabel(typeLabel(type.typeId, type.canonicalName))}</option>{/each}</select></label></div>
  <div class="matchup-groups">{#each groups as group (group.multiplier)}<p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => typeName(entry.attackingTypeId)).join('、')}</p>{/each}</div>
</section>
