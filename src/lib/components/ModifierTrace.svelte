<script lang="ts">
  import type { DamageModifierTraceEntry } from '../runtime-data/damage-calculator'
  import BilingualLabel from './BilingualLabel.svelte'
  import { traceLabel } from '../presentation/labels'
  export let trace: DamageModifierTraceEntry[]
</script>

{#if trace.length}
  <section class="modifier-trace" aria-label="伤害修正轨迹">
    <h4>伤害修正轨迹</h4>
    <ol>{#each trace as entry, index (`${entry.category}:${entry.source}:${index}`)}<li><BilingualLabel label={traceLabel(entry.category)} />：{entry.label}{#if entry.before !== undefined && entry.after !== undefined}（{entry.before} → {entry.after}）{/if}{#if entry.multiplier !== undefined}（{entry.multiplier}×）{/if}<small>来源 / Source: {entry.source}</small></li>{/each}</ol>
  </section>
{/if}
