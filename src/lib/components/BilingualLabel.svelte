<script lang="ts">
  export let label: { zh: string; en: string }
  export let inline = true
</script>

<span class:bilingual-inline={inline} class="bilingual-label"><span class="bilingual-primary">{label.zh}</span>{#if label.en !== label.zh}<small class="bilingual-secondary">{label.en}</small>{/if}</span>
