<script lang="ts">
  import { calculateDefensiveMatchup, groupDefensiveMatchup } from '../runtime-data/type-matchup'
  import type { PokemonRuntimeData } from '../runtime-data/types'
  export let data: PokemonRuntimeData
  let primaryTypeId = 'type:normal'
  let secondaryTypeId = ''
  $: groups = groupDefensiveMatchup(calculateDefensiveMatchup(data.types, primaryTypeId, secondaryTypeId || undefined))
</script>
<section class="calculator">
  <h2>属性相性计算器</h2><p>计算指定防守属性受到各攻击属性时的标准倍率。</p>
  <div class="type-selects"><label>属性 1<select bind:value={primaryTypeId}>{#each data.types as type (type.typeId)}<option value={type.typeId}>{type.canonicalName}</option>{/each}</select></label><label>属性 2（可选）<select bind:value={secondaryTypeId}><option value="">无</option>{#each data.types.filter(type => type.typeId !== primaryTypeId) as type (type.typeId)}<option value={type.typeId}>{type.canonicalName}</option>{/each}</select></label></div>
  <div class="matchup-groups">{#each groups as group (group.multiplier)}<p><strong>{group.multiplier}×</strong>：{group.entries.map(entry => data.types.find(type => type.typeId === entry.attackingTypeId)?.canonicalName ?? entry.attackingTypeId).join('、')}</p>{/each}</div>
</section>
