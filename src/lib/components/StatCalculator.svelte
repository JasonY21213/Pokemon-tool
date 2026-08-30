<script lang="ts">
  import { calculateStats, totalEvs } from '../runtime-data/stat-calculator'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeSpecies, RuntimeStatBlock } from '../runtime-data/types'
  import { editableInteger, normalizeEditableInteger } from '../presentation/editable-number'
  import { formatLabel, natureLabel, statLabel } from '../presentation/labels'

  export let data: PokemonRuntimeData
  export let selectedSpecies: RuntimeSpecies | null
  export let selectedForm: RuntimeForm | null

  let level = 50
  let natureId = 'nature:hardy'
  let natureQuery: string | null = null
  let ivs: RuntimeStatBlock = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  let evs: RuntimeStatBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  let ivDrafts: Record<keyof RuntimeStatBlock, string> = { hp: '31', atk: '31', def: '31', spa: '31', spd: '31', spe: '31' }
  let evDrafts: Record<keyof RuntimeStatBlock, string> = { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' }
  const labels: Record<keyof RuntimeStatBlock, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Special Attack', spd: 'Special Defense', spe: 'Speed' }
  const ids = Object.keys(labels) as Array<keyof RuntimeStatBlock>

  function calculate(
    species: RuntimeSpecies | null,
    form: RuntimeForm | null,
    nature: PokemonRuntimeData['natures'][number] | null,
    currentLevel: number,
    currentIvs: RuntimeStatBlock,
    currentEvs: RuntimeStatBlock,
  ): { stats: RuntimeStatBlock | null; error: string | null } {
    if (!species || !form || !nature) return { stats: null, error: null }
    try { return { stats: calculateStats({ speciesId: species.speciesId, baseStats: form.baseStats, level: currentLevel, ivs: currentIvs, evs: currentEvs, nature }), error: null } }
    catch (cause) { return { stats: null, error: cause instanceof Error && cause.message === 'STAT_CALCULATOR_EV_TOTAL_EXCEEDED' ? '努力值总和不能超过 510。' : '等级、个体值和努力值必须为允许范围内的整数。' } }
  }
  function setAllIvs(): void { ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }; ivDrafts = { hp: '31', atk: '31', def: '31', spa: '31', spd: '31', spe: '31' } }
  function clearEvs(): void { evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }; evDrafts = { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' } }
  function natureEffect(nature: PokemonRuntimeData['natures'][number]): string { return nature.neutral ? '无能力修正' : `${statLabel(nature.plusStat!).zh}+ · ${statLabel(nature.minusStat!).zh}-` }
  function natureOption(nature: PokemonRuntimeData['natures'][number]): string { return `${natureLabel(nature.natureId, nature.canonicalName).zh}（${natureEffect(nature)}）` }
  function selectedNature() { return data.natures.find(nature => nature.natureId === natureId) ?? null }
  function natureInputValue(): string { const nature = selectedNature(); return natureQuery ?? (nature ? natureOption(nature) : '') }
  function handleNatureInput(value: string): void { natureQuery = value; const match = data.natures.find(nature => natureOption(nature) === value); if (match) natureId = match.natureId }
  function handleNatureKeydown(event: KeyboardEvent): void { if (event.key !== 'Enter') return; const input = event.currentTarget as HTMLInputElement; const query = input.value.trim().toLocaleLowerCase('zh-CN'); const first = data.natures.find(nature => natureOption(nature).toLocaleLowerCase('zh-CN').includes(query)); if (!first || !query) return; event.preventDefault(); natureId = first.natureId; natureQuery = natureOption(first); input.value = natureQuery }
  function editIv(stat: keyof RuntimeStatBlock, raw: string): void { ivDrafts = { ...ivDrafts, [stat]: raw }; const value = editableInteger(raw, 0, 31); if (value !== null) ivs = { ...ivs, [stat]: value } }
  function commitIv(stat: keyof RuntimeStatBlock): void { const value = normalizeEditableInteger(ivDrafts[stat], 0, 31, ivs[stat]); ivs = { ...ivs, [stat]: value }; ivDrafts = { ...ivDrafts, [stat]: String(value) } }
  function maximumEvFor(stat: keyof RuntimeStatBlock): number { return Math.min(252, 510 - ids.filter(id => id !== stat).reduce((total, id) => total + evs[id], 0)) }
  function editEv(stat: keyof RuntimeStatBlock, raw: string): void { evDrafts = { ...evDrafts, [stat]: raw }; const value = editableInteger(raw, 0, maximumEvFor(stat)); if (value !== null) evs = { ...evs, [stat]: value } }
  function commitEv(stat: keyof RuntimeStatBlock): void { const value = normalizeEditableInteger(evDrafts[stat], 0, maximumEvFor(stat), evs[stat]); evs = { ...evs, [stat]: value }; evDrafts = { ...evDrafts, [stat]: String(value) } }
  function commitOnEnter(event: KeyboardEvent, commit: () => void): void { if (event.key === 'Enter') { event.preventDefault(); commit() } }

  $: calculationNature = data.natures.find(candidate => candidate.natureId === natureId) ?? null
  $: result = calculate(selectedSpecies, selectedForm, calculationNature, level, ivs, evs)
  $: evTotal = totalEvs(evs)
</script>

<section class="stat-calculator">
  <h2>能力值计算 <small>Stat Calculator</small></h2>
  {#if !selectedSpecies || !selectedForm}
    <p class="status">请先在“宝可梦查询”中选择一个形态。</p>
  {:else}
    <p>使用 {selectedSpecies.zhName} 的当前形态种族值。努力值单项最多 252，总和最多 510。</p>
    <div class="stat-controls">
      <label>等级 <input type="number" min="1" max="100" step="1" bind:value={level} /></label>
      <label class="stat-nature">性格<input type="search" list="stat-nature-options" value={natureInputValue()} oninput={(event) => handleNatureInput((event.currentTarget as HTMLInputElement).value)} onkeydown={handleNatureKeydown} placeholder="输入或选择性格" /><datalist id="stat-nature-options">{#each data.natures as nature (nature.natureId)}<option value={natureOption(nature)}></option>{/each}</datalist></label>
      <button type="button" onclick={setAllIvs}>全部 IV 设为 31</button><button type="button" onclick={clearEvs}>清空 EV</button>
    </div>
    <p class:ev-over={evTotal > 510} class="ev-total">当前 EV 总和：{evTotal} / 510</p>
    {#if result.error}<p class="status error" role="alert">{result.error}</p>
    {:else if result.stats}<div class="stat-table-wrap"><table><thead><tr><th>属性 / Stat</th><th>基础 / Base</th><th>个体值 / IV</th><th>努力值 / EV</th><th>最终数值 / Final</th></tr></thead><tbody>
      {#each ids as stat}<tr><th scope="row">{formatLabel(statLabel(stat))}</th><td>{selectedForm.baseStats[stat]}</td><td><input aria-label={`${labels[stat]} IV`} type="number" min="0" max="31" step="1" value={ivDrafts[stat]} oninput={(event) => editIv(stat, (event.currentTarget as HTMLInputElement).value)} onblur={() => commitIv(stat)} onkeydown={(event) => commitOnEnter(event, () => commitIv(stat))} /></td><td><input aria-label={`${labels[stat]} EV`} type="number" min="0" max={maximumEvFor(stat)} step="1" value={evDrafts[stat]} oninput={(event) => editEv(stat, (event.currentTarget as HTMLInputElement).value)} onblur={() => commitEv(stat)} onkeydown={(event) => commitOnEnter(event, () => commitEv(stat))} /></td><td><strong>{result.stats[stat]}</strong></td></tr>{/each}
    </tbody></table></div>{/if}
  {/if}
</section>
