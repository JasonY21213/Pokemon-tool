<script lang="ts">
  import { calculateMoveDamage, type AppliedBattleContextModifier, type AppliedTerrainEffect, type MoveDamageResult } from '../runtime-data/damage-calculator'
  import type { BattleContext, BattleStatStage, BattleTerrain, BattleWeather } from '../runtime-data/battle-context'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import { calculateStats, totalEvs } from '../runtime-data/stat-calculator'
  import { selectAbilityForForm } from '../runtime-data/ability-mechanics'
  import { STANDARD_TERA_TYPE_IDS, type ResolvedStab, type StandardTeraTypeId, type TerastallizationState } from '../runtime-data/terastallization'
  import type { PokemonRuntimeData, RuntimeAbility, RuntimeAbilityMechanicsEffect, RuntimeForm, RuntimeItem, RuntimeItemMechanicsEffect, RuntimeMove, RuntimeMoveDamageUnsupportedReason, RuntimeSpecies, RuntimeStatBlock } from '../runtime-data/types'

  export let data: PokemonRuntimeData

  const statIds = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
  const statLabels: Record<(typeof statIds)[number], string> = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' }
  const all31 = (): RuntimeStatBlock => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 })
  const all0 = (): RuntimeStatBlock => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })
  const stageOptions: BattleStatStage[] = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]

  let attackerSpeciesId = 'species:0006'
  let attackerFormId = 'form:0006:base'
  let attackerLevel = 50
  let attackerNatureId = 'nature:hardy'
  let attackerAbilityId: string | null = null
  let attackerItemId: string | null = null
  let attackerTeraTypeId: StandardTeraTypeId | '' = ''
  let attackerIvs = all31()
  let attackerEvs = all0()
  let defenderSpeciesId = 'species:0035'
  let defenderFormId = 'form:0035:base'
  let defenderLevel = 50
  let defenderNatureId = 'nature:hardy'
  let defenderAbilityId: string | null = null
  let defenderTeraTypeId: StandardTeraTypeId | '' = ''
  let defenderIvs = all31()
  let defenderEvs = all0()
  let moveQuery = ''
  let learnsetOnly = false
  let selectedMoveId = 'move:0053'
  let attackerAtkStage: BattleStatStage = 0
  let attackerSpaStage: BattleStatStage = 0
  let defenderDefStage: BattleStatStage = 0
  let defenderSpdStage: BattleStatStage = 0
  let attackerBurned = false
  let weather: BattleWeather = 'none'
  let terrain: BattleTerrain = 'none'
  let criticalHit = false
  let reflect = false
  let lightScreen = false

  function formsFor(species: RuntimeSpecies | undefined): RuntimeForm[] {
    if (!species) return []
    return species.formIds.flatMap(id => {
      const form = data.forms.find(candidate => candidate.formId === id)
      return form ? [form] : []
    })
  }

  function resetAttackerForm(): void {
    const species = data.species.find(candidate => candidate.speciesId === attackerSpeciesId)
    attackerFormId = species?.defaultFormId ?? ''
    attackerAbilityId = null
  }

  function resetDefenderForm(): void {
    const species = data.species.find(candidate => candidate.speciesId === defenderSpeciesId)
    defenderFormId = species?.defaultFormId ?? ''
    defenderAbilityId = null
  }

  function abilitiesFor(form: RuntimeForm | undefined): Array<{ slot: RuntimeForm['abilities'][number]['slot']; ability: RuntimeAbility }> {
    return form ? form.abilities.flatMap(slot => { const ability = data.abilities.find(candidate => candidate.abilityId === slot.abilityId); return ability ? [{ slot: slot.slot, ability }] : [] }) : []
  }

  function abilityEffectLabel(effect: RuntimeAbilityMechanicsEffect): string {
    if (effect.kind === 'incoming-type-immunity') return `${typeName(effect.typeId)} 伤害免疫`
    if (effect.kind === 'incoming-type-attack-multiplier') return `${effect.typeIds.map(typeName).join('/')} 攻击能力修正 ${effect.multiplier}×`
    if (effect.kind === 'super-effective-damage-multiplier') return `效果绝佳伤害 ${effect.multiplier}×`
    return `STAB ${effect.multiplier}×`
  }

  function itemEffectLabel(effect: RuntimeItemMechanicsEffect): string {
    const multiplier = `${(effect.numerator / effect.denominator).toFixed(effect.denominator === 2 ? 1 : 2)}×`
    if (effect.kind === 'attack-stat-multiplier') return `物理攻击能力 ${multiplier}；未模拟招式锁定`
    if (effect.kind === 'special-attack-stat-multiplier') return `特殊攻击能力 ${multiplier}；未模拟招式锁定`
    if (effect.kind === 'final-damage-multiplier') return `最终伤害 ${multiplier}；未模拟反作用伤害`
    if (effect.kind === 'super-effective-damage-multiplier') return `效果绝佳伤害 ${multiplier}`
    return `${typeName(effect.typeId)} 招式威力 ${multiplier}`
  }

  function displayForm(form: RuntimeForm, species: RuntimeSpecies | undefined): string {
    const name = form.zhName ?? form.canonicalName
    return species && name === species.zhName ? species.zhName : name
  }

  function sideStats(species: RuntimeSpecies | undefined, form: RuntimeForm | undefined, level: number, natureId: string, ivs: RuntimeStatBlock, evs: RuntimeStatBlock): { stats: RuntimeStatBlock | null; error: string | null } {
    const nature = data.natures.find(candidate => candidate.natureId === natureId)
    if (!species || !form || !nature) return { stats: null, error: '配置不完整。' }
    try {
      return { stats: calculateStats({ speciesId: species.speciesId, baseStats: form.baseStats, level, nature, ivs, evs }), error: null }
    } catch (cause) {
      return { stats: null, error: cause instanceof Error && cause.message === 'STAT_CALCULATOR_EV_TOTAL_EXCEEDED' ? '努力值总和不能超过 510。' : '等级、IV 或 EV 超出允许范围。' }
    }
  }

  function supportLabel(move: RuntimeMove): string {
    if (move.damageSupport.status === 'supported') return '支持'
    if (move.damageSupport.status === 'non-damaging') return '变化招式'
    if (move.damageSupport.status === 'incomplete') return '资料不完整'
    return '特殊机制暂不支持'
  }

  const unsupportedLabels: Record<RuntimeMoveDamageUnsupportedReason, string> = {
    'non-numeric-base-power': '没有可用于普通公式的固定威力。',
    'variable-base-power': '威力会随战斗条件变化。',
    'fixed-or-counter-damage': '使用固定伤害、反击或其他非普通伤害规则。',
    ohko: '一击必杀招式不使用普通伤害公式。',
    'multi-hit': '多段招式的完整伤害分布尚未实现。',
    'spread-target': '范围招式需要尚未实现的多目标伤害修正。',
    'max-or-z-move': '极巨招式、超极巨招式或 Z 招式不在本阶段范围内。',
    'nonstandard-stat-selection': '该招式不使用分类对应的普通攻防能力值。',
    'nonstandard-type-effectiveness': '该招式会改变普通属性免疫或克制规则。',
    'dynamic-move-type': '招式属性会随战斗条件变化。',
    'dynamic-move-mechanics': '招式分类、威力或其他伤害语义会动态变化。',
    'forced-critical-hit': '该招式强制要害攻击，而本阶段不计算要害。',
    'damage-cap': '该招式包含防止击倒等伤害上限规则。',
    'conditional-immunity': '该招式有额外的命中或免疫条件。',
    'conditional-hit-mechanics': '该招式依赖本阶段未建模的命中条件或战斗状态。',
  }

  function typeName(typeId: string): string {
    return data.types.find(type => type.typeId === typeId)?.canonicalName ?? typeId
  }

  function categoryName(move: RuntimeMove): string {
    return move.category === 'physical' ? '物理' : move.category === 'special' ? '特殊' : '变化'
  }

  function stageLabel(stage: BattleStatStage): string {
    return stage > 0 ? `+${stage}` : String(stage)
  }

  function teraState(typeId: StandardTeraTypeId | ''): TerastallizationState {
    return typeId === '' ? { active: false, teraType: null } : { active: true, teraType: typeId }
  }

  function stabBasisLabel(basis: ResolvedStab['basis']): string {
    if (basis === 'original-type') return '原始属性'
    if (basis === 'tera-type') return '太晶属性'
    if (basis === 'same-type-tera') return '同属性太晶'
    return '无匹配'
  }

  function battleContextModifierLabel(modifier: AppliedBattleContextModifier): string {
    if (modifier.kind === 'stat-stage') return `${modifier.stat.toUpperCase()} ${stageLabel(modifier.stage)}${modifier.effectiveStage !== modifier.stage ? `（要害按 ${stageLabel(modifier.effectiveStage)}）` : ''}：${modifier.before} → ${modifier.after}`
    if (modifier.kind === 'weather') return `${modifier.weather === 'sun' ? '日照' : '下雨'} ${modifier.multiplier}×`
    if (modifier.kind === 'weather-defense-stat') return `${modifier.weather === 'sandstorm' ? '沙暴' : '雪天'}：${modifier.stat.toUpperCase()} ${modifier.before} → ${modifier.after}`
    if (modifier.kind === 'critical-hit') return `普通要害 ${modifier.multiplier}×`
    if (modifier.kind === 'burn') return `灼伤物理伤害 ${modifier.multiplier}×`
    const screen = modifier.screen === 'reflect' ? '反射壁' : '光墙'
    return modifier.kind === 'screen' ? `${screen} ${modifier.multiplier}×` : `${screen}被要害绕过`
  }

  function terrainEffectLabel(effect: AppliedTerrainEffect): string {
    const terrainName = effect.terrain === 'electric' ? '电气场地' : effect.terrain === 'grassy' ? '青草场地' : effect.terrain === 'psychic' ? '精神场地' : '薄雾场地'
    return effect.kind === 'attacker-type-base-power'
      ? `${terrainName}：着地攻击方的${typeName(effect.typeId)}招式威力 1.3×`
      : `${terrainName}：着地防守方受到的龙属性招式威力 0.5×`
  }

  function damageOutcome(move: RuntimeMove | undefined, attackerForm: RuntimeForm | undefined, defenderForm: RuntimeForm | undefined, attackerStats: RuntimeStatBlock | null, defenderStats: RuntimeStatBlock | null, attackerAbility: RuntimeAbility | null, defenderAbility: RuntimeAbility | null, attackerItem: RuntimeItem | null, battleContext: BattleContext, attackerTerastallization: TerastallizationState, defenderTerastallization: TerastallizationState): MoveDamageResult | null {
    if (!move || !attackerForm || !defenderForm || !attackerStats || !defenderStats) return null
    return calculateMoveDamage({ level: attackerLevel, move, attackerStats, defenderStats, attackerTypeIds: attackerForm.types, defenderTypeIds: defenderForm.types, types: data.types, attackerAbility, defenderAbility, attackerItem, battleContext, attackerTerastallization, defenderTerastallization })
  }

  $: attackerSpecies = data.species.find(candidate => candidate.speciesId === attackerSpeciesId)
  $: defenderSpecies = data.species.find(candidate => candidate.speciesId === defenderSpeciesId)
  $: attackerForms = formsFor(attackerSpecies)
  $: defenderForms = formsFor(defenderSpecies)
  $: attackerForm = data.forms.find(candidate => candidate.formId === attackerFormId)
  $: defenderForm = data.forms.find(candidate => candidate.formId === defenderFormId)
  $: attackerAbilityOptions = abilitiesFor(attackerForm)
  $: defenderAbilityOptions = abilitiesFor(defenderForm)
  $: attackerAbility = attackerForm ? selectAbilityForForm(attackerForm, data.abilities, attackerAbilityId) : null
  $: defenderAbility = defenderForm ? selectAbilityForForm(defenderForm, data.abilities, defenderAbilityId) : null
  $: attackerItem = data.items.find(item => item.itemId === attackerItemId) ?? null
  $: attackerStatResult = sideStats(attackerSpecies, attackerForm, attackerLevel, attackerNatureId, attackerIvs, attackerEvs)
  $: defenderStatResult = sideStats(defenderSpecies, defenderForm, defenderLevel, defenderNatureId, defenderIvs, defenderEvs)
  $: knownMoveIds = attackerForm ? new Set(resolveEffectiveLearnsetMoveIds(data.learnsets, attackerForm.formId)) : new Set<string>()
  $: normalizedMoveQuery = moveQuery.trim().toLocaleLowerCase()
  $: filteredMoves = data.moves.filter(move => (!learnsetOnly || knownMoveIds.has(move.moveId))
    && (!normalizedMoveQuery || (move.zhName?.includes(moveQuery.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalizedMoveQuery)))
  $: selectedMove = data.moves.find(move => move.moveId === selectedMoveId)
  $: battleContext = { weather, terrain, attackerBurned, criticalHit, reflect, lightScreen, attackerStatStages: { atk: attackerAtkStage, spa: attackerSpaStage }, defenderStatStages: { def: defenderDefStage, spd: defenderSpdStage } } satisfies BattleContext
  $: attackerTerastallization = teraState(attackerTeraTypeId)
  $: defenderTerastallization = teraState(defenderTeraTypeId)
  $: damageResult = damageOutcome(selectedMove, attackerForm, defenderForm, attackerStatResult.stats, defenderStatResult.stats, attackerAbility, defenderAbility, attackerItem, battleContext, attackerTerastallization, defenderTerastallization)
</script>

<section class="damage-calculator">
  <h2>核心伤害计算器</h2>
  <p>第九世代普通单目标伤害范围，假设招式成功命中。支持普通 18 属性太晶化与已审查的战斗修正；不包含星晶、太晶生命周期或队伍级使用限制。</p>

  <div class="damage-sides">
    <section class="damage-side">
      <h3>攻击方</h3>
      <label>宝可梦
        <select bind:value={attackerSpeciesId} onchange={resetAttackerForm}>
          {#each data.species as species (species.speciesId)}
            <option value={species.speciesId}>#{species.nationalDexNumber.toString().padStart(4, '0')} {species.zhName}</option>
          {/each}
        </select>
      </label>
      <label>形态
        <select bind:value={attackerFormId} onchange={() => attackerAbilityId = null}>
          {#each attackerForms as form (form.formId)}<option value={form.formId}>{displayForm(form, attackerSpecies)}</option>{/each}
        </select>
      </label>
      <label>太晶状态<select aria-label="攻击方太晶状态" bind:value={attackerTeraTypeId}><option value="">未太晶化</option>{#each STANDARD_TERA_TYPE_IDS as typeId}<option value={typeId}>太晶 {typeName(typeId)}</option>{/each}</select></label>
      <label>特性效果<select aria-label="攻击方特性效果" bind:value={attackerAbilityId}><option value={null}>不启用</option>{#each attackerAbilityOptions as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>
      <label>持有物效果<select aria-label="攻击方持有物效果" bind:value={attackerItemId}><option value={null}>无持有物</option>{#each data.items as item (item.itemId)}<option value={item.itemId}>{item.canonicalName}（{item.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>
      <div class="damage-basic-inputs">
        <label>等级 <input aria-label="攻击方等级" type="number" min="1" max="100" step="1" bind:value={attackerLevel} /></label>
        <label>性格
          <select aria-label="攻击方性格" bind:value={attackerNatureId}>{#each data.natures as nature (nature.natureId)}<option value={nature.natureId}>{nature.canonicalName}</option>{/each}</select>
        </label>
      </div>
      <table><thead><tr><th>能力</th><th>IV</th><th>EV</th><th>结果</th></tr></thead><tbody>
        {#each statIds as stat}<tr><th scope="row">{statLabels[stat]}</th><td><input aria-label={`攻击方 ${stat} IV`} type="number" min="0" max="31" bind:value={attackerIvs[stat]} /></td><td><input aria-label={`攻击方 ${stat} EV`} type="number" min="0" max="252" bind:value={attackerEvs[stat]} /></td><td>{attackerStatResult.stats?.[stat] ?? '—'}</td></tr>{/each}
      </tbody></table>
      <p class:ev-over={totalEvs(attackerEvs) > 510}>EV：{totalEvs(attackerEvs)} / 510</p>
      {#if attackerStatResult.error}<p class="status error">{attackerStatResult.error}</p>{/if}
    </section>

    <section class="damage-side">
      <h3>防守方</h3>
      <label>宝可梦
        <select bind:value={defenderSpeciesId} onchange={resetDefenderForm}>
          {#each data.species as species (species.speciesId)}
            <option value={species.speciesId}>#{species.nationalDexNumber.toString().padStart(4, '0')} {species.zhName}</option>
          {/each}
        </select>
      </label>
      <label>形态
        <select bind:value={defenderFormId} onchange={() => defenderAbilityId = null}>
          {#each defenderForms as form (form.formId)}<option value={form.formId}>{displayForm(form, defenderSpecies)}</option>{/each}
        </select>
      </label>
      <label>太晶状态<select aria-label="防守方太晶状态" bind:value={defenderTeraTypeId}><option value="">未太晶化</option>{#each STANDARD_TERA_TYPE_IDS as typeId}<option value={typeId}>太晶 {typeName(typeId)}</option>{/each}</select></label>
      <label>特性效果<select aria-label="防守方特性效果" bind:value={defenderAbilityId}><option value={null}>不启用</option>{#each defenderAbilityOptions as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>
      <div class="damage-basic-inputs">
        <label>等级 <input aria-label="防守方等级" type="number" min="1" max="100" step="1" bind:value={defenderLevel} /></label>
        <label>性格
          <select aria-label="防守方性格" bind:value={defenderNatureId}>{#each data.natures as nature (nature.natureId)}<option value={nature.natureId}>{nature.canonicalName}</option>{/each}</select>
        </label>
      </div>
      <table><thead><tr><th>能力</th><th>IV</th><th>EV</th><th>结果</th></tr></thead><tbody>
        {#each statIds as stat}<tr><th scope="row">{statLabels[stat]}</th><td><input aria-label={`防守方 ${stat} IV`} type="number" min="0" max="31" bind:value={defenderIvs[stat]} /></td><td><input aria-label={`防守方 ${stat} EV`} type="number" min="0" max="252" bind:value={defenderEvs[stat]} /></td><td>{defenderStatResult.stats?.[stat] ?? '—'}</td></tr>{/each}
      </tbody></table>
      <p class:ev-over={totalEvs(defenderEvs) > 510}>EV：{totalEvs(defenderEvs)} / 510</p>
      {#if defenderStatResult.error}<p class="status error">{defenderStatResult.error}</p>{/if}
    </section>
  </div>

  <section class="battle-context-controls">
    <h3>战斗状态</h3>
    <div class="battle-context-grid">
      <label>攻击阶级<select aria-label="攻击阶级" bind:value={attackerAtkStage}>{#each stageOptions as stage}<option value={stage}>{stageLabel(stage)}</option>{/each}</select></label>
      <label>特攻阶级<select aria-label="特攻阶级" bind:value={attackerSpaStage}>{#each stageOptions as stage}<option value={stage}>{stageLabel(stage)}</option>{/each}</select></label>
      <label>防御阶级<select aria-label="防御阶级" bind:value={defenderDefStage}>{#each stageOptions as stage}<option value={stage}>{stageLabel(stage)}</option>{/each}</select></label>
      <label>特防阶级<select aria-label="特防阶级" bind:value={defenderSpdStage}>{#each stageOptions as stage}<option value={stage}>{stageLabel(stage)}</option>{/each}</select></label>
      <label>天气<select aria-label="天气" bind:value={weather}><option value="none">无</option><option value="sun">日照</option><option value="rain">下雨</option><option value="sandstorm">沙暴</option><option value="snow">雪天</option></select></label>
      <label>场地<select aria-label="场地" bind:value={terrain}><option value="none">无</option><option value="electric">电气场地</option><option value="grassy">青草场地</option><option value="psychic">精神场地</option><option value="misty">薄雾场地</option></select></label>
      <label class="burn-toggle"><input type="checkbox" bind:checked={attackerBurned} /> 攻击方灼伤</label>
      <label class="burn-toggle"><input aria-label="普通要害攻击" type="checkbox" bind:checked={criticalHit} /> 按普通要害计算</label>
      <label class="burn-toggle"><input aria-label="反射壁" type="checkbox" bind:checked={reflect} /> 防守方反射壁</label>
      <label class="burn-toggle"><input aria-label="光墙" type="checkbox" bind:checked={lightScreen} /> 防守方光墙</label>
    </div>
    <p>天气和场地可以同时存在。场地只实现直接伤害效果；着地仅按当前形态的飞行属性与明确启用的飘浮判断，不计算持续时间、回复、状态防护或优先度变化，地震／重踏／震级等招式特殊交互保持不支持。</p>
  </section>

  <section class="damage-move-picker">
    <h3>招式</h3>
    <label class="search"><span>按中文名或英文名筛选</span><input bind:value={moveQuery} placeholder="例如：喷射火焰、Flamethrower、Body Press" /></label>
    <label class="learnset-toggle"><input type="checkbox" bind:checked={learnsetOnly} /> 只显示固定来源中与攻击方形态关联的招式（跨世代，不代表当前合法）</label>
    <p>匹配 {filteredMoves.length} 个；列表最多显示前 60 个，请继续输入名称缩小范围。</p>
    <div class="damage-move-results">
      {#each filteredMoves.slice(0, 60) as move (move.moveId)}
        <button class:active={selectedMoveId === move.moveId} type="button" onclick={() => selectedMoveId = move.moveId}>
          <strong>{move.zhName ?? '未本地化'}</strong> <small>{move.canonicalName}</small><span>{supportLabel(move)}</span>
        </button>
      {/each}
    </div>
  </section>

  {#if selectedMove}
    <section class="damage-result" aria-live="polite">
      <h3>{selectedMove.zhName ?? '未本地化'} <small>{selectedMove.canonicalName}</small></h3>
      <p>{typeName(selectedMove.typeId)} · {categoryName(selectedMove)} · 威力 {selectedMove.power.kind === 'numeric' ? selectedMove.power.value : '—'}</p>
      {#if damageResult?.status === 'supported' && defenderStatResult.stats}
        <div class="damage-summary">
          <p><strong>{damageResult.minDamage}–{damageResult.maxDamage} 伤害</strong></p>
          <p><strong>{((damageResult.minDamage / defenderStatResult.stats.hp) * 100).toFixed(1)}%–{((damageResult.maxDamage / defenderStatResult.stats.hp) * 100).toFixed(1)}%</strong>（防守方 HP {defenderStatResult.stats.hp}）</p>
        </div>
        <div class="damage-modifiers">
          <span>攻击方原始属性 {attackerForm ? attackerForm.types.map(typeName).join('/') : '—'}</span>
          <span>防守方原始属性 {defenderForm ? defenderForm.types.map(typeName).join('/') : '—'}</span>
          {#if attackerTerastallization.active}<span>攻击方当前属性 太晶 {typeName(attackerTerastallization.teraType)}</span>{/if}
          {#if defenderTerastallization.active}<span>防守方当前属性 太晶 {typeName(defenderTerastallization.teraType)}</span>{/if}
          <span>{damageResult.attackingStat.toUpperCase()} {damageResult.attack}{damageResult.effectiveAttack !== damageResult.attack ? ` → ${damageResult.effectiveAttack}` : ''}</span>
          <span>{damageResult.defendingStat.toUpperCase()} {damageResult.defense}{damageResult.effectiveDefense !== damageResult.defense ? ` → ${damageResult.effectiveDefense}` : ''}</span>
          {#if selectedMove.power.kind === 'numeric' && damageResult.effectiveBasePower !== selectedMove.power.value}<span>威力 {selectedMove.power.value} → {damageResult.effectiveBasePower}</span>{/if}
          <span>STAB {damageResult.stabMultiplier}×（{stabBasisLabel(damageResult.stabResolution.basis)}）</span>
          <span>防守属性相性 {damageResult.typeMultiplier}×</span>
          {#if damageResult.abilityAdjustedTypeMultiplier !== damageResult.typeMultiplier}<span>特性后 {damageResult.abilityAdjustedTypeMultiplier}×</span>{/if}
        </div>
        {#if damageResult.teraBasePowerFloorApplied}<p class="status">太晶效果：匹配太晶属性的固定低威力招式提升至威力 60。</p>{/if}
        {#if damageResult.appliedBattleContextModifiers.length}<p class="status">战斗状态：{damageResult.appliedBattleContextModifiers.map(battleContextModifierLabel).join('、')}</p>{/if}
        {#if terrain !== 'none'}<p class="status">场地着地状态：攻击方{damageResult.attackerGrounded ? '着地' : '未着地'}；防守方{damageResult.defenderGrounded ? '着地' : '未着地'}。</p>{/if}
        {#if damageResult.appliedTerrainEffects.length}<p class="status">场地效果：{damageResult.appliedTerrainEffects.map(terrainEffectLabel).join('、')}</p>{/if}
        {#if damageResult.appliedAbilityEffects.length}<p class="status">已应用：{damageResult.appliedAbilityEffects.map(item => `${data.abilities.find(ability => ability.abilityId === item.abilityId)?.zhName ?? item.abilityId}（${item.effect.kind === 'stab-multiplier' ? `STAB ${damageResult.stabMultiplier}×` : abilityEffectLabel(item.effect)}）`).join('、')}</p>{/if}
        {#if damageResult.appliedItemEffects.length}<p class="status">持有物：{damageResult.appliedItemEffects.map(item => `${data.items.find(candidate => candidate.itemId === item.itemId)?.canonicalName ?? item.itemId}（${itemEffectLabel(item.effect)}）`).join('、')}</p>{/if}
        {#if damageResult.unmodeledAbilityIds.length}<p class="status">已选择但未建模：{damageResult.unmodeledAbilityIds.map(id => data.abilities.find(ability => ability.abilityId === id)?.zhName ?? id).join('、')}；结果仅使用核心伤害机制。</p>{/if}
        {#if damageResult.unmodeledItemIds.length}<p class="status">已选择但未建模的持有物：{damageResult.unmodeledItemIds.map(id => data.items.find(item => item.itemId === id)?.canonicalName ?? id).join('、')}；该物品不会改变结果。</p>{/if}
      {:else if damageResult?.status === 'non-damaging'}
        <p class="status">这是变化招式，不使用普通伤害公式。</p>
      {:else if damageResult?.status === 'unsupported'}
        <p class="status">暂不支持：{unsupportedLabels[damageResult.reason]}</p>
      {:else if damageResult?.status === 'incomplete'}
        <p class="status">招式资料不足，无法可靠计算。</p>
      {:else if damageResult?.status === 'unsupported-context'}
        <p class="status">当前组合暂不计算：{damageResult.reason === 'burn-with-guts' ? '灼伤与“毅力”的能力修正及灼伤豁免尚未建模。' : '“水蒸气”在日照下具有特殊增伤规则，不能套用普通水属性减伤。'}</p>
      {:else}
        <p class="status">请先修正双方配置。</p>
      {/if}
    </section>
  {/if}
</section>
