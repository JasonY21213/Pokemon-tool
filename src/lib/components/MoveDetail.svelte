<script lang="ts">
  import type { PokemonRuntimeData, RuntimeMove, RuntimeMoveDamageUnsupportedReason } from '../runtime-data/types'
  import { categoryLabel, entityLabel, formatLabel, typeLabel } from '../presentation/labels'
  export let data: PokemonRuntimeData
  export let move: RuntimeMove
  const category = (value: RuntimeMove['category']) => ({ physical: '物理', special: '特殊', status: '变化' })[value]
  const numeric = (value: RuntimeMove['power']) => value.kind === 'numeric' ? String(value.value) : value.kind === 'not-applicable' ? '—' : '未知'
  const accuracy = (value: RuntimeMove['accuracy']) => value.kind === 'percent' ? `${value.value}%` : value.kind === 'always' ? '必定命中' : '未知'
  const support: Record<RuntimeMoveDamageUnsupportedReason, string> = {
    'non-numeric-base-power': '没有可用于普通公式的固定威力。', 'variable-base-power': '威力会随战斗条件变化。', 'fixed-or-counter-damage': '使用固定伤害、反击或其他非普通伤害规则。', ohko: '一击必杀招式不使用普通伤害公式。', 'multi-hit': '多段招式的完整伤害分布尚未实现。', 'spread-target': '范围招式需要尚未实现的多目标伤害修正。', 'max-or-z-move': '极巨招式、超极巨招式或 Z 招式不在本阶段范围内。', 'nonstandard-stat-selection': '该招式不使用分类对应的普通攻防能力值。', 'nonstandard-type-effectiveness': '该招式会改变普通属性免疫或克制规则。', 'dynamic-move-type': '招式属性会随战斗条件变化。', 'dynamic-move-mechanics': '招式分类、威力或其他伤害语义会动态变化。', 'forced-critical-hit': '该招式强制要害攻击，而本阶段不计算要害。', 'damage-cap': '该招式包含防止击倒等伤害上限规则。', 'conditional-immunity': '该招式有额外的命中或免疫条件。', 'conditional-hit-mechanics': '该招式依赖本阶段未建模的命中条件或战斗状态。',
  }
  $: typeName = formatLabel(typeLabel(move.typeId, data.types.find(type => type.typeId === move.typeId)?.canonicalName ?? move.typeId))
</script>
<div class="move-detail" aria-live="polite"><h3>{entityLabel(move.zhName, move.canonicalName).zh} <small>{entityLabel(move.zhName, move.canonicalName).en}</small></h3><p>{move.zhDescription ?? '暂无中文简介。'}</p><div class="move-mechanics"><span>属性 / Type <b>{typeName}</b></span><span>招式分类 / Category <b>{formatLabel(categoryLabel(move.category))}</b></span><span>威力 / Power <b>{numeric(move.power)}</b></span><span>命中 / Accuracy <b>{accuracy(move.accuracy)}</b></span><span>PP <b>{numeric(move.pp)}</b></span><span>优先度 / Priority <b>{move.priority}</b></span></div>{#if move.damageSupport.status === 'supported'}<p>当前计算器支持 / Supported：普通单目标公式。</p>{:else if move.damageSupport.status === 'non-damaging'}<p>当前计算器未建模 / Unsupported：变化招式，不使用普通伤害公式。</p>{:else if move.damageSupport.status === 'unsupported'}<p>当前计算器未建模 / Unsupported：{support[move.damageSupport.reason]}</p>{:else}<p>当前计算器未建模 / Unsupported：资料不足，无法可靠计算。</p>{/if}</div>
