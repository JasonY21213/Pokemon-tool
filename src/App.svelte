<script lang="ts">
  import { onMount } from 'svelte'
  import DamageCalculator from './lib/components/DamageCalculator.svelte'
  import ExperienceCalculator from './lib/components/ExperienceCalculator.svelte'
  import MoveQuery from './lib/components/MoveQuery.svelte'
  import PokemonQuery from './lib/components/PokemonQuery.svelte'
  import StatCalculator from './lib/components/StatCalculator.svelte'
  import TypeMatchupCalculator from './lib/components/TypeMatchupCalculator.svelte'
  import { loadPokemonRuntimeData } from './lib/runtime-data/loader'
  import type { PokemonRuntimeData, RuntimeForm, RuntimeSpecies } from './lib/runtime-data/types'

  type Section = 'pokemon' | 'moves' | 'type' | 'stats' | 'experience' | 'damage'
  const sections: Array<{ id: Section; label: string }> = [
    { id: 'pokemon', label: '宝可梦查询' }, { id: 'moves', label: '招式查询' }, { id: 'type', label: '属性相性' },
    { id: 'stats', label: '种族值' }, { id: 'experience', label: '经验等级' }, { id: 'damage', label: '伤害计算' },
  ]
  let data: PokemonRuntimeData | null = null
  let error = ''
  let activeSection: Section = 'pokemon'
  let selectedSpecies: RuntimeSpecies | null = null
  let selectedForm: RuntimeForm | null = null
  onMount(async () => {
    try { data = await loadPokemonRuntimeData() }
    catch (cause) { error = cause instanceof Error ? cause.message : '无法加载运行时数据。' }
  })
</script>

<main>
  <header><h1>Pokémon Tool</h1><p>离线宝可梦资料查询与基础计算工具。</p></header>
  {#if error}<p class="status error" role="alert">{error}</p>
  {:else if !data}<p class="status">正在加载宝可梦数据…</p>
  {:else}
    <nav class="app-nav" aria-label="工具导航">{#each sections as section (section.id)}<button class:active={activeSection === section.id} aria-current={activeSection === section.id ? 'page' : undefined} type="button" onclick={() => activeSection = section.id}>{section.label}</button>{/each}</nav>
    {#if activeSection === 'pokemon'}<PokemonQuery {data} bind:selectedSpecies bind:selectedForm />
    {:else if activeSection === 'moves'}<MoveQuery {data} />
    {:else if activeSection === 'type'}<TypeMatchupCalculator {data} />
    {:else if activeSection === 'stats'}<StatCalculator {data} {selectedSpecies} {selectedForm} />
    {:else if activeSection === 'experience'}<ExperienceCalculator {data} {selectedSpecies} {selectedForm} />
    {:else}<DamageCalculator {data} />{/if}
  {/if}
</main>
