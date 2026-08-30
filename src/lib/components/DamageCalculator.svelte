<script lang="ts">
  import { calculateMoveDamage, type AppliedBattleContextModifier, type AppliedTerrainEffect, type MoveDamageResult } from '../runtime-data/damage-calculator'
  import type { BattleContext, BattleStatStage, BattleTerrain, BattleWeather } from '../runtime-data/battle-context'
  import { resolveEffectiveLearnsetMoveIds } from '../runtime-data/learnsets'
  import { totalEvs } from '../runtime-data/stat-calculator'
  import { resolveAttackerItem, resolveCombatantConfiguration, validateDamageCalculatorContext, type CombatantConfiguration, type ResolvedCombatantConfiguration } from '../runtime-data/damage-calculator-state'
  import { INACTIVE_TERASTALLIZATION, STANDARD_TERA_TYPE_IDS, type ResolvedStab, type StellarBoostUsageState, type TeraSelection, type TerastallizationState } from '../runtime-data/terastallization'
  import type { LearnsetRuntimeData, PokemonRuntimeData, RuntimeAbility, RuntimeAbilityMechanicsEffect, RuntimeForm, RuntimeItem, RuntimeItemMechanicsEffect, RuntimeMove, RuntimeMoveDamageUnsupportedReason, RuntimeSpecies, RuntimeStatBlock } from '../runtime-data/types'
  import ModifierTrace from './ModifierTrace.svelte'
  import SearchableSelect from './SearchableSelect.svelte'
  import { natureLabel, statLabel, typeLabel } from '../presentation/labels'
  import { editableInteger, normalizeEditableInteger } from '../presentation/editable-number'

  export let data: PokemonRuntimeData
  export let learnsets: LearnsetRuntimeData | null = null
  export let learnsetsLoading = false
  export let learnsetsError = ''
  export let onRequestLearnsets: () => void = () => {}

  const statIds = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
  const statLabels: Record<(typeof statIds)[number], string> = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' }
  const all31 = (): RuntimeStatBlock => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 })
  const all0 = (): RuntimeStatBlock => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })
  const stageOptions: BattleStatStage[] = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
  const supportedItemNames: Record<string, string> = {
    'item:0220': '讲究头带',
    'item:0243': '神秘水滴',
    'item:0249': '木炭',
    'item:0268': '达人带',
    'item:0270': '生命宝珠',
    'item:0297': '讲究眼镜',
  }

  let attackerSpeciesId = 'species:0006'
  let attackerFormId = 'form:0006:base'
  let attackerLevel = 50
  let attackerNatureId = 'nature:hardy'
  let attackerAbilityId: string | null = null
  let attackerItemId: string | null = null
  let attackerTeraTypeId: TeraSelection = ''
  let stellarBoostUsage: StellarBoostUsageState = 'unknown'
  let attackerIvs = all31()
  let attackerEvs = all0()
  let attackerEvDrafts: Record<keyof RuntimeStatBlock, string> = { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' }
  let defenderSpeciesId = 'species:0035'
  let defenderFormId = 'form:0035:base'
  let defenderLevel = 50
  let defenderNatureId = 'nature:hardy'
  let defenderAbilityId: string | null = null
  let defenderTeraTypeId: TeraSelection = ''
  let defenderIvs = all31()
  let defenderEvs = all0()
  let defenderEvDrafts: Record<keyof RuntimeStatBlock, string> = { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' }
  let moveQuery = ''
  let learnsetOnly = false
  let selectedMoveId = 'move:0053'
  function toggleLearnsetOnly(event: Event): void {
    learnsetOnly = (event.currentTarget as HTMLInputElement).checked
    if (learnsetOnly && !learnsets) onRequestLearnsets()
  }
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
    if (attackerTeraTypeId === 'stellar') stellarBoostUsage = 'unknown'
  }

  function resetDefenderForm(): void {
    const species = data.species.find(candidate => candidate.speciesId === defenderSpeciesId)
    defenderFormId = species?.defaultFormId ?? ''
    defenderAbilityId = null
  }

  function selectAttackerSpecies(value: string): void { attackerSpeciesId = value; resetAttackerForm() }
  function selectDefenderSpecies(value: string): void { defenderSpeciesId = value; resetDefenderForm() }
  function setAttackerTera(value: string): void { attackerTeraTypeId = value as TeraSelection; stellarBoostUsage = 'unknown' }
  function setDefenderTera(value: string): void { defenderTeraTypeId = value as TeraSelection }
  function maximumEvFor(evs: RuntimeStatBlock, stat: keyof RuntimeStatBlock): number { return Math.min(252, 510 - statIds.filter(id => id !== stat).reduce((total, id) => total + evs[id], 0)) }
  function editAttackerEv(stat: keyof RuntimeStatBlock, raw: string): void { attackerEvDrafts = { ...attackerEvDrafts, [stat]: raw }; const value = editableInteger(raw, 0, maximumEvFor(attackerEvs, stat)); if (value !== null) attackerEvs = { ...attackerEvs, [stat]: value } }
  function editDefenderEv(stat: keyof RuntimeStatBlock, raw: string): void { defenderEvDrafts = { ...defenderEvDrafts, [stat]: raw }; const value = editableInteger(raw, 0, maximumEvFor(defenderEvs, stat)); if (value !== null) defenderEvs = { ...defenderEvs, [stat]: value } }
  function commitAttackerEv(stat: keyof RuntimeStatBlock): void { const value = normalizeEditableInteger(attackerEvDrafts[stat], 0, maximumEvFor(attackerEvs, stat), attackerEvs[stat]); attackerEvs = { ...attackerEvs, [stat]: value }; attackerEvDrafts = { ...attackerEvDrafts, [stat]: String(value) } }
  function commitDefenderEv(stat: keyof RuntimeStatBlock): void { const value = normalizeEditableInteger(defenderEvDrafts[stat], 0, maximumEvFor(defenderEvs, stat), defenderEvs[stat]); defenderEvs = { ...defenderEvs, [stat]: value }; defenderEvDrafts = { ...defenderEvDrafts, [stat]: String(value) } }
  function commitOnEnter(event: KeyboardEvent, commit: () => void): void { if (event.key === 'Enter') { event.preventDefault(); commit() } }

  function selectMove(moveId: string): void {
    selectedMoveId = moveId
    if (attackerTeraTypeId === 'stellar') stellarBoostUsage = 'unknown'
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

  function resolveCombatant(configuration: CombatantConfiguration): { value: ResolvedCombatantConfiguration | null; error: string | null } {
    try { return { value: resolveCombatantConfiguration(data, configuration), error: null } }
    catch (cause) { return { value: null, error: cause instanceof Error && cause.message === 'STAT_CALCULATOR_EV_TOTAL_EXCEEDED' ? '努力值总和不能超过 510。' : '等级、IV、EV、形态、特性或太晶属性配置无效。' } }
  }

  function resolveItem(itemId: string | null): { value: RuntimeItem | null; error: string | null } {
    try { return { value: resolveAttackerItem(data, itemId), error: null } }
    catch { return { value: null, error: '持有物配置无效。' } }
  }

  function contextError(context: BattleContext): string | null {
    try { validateDamageCalculatorContext(context); return null } catch { return '战斗状态配置无效。' }
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
    const type = data.types.find(candidate => candidate.typeId === typeId)
    return typeLabel(typeId, type?.canonicalName ?? typeId).zh
  }

  function natureEffect(nature: PokemonRuntimeData['natures'][number]): string { return nature.neutral ? '无能力修正' : `${statLabel(nature.plusStat!).zh}+ · ${statLabel(nature.minusStat!).zh}-` }
  function natureOption(nature: PokemonRuntimeData['natures'][number]): string { return `${natureLabel(nature.natureId, nature.canonicalName).zh}（${natureEffect(nature)}）` }

  function categoryName(move: RuntimeMove): string {
    return move.category === 'physical' ? '物理' : move.category === 'special' ? '特殊' : '变化'
  }

  function stageLabel(stage: BattleStatStage): string {
    return stage > 0 ? `+${stage}` : String(stage)
  }

  function stabBasisLabel(basis: ResolvedStab['basis']): string {
    if (basis === 'original-type') return '原始属性'
    if (basis === 'tera-type') return '太晶属性'
    if (basis === 'same-type-tera') return '同属性太晶'
    if (basis === 'stellar-original-available') return '星晶原属性增伤可用'
    if (basis === 'stellar-original-consumed') return '星晶原属性增伤已消耗'
    if (basis === 'stellar-non-original-available') return '星晶非原属性增伤可用'
    if (basis === 'stellar-non-original-consumed') return '星晶非原属性增伤已消耗'
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

  function damageOutcome(move: RuntimeMove | undefined, attackerForm: RuntimeForm | undefined, defenderForm: RuntimeForm | undefined, attackerStats: RuntimeStatBlock | null, defenderStats: RuntimeStatBlock | null, attackerAbility: RuntimeAbility | null, defenderAbility: RuntimeAbility | null, attackerItem: RuntimeItem | null, battleContext: BattleContext, attackerTerastallization: TerastallizationState, defenderTerastallization: TerastallizationState, stellarBoostUsage: StellarBoostUsageState): MoveDamageResult | null {
    if (!move || !attackerForm || !defenderForm || !attackerStats || !defenderStats) return null
    return calculateMoveDamage({ level: attackerLevel, move, attackerStats, defenderStats, attackerTypeIds: attackerForm.types, defenderTypeIds: defenderForm.types, types: data.types, attackerAbility, defenderAbility, attackerItem, battleContext, attackerTerastallization, defenderTerastallization, stellarBoostUsage })
  }

  $: attackerSpecies = data.species.find(candidate => candidate.speciesId === attackerSpeciesId)
  $: defenderSpecies = data.species.find(candidate => candidate.speciesId === defenderSpeciesId)
  $: attackerForms = formsFor(attackerSpecies)
  $: defenderForms = formsFor(defenderSpecies)
  $: attackerForm = data.forms.find(candidate => candidate.formId === attackerFormId)
  $: defenderForm = data.forms.find(candidate => candidate.formId === defenderFormId)
  $: attackerAbilityOptions = abilitiesFor(attackerForm)
  $: defenderAbilityOptions = abilitiesFor(defenderForm)
  $: speciesOptions = data.species.map(species => ({ value: species.speciesId, label: `#${species.nationalDexNumber.toString().padStart(4, '0')} ${species.zhName}` }))
  $: teraOptions = [{ value: '', label: '未太晶化' }, ...STANDARD_TERA_TYPE_IDS.map(typeId => ({ value: typeId, label: `太晶 ${typeName(typeId)}` })), { value: 'stellar', label: '星晶（保留原防守属性）' }]
  $: natureOptions = data.natures.map(nature => ({ value: nature.natureId, label: natureOption(nature), keywords: nature.canonicalName }))
  $: itemOptions = [{ value: '', label: '无持有物' }, ...data.items.filter(item => supportedItemNames[item.itemId]).map(item => ({ value: item.itemId, label: `${supportedItemNames[item.itemId]}（${item.mechanics.status === 'supported' ? '已支持' : '未建模'}）`, keywords: item.canonicalName }))]
  $: attackerConfiguration = resolveCombatant({ speciesId: attackerSpeciesId, formId: attackerFormId, level: attackerLevel, natureId: attackerNatureId, ivs: attackerIvs, evs: attackerEvs, abilityId: attackerAbilityId, teraTypeId: attackerTeraTypeId })
  $: defenderConfiguration = resolveCombatant({ speciesId: defenderSpeciesId, formId: defenderFormId, level: defenderLevel, natureId: defenderNatureId, ivs: defenderIvs, evs: defenderEvs, abilityId: defenderAbilityId, teraTypeId: defenderTeraTypeId })
  $: attackerAbility = attackerConfiguration.value?.ability ?? null
  $: defenderAbility = defenderConfiguration.value?.ability ?? null
  $: attackerItemConfiguration = resolveItem(attackerItemId)
  $: attackerItem = attackerItemConfiguration.value
  $: attackerStatResult = { stats: attackerConfiguration.value?.stats ?? null, error: attackerConfiguration.error }
  $: defenderStatResult = { stats: defenderConfiguration.value?.stats ?? null, error: defenderConfiguration.error }
  $: knownMoveIds = attackerForm && learnsets ? new Set(resolveEffectiveLearnsetMoveIds(learnsets, attackerForm.formId)) : new Set<string>()
  $: normalizedMoveQuery = moveQuery.trim().toLocaleLowerCase()
  $: filteredMoves = data.moves.filter(move => (!learnsetOnly || knownMoveIds.has(move.moveId))
    && (!normalizedMoveQuery || (move.zhName?.includes(moveQuery.trim()) ?? false) || move.canonicalName.toLocaleLowerCase().includes(normalizedMoveQuery)))
  $: selectedMove = data.moves.find(move => move.moveId === selectedMoveId)
  $: battleContext = { weather, terrain, attackerBurned, criticalHit, reflect, lightScreen, attackerStatStages: { atk: attackerAtkStage, spa: attackerSpaStage }, defenderStatStages: { def: defenderDefStage, spd: defenderSpdStage } } satisfies BattleContext
  $: attackerTerastallization = attackerConfiguration.value?.terastallization ?? INACTIVE_TERASTALLIZATION
  $: defenderTerastallization = defenderConfiguration.value?.terastallization ?? INACTIVE_TERASTALLIZATION
  $: battleContextValidationError = contextError(battleContext)
  $: damageResult = battleContextValidationError || attackerItemConfiguration.error ? null : damageOutcome(selectedMove, attackerForm, defenderForm, attackerStatResult.stats, defenderStatResult.stats, attackerAbility, defenderAbility, attackerItem, battleContext, attackerTerastallization, defenderTerastallization, stellarBoostUsage)
</script>

<section class="damage-calculator">
  <h2>核心伤害计算器</h2>
  <p>第九世代普通单目标伤害范围，假设招式成功命中。支持普通 18 属性太晶与星晶的可确定直接伤害；星晶每属性增伤是否已使用必须由用户明确提供。</p>

  <div class="damage-sides">
    <section class="damage-side">
      <h3>攻击方</h3>
      <label>宝可梦
        <SearchableSelect ariaLabel="攻击方宝可梦" listId="damage-attacker-species" options={speciesOptions} value={attackerSpeciesId} onSelect={selectAttackerSpecies} placeholder="输入名称或图鉴编号" />
      </label>
      <label>形态
        <select bind:value={attackerFormId} onchange={() => { attackerAbilityId = null; if (attackerTeraTypeId === 'stellar') stellarBoostUsage = 'unknown' }}>
          {#each attackerForms as form (form.formId)}<option value={form.formId}>{displayForm(form, attackerSpecies)}</option>{/each}
        </select>
      </label>
      <label>太晶状态<SearchableSelect ariaLabel="攻击方太晶状态" listId="damage-attacker-tera" options={teraOptions} value={attackerTeraTypeId} onSelect={setAttackerTera} placeholder="输入或选择太晶状态" /></label>
      {#if attackerTeraTypeId === 'stellar'}
        <label>本招式属性的星晶增伤<select aria-label="星晶增伤使用状态" bind:value={stellarBoostUsage}><option value="unknown">请选择，不能推测</option><option value="available">尚未使用（本次可用）</option><option value="consumed">已经使用</option></select></label>
        <p class="status">普通宝可梦每个招式属性仅有一次星晶增伤；太乐巴戈斯星晶形态不会消耗该增伤，但本阶段不自动模拟其形态转换。</p>
      {/if}
      <label>特性效果<select aria-label="攻击方特性效果" bind:value={attackerAbilityId}><option value={null}>不启用</option>{#each attackerAbilityOptions as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>
      <label>持有物效果<SearchableSelect ariaLabel="攻击方持有物效果" listId="damage-attacker-item" options={itemOptions} value={attackerItemId ?? ''} onSelect={(value) => attackerItemId = value || null} placeholder="输入或选择持有物" /></label>
      <div class="damage-basic-inputs">
        <label>等级 <input aria-label="攻击方等级" type="number" min="1" max="100" step="1" bind:value={attackerLevel} /></label>
        <label>性格
          <SearchableSelect ariaLabel="攻击方性格" listId="damage-attacker-nature" options={natureOptions} value={attackerNatureId} onSelect={(value) => attackerNatureId = value} placeholder="输入或选择性格" />
        </label>
      </div>
      <table><thead><tr><th>能力</th><th>IV</th><th>EV</th><th>结果</th></tr></thead><tbody>
        {#each statIds as stat}<tr><th scope="row">{statLabels[stat]}</th><td><input aria-label={`攻击方 ${stat} IV`} type="number" min="0" max="31" bind:value={attackerIvs[stat]} /></td><td><input aria-label={`攻击方 ${stat} EV`} type="number" min="0" max={maximumEvFor(attackerEvs, stat)} value={attackerEvDrafts[stat]} oninput={(event) => editAttackerEv(stat, (event.currentTarget as HTMLInputElement).value)} onblur={() => commitAttackerEv(stat)} onkeydown={(event) => commitOnEnter(event, () => commitAttackerEv(stat))} /></td><td>{attackerStatResult.stats?.[stat] ?? '—'}</td></tr>{/each}
      </tbody></table>
      <p class:ev-over={totalEvs(attackerEvs) > 510}>EV：{totalEvs(attackerEvs)} / 510</p>
      {#if attackerStatResult.error}<p class="status error">{attackerStatResult.error}</p>{/if}
      {#if attackerItemConfiguration.error}<p class="status error">{attackerItemConfiguration.error}</p>{/if}
    </section>

    <section class="damage-side">
      <h3>防守方</h3>
      <label>宝可梦
        <SearchableSelect ariaLabel="防守方宝可梦" listId="damage-defender-species" options={speciesOptions} value={defenderSpeciesId} onSelect={selectDefenderSpecies} placeholder="输入名称或图鉴编号" />
      </label>
      <label>形态
        <select bind:value={defenderFormId} onchange={() => defenderAbilityId = null}>
          {#each defenderForms as form (form.formId)}<option value={form.formId}>{displayForm(form, defenderSpecies)}</option>{/each}
        </select>
      </label>
      <label>太晶状态<SearchableSelect ariaLabel="防守方太晶状态" listId="damage-defender-tera" options={teraOptions} value={defenderTeraTypeId} onSelect={setDefenderTera} placeholder="输入或选择太晶状态" /></label>
      <label>特性效果<select aria-label="防守方特性效果" bind:value={defenderAbilityId}><option value={null}>不启用</option>{#each defenderAbilityOptions as { slot, ability } (ability.abilityId)}<option value={ability.abilityId}>{slot} · {ability.zhName ?? ability.canonicalName}（{ability.mechanics.status === 'supported' ? '支持' : '未建模'}）</option>{/each}</select></label>
      <div class="damage-basic-inputs">
        <label>等级 <input aria-label="防守方等级" type="number" min="1" max="100" step="1" bind:value={defenderLevel} /></label>
        <label>性格
          <SearchableSelect ariaLabel="防守方性格" listId="damage-defender-nature" options={natureOptions} value={defenderNatureId} onSelect={(value) => defenderNatureId = value} placeholder="输入或选择性格" />
        </label>
      </div>
      <table><thead><tr><th>能力</th><th>IV</th><th>EV</th><th>结果</th></tr></thead><tbody>
        {#each statIds as stat}<tr><th scope="row">{statLabels[stat]}</th><td><input aria-label={`防守方 ${stat} IV`} type="number" min="0" max="31" bind:value={defenderIvs[stat]} /></td><td><input aria-label={`防守方 ${stat} EV`} type="number" min="0" max={maximumEvFor(defenderEvs, stat)} value={defenderEvDrafts[stat]} oninput={(event) => editDefenderEv(stat, (event.currentTarget as HTMLInputElement).value)} onblur={() => commitDefenderEv(stat)} onkeydown={(event) => commitOnEnter(event, () => commitDefenderEv(stat))} /></td><td>{defenderStatResult.stats?.[stat] ?? '—'}</td></tr>{/each}
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
    {#if battleContextValidationError}<p class="status error">{battleContextValidationError}</p>{/if}
  </section>

  <section class="damage-move-picker">
    <h3>招式</h3>
    <label class="search"><span>按中文名或英文名筛选</span><input bind:value={moveQuery} placeholder="例如：喷射火焰、Flamethrower、Body Press" /></label>
    <label class="learnset-toggle"><input type="checkbox" checked={learnsetOnly} onchange={toggleLearnsetOnly} /> 只显示固定来源中与攻击方形态关联的招式（跨世代，不代表当前合法）</label>
    {#if learnsetOnly && learnsetsLoading}<p class="status" role="status"><strong>正在加载可学招式</strong> <small>Loading Learnsets</small></p>{:else if learnsetOnly && learnsetsError}<div class="status error" role="alert"><strong>可学招式加载失败</strong> <small>Failed to Load Learnsets</small><p>伤害计算器的其他功能不受影响；关闭此筛选可继续浏览全部招式。</p><button type="button" onclick={onRequestLearnsets}>重试 <small>Retry</small></button></div>{/if}
    <p>匹配 {filteredMoves.length} 个；列表最多显示前 60 个，请继续输入名称缩小范围。</p>
    <div class="damage-move-results">
      {#each filteredMoves.slice(0, 60) as move (move.moveId)}
        <button class:active={selectedMoveId === move.moveId} type="button" onclick={() => selectMove(move.moveId)}>
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
          {#if attackerTerastallization.kind === 'ordinary'}<span>攻击方当前属性 太晶 {typeName(attackerTerastallization.typeId)}</span>{:else if attackerTerastallization.kind === 'stellar'}<span>攻击方星晶；有效防守属性 {damageResult.effectiveAttackerTypeIds.map(typeName).join('/')}</span>{/if}
          {#if defenderTerastallization.kind === 'ordinary'}<span>防守方当前属性 太晶 {typeName(defenderTerastallization.typeId)}</span>{:else if defenderTerastallization.kind === 'stellar'}<span>防守方星晶；有效防守属性 {damageResult.effectiveDefenderTypeIds.map(typeName).join('/')}</span>{/if}
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
        {#if damageResult.appliedItemEffects.length}<p class="status">持有物：{damageResult.appliedItemEffects.map(item => `${supportedItemNames[item.itemId] ?? '未知道具'}（${itemEffectLabel(item.effect)}）`).join('、')}</p>{/if}
        {#if damageResult.unmodeledAbilityIds.length}<p class="status">已选择但未建模：{damageResult.unmodeledAbilityIds.map(id => data.abilities.find(ability => ability.abilityId === id)?.zhName ?? id).join('、')}；结果仅使用核心伤害机制。</p>{/if}
        {#if damageResult.unmodeledItemIds.length}<p class="status">已选择但未建模的持有物：{damageResult.unmodeledItemIds.map(id => supportedItemNames[id] ?? '未知道具').join('、')}；该物品不会改变结果。</p>{/if}
        <ModifierTrace trace={damageResult.modifierTrace} />
      {:else if damageResult?.status === 'non-damaging'}
        <p class="status">这是变化招式，不使用普通伤害公式。</p>
      {:else if damageResult?.status === 'unsupported'}
        <p class="status">暂不支持：{unsupportedLabels[damageResult.reason]}</p>
      {:else if damageResult?.status === 'incomplete'}
        <p class="status">招式资料不足，无法可靠计算。</p>
      {:else if damageResult?.status === 'unresolved-context'}
        <p class="status">需要明确状态：请选择该招式属性的星晶增伤是“尚未使用”还是“已经使用”；计算器不会默认推测。</p>
      {:else if damageResult?.status === 'unsupported-context'}
        <p class="status">当前组合暂不计算：{damageResult.reason === 'burn-with-guts' ? '灼伤与“毅力”的能力修正及灼伤豁免尚未建模。' : damageResult.reason === 'sun-with-hydro-steam' ? '“水蒸气”在日照下具有特殊增伤规则，不能套用普通水属性减伤。' : damageResult.reason === 'stellar-tera-blast' ? '星晶太晶爆发会变为星晶属性、威力 100、按攻击与特攻选择分类，并在命中后降低攻击与特攻；本阶段保持显式不支持。' : damageResult.reason === 'stellar-tera-starstorm' ? '晶光星群依赖太乐巴戈斯星晶形态、动态属性/分类和范围目标，本阶段不引入专属形态战斗引擎。' : '觉醒之舞会按使用者当前属性动态改变招式属性，星晶状态下不能使用静态招式属性计算。'}</p>
      {:else}
        <p class="status">请先修正双方配置。</p>
      {/if}
    </section>
  {/if}
</section>
