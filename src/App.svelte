<script lang="ts">
  import { onMount } from 'svelte'
  import DamageCalculator from './lib/components/DamageCalculator.svelte'
  import ExperienceCalculator from './lib/components/ExperienceCalculator.svelte'
  import MoveQuery from './lib/components/MoveQuery.svelte'
  import PokemonQuery from './lib/components/PokemonQuery.svelte'
  import StatCalculator from './lib/components/StatCalculator.svelte'
  import TypeMatchupCalculator from './lib/components/TypeMatchupCalculator.svelte'
  import TeamBuilder from './lib/components/TeamBuilder.svelte'
  import BilingualLabel from './lib/components/BilingualLabel.svelte'
  import { appLabels } from './lib/presentation/labels'
  import { loadCoreRuntimeData, loadLearnsets } from './lib/runtime-data/loader'
  import { TEAM_STORAGE_KEY, clearStoredTeamState, encodeShareTeamState, revalidateTeamLearnsets, resolveStartupTeamState, saveStoredTeamState } from './lib/runtime-data/team-persistence'
  import type { TeamMember } from './lib/runtime-data/team-builder'
  import type { CoreRuntimeData, LearnsetRuntimeData, RuntimeForm, RuntimeSpecies } from './lib/runtime-data/types'

  type Section = 'pokemon' | 'team' | 'moves' | 'type' | 'stats' | 'experience' | 'damage'
  const sections: Array<{ id: Section; label: typeof appLabels[keyof typeof appLabels] }> = [
    { id: 'pokemon', label: appLabels.pokemon }, { id: 'team', label: appLabels.team }, { id: 'moves', label: appLabels.moves }, { id: 'type', label: appLabels.type },
    { id: 'stats', label: appLabels.stats }, { id: 'experience', label: appLabels.experience }, { id: 'damage', label: appLabels.damage },
  ]
  let data: CoreRuntimeData | null = null
  let learnsets: LearnsetRuntimeData | null = null
  let learnsetsLoading = false
  let learnsetsError = ''
  let error = ''
  let activeSection: Section = 'pokemon'
  let selectedSpecies: RuntimeSpecies | null = null
  let selectedForm: RuntimeForm | null = null
  let teamMembers: TeamMember[] = []
  let shareStatus = ''
  let persistenceReady = false
  function setTeamMembers(members: TeamMember[]): void {
    teamMembers = members
    if (persistenceReady && !saveStoredTeamState(window.localStorage, members)) shareStatus = '无法保存到此浏览器；队伍仍可在当前页面使用。'
  }
  function clearSavedTeam(): void {
    teamMembers = []
    shareStatus = clearStoredTeamState(window.localStorage) ? '已清除本浏览器保存的队伍。' : '无法清除浏览器保存内容；当前队伍已清空。'
  }
  async function requestLearnsets(): Promise<void> {
    if (!data || learnsets || learnsetsLoading) return
    learnsetsLoading = true
    learnsetsError = ''
    try {
      const loaded = await loadLearnsets(data)
      learnsets = loaded
      const validated = revalidateTeamLearnsets(teamMembers, loaded)
      if (JSON.stringify(validated) !== JSON.stringify(teamMembers)) setTeamMembers(validated)
    }
    catch (cause) {
      console.error('Learnset data load failed.', cause)
      learnsetsError = cause instanceof Error ? cause.message : '可学招式数据加载失败，请重试。'
    }
    finally { learnsetsLoading = false }
  }
  async function copyShareLink(): Promise<void> {
    const url = new URL(window.location.href)
    url.searchParams.set('team', encodeShareTeamState(teamMembers))
    try { await navigator.clipboard.writeText(url.toString()); shareStatus = '分享链接已复制。' }
    catch { shareStatus = `无法访问剪贴板，请复制此链接：${url.toString()}` }
  }
  onMount(async () => {
    try {
      data = await loadCoreRuntimeData()
      const shared = new URLSearchParams(window.location.search).get('team')
      let stored: string | null = null
      try { stored = window.localStorage.getItem(TEAM_STORAGE_KEY) } catch { /* Browser storage can be unavailable. */ }
      const restored = resolveStartupTeamState(shared, stored, data)
      teamMembers = restored.members
      persistenceReady = true
      if (restored.source === 'url') shareStatus = '已从分享链接恢复队伍；它优先于本浏览器保存内容。'
    }
    catch (cause) {
      console.error('Runtime data startup failed.', cause)
      error = cause instanceof Error ? cause.message : '无法加载运行时数据。'
    }
  })
</script>

<main>
  <header><h1>Pokémon Tool</h1><p>离线宝可梦资料查询与基础计算工具。</p></header>
  {#if error}<p class="status error" role="alert">{error}</p>
  {:else if !data}<p class="status" role="status" aria-live="polite">正在加载宝可梦数据…</p>
  {:else}
    <nav class="app-nav" aria-label="工具导航">{#each sections as section (section.id)}<button class:active={activeSection === section.id} aria-current={activeSection === section.id ? 'page' : undefined} type="button" onclick={() => activeSection = section.id}><BilingualLabel label={section.label} /></button>{/each}</nav>
    {#if activeSection === 'pokemon'}<PokemonQuery {data} {learnsets} {learnsetsLoading} {learnsetsError} onRequestLearnsets={requestLearnsets} bind:selectedSpecies bind:selectedForm />
    {:else if activeSection === 'team'}<TeamBuilder {data} {learnsets} {learnsetsLoading} {learnsetsError} onRequestLearnsets={requestLearnsets} {selectedForm} members={teamMembers} onMembersChange={setTeamMembers} onClearSavedTeam={clearSavedTeam} onCopyShareLink={copyShareLink} {shareStatus} />
    {:else if activeSection === 'moves'}<MoveQuery {data} />
    {:else if activeSection === 'type'}<TypeMatchupCalculator {data} />
    {:else if activeSection === 'stats'}<StatCalculator {data} {selectedSpecies} {selectedForm} />
    {:else if activeSection === 'experience'}<ExperienceCalculator {data} {selectedSpecies} {selectedForm} />
    {:else}<DamageCalculator {data} {learnsets} {learnsetsLoading} {learnsetsError} onRequestLearnsets={requestLearnsets} />{/if}
  {/if}
</main>
