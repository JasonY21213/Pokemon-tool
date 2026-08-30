import type { DamageModifierTraceCategory } from '../runtime-data/damage-calculator.js'

export type BilingualLabel = { zh: string; en: string }

export const appLabels = {
  pokemon: { zh: '宝可梦查询', en: 'Pokémon' }, team: { zh: '队伍构建', en: 'Team Builder' }, moves: { zh: '招式查询', en: 'Moves' },
  type: { zh: '属性相性', en: 'Type Matchup' }, stats: { zh: '能力值计算', en: 'Stat Calculator' }, experience: { zh: '经验与等级', en: 'Experience' }, damage: { zh: '伤害计算', en: 'Damage Calculator' },
} satisfies Record<string, BilingualLabel>

export const labels = {
  pokemon: { zh: '宝可梦', en: 'Pokémon' }, form: { zh: '形态', en: 'Form' }, types: { zh: '属性', en: 'Types' }, baseStats: { zh: '种族值', en: 'Base Stats' }, bst: { zh: '总和', en: 'BST' },
  ability: { zh: '特性', en: 'Ability' }, item: { zh: '持有物', en: 'Item' }, learnset: { zh: '可学招式', en: 'Learnset' }, nature: { zh: '性格', en: 'Nature' }, growthRate: { zh: '成长曲线', en: 'Growth Rate' },
  category: { zh: '招式分类', en: 'Category' }, power: { zh: '威力', en: 'Power' }, accuracy: { zh: '命中', en: 'Accuracy' }, priority: { zh: '优先度', en: 'Priority' },
  supported: { zh: '当前计算器支持', en: 'Supported' }, unsupported: { zh: '当前计算器未建模', en: 'Unsupported in current calculator' },
  member: { zh: '成员', en: 'Member' }, team: { zh: '队伍', en: 'Team' }, selectedMoves: { zh: '已选招式', en: 'Selected Moves' }, repeatedWeaknesses: { zh: '重复弱点', en: 'Repeated Weaknesses' }, resistances: { zh: '抗性', en: 'Resistances' }, immunities: { zh: '免疫', en: 'Immunities' }, coverage: { zh: '覆盖', en: 'Coverage' }, uncovered: { zh: '未覆盖', en: 'Uncovered' }, source: { zh: '来源', en: 'Source' },
} satisfies Record<string, BilingualLabel>

const types: Record<string, BilingualLabel> = {
  'type:normal': { zh: '一般', en: 'Normal' }, 'type:fire': { zh: '火', en: 'Fire' }, 'type:water': { zh: '水', en: 'Water' }, 'type:electric': { zh: '电', en: 'Electric' }, 'type:grass': { zh: '草', en: 'Grass' }, 'type:ice': { zh: '冰', en: 'Ice' }, 'type:fighting': { zh: '格斗', en: 'Fighting' }, 'type:poison': { zh: '毒', en: 'Poison' }, 'type:ground': { zh: '地面', en: 'Ground' }, 'type:flying': { zh: '飞行', en: 'Flying' }, 'type:psychic': { zh: '超能力', en: 'Psychic' }, 'type:bug': { zh: '虫', en: 'Bug' }, 'type:rock': { zh: '岩石', en: 'Rock' }, 'type:ghost': { zh: '幽灵', en: 'Ghost' }, 'type:dragon': { zh: '龙', en: 'Dragon' }, 'type:dark': { zh: '恶', en: 'Dark' }, 'type:steel': { zh: '钢', en: 'Steel' }, 'type:fairy': { zh: '妖精', en: 'Fairy' },
}

const stats: Record<string, BilingualLabel> = { hp: { zh: 'HP', en: 'HP' }, atk: { zh: '攻击', en: 'Attack' }, def: { zh: '防御', en: 'Defense' }, spa: { zh: '特攻', en: 'Special Attack' }, spd: { zh: '特防', en: 'Special Defense' }, spe: { zh: '速度', en: 'Speed' } }
const categories: Record<string, BilingualLabel> = { physical: { zh: '物理', en: 'Physical' }, special: { zh: '特殊', en: 'Special' }, status: { zh: '变化', en: 'Status' } }
const growthRates: Record<string, BilingualLabel> = { 'growth:erratic': { zh: '飘忽', en: 'Erratic' }, 'growth:fast': { zh: '快速', en: 'Fast' }, 'growth:medium-fast': { zh: '较快', en: 'Medium Fast' }, 'growth:medium-slow': { zh: '较慢', en: 'Medium Slow' }, 'growth:slow': { zh: '缓慢', en: 'Slow' }, 'growth:fluctuating': { zh: '波动', en: 'Fluctuating' } }
const natures: Record<string, BilingualLabel> = { hardy: { zh: '勤奋', en: 'Hardy' }, lonely: { zh: '怕寂寞', en: 'Lonely' }, brave: { zh: '勇敢', en: 'Brave' }, adamant: { zh: '固执', en: 'Adamant' }, naughty: { zh: '顽皮', en: 'Naughty' }, bold: { zh: '大胆', en: 'Bold' }, docile: { zh: '坦率', en: 'Docile' }, relaxed: { zh: '悠闲', en: 'Relaxed' }, impish: { zh: '淘气', en: 'Impish' }, lax: { zh: '乐天', en: 'Lax' }, timid: { zh: '胆小', en: 'Timid' }, hasty: { zh: '急躁', en: 'Hasty' }, serious: { zh: '认真', en: 'Serious' }, jolly: { zh: '爽朗', en: 'Jolly' }, naive: { zh: '天真', en: 'Naive' }, modest: { zh: '内敛', en: 'Modest' }, mild: { zh: '慢吞吞', en: 'Mild' }, quiet: { zh: '冷静', en: 'Quiet' }, bashful: { zh: '害羞', en: 'Bashful' }, rash: { zh: '马虎', en: 'Rash' }, calm: { zh: '温和', en: 'Calm' }, gentle: { zh: '温顺', en: 'Gentle' }, sassy: { zh: '自大', en: 'Sassy' }, careful: { zh: '慎重', en: 'Careful' }, quirky: { zh: '浮躁', en: 'Quirky' } }
const trace: Record<DamageModifierTraceCategory, BilingualLabel> = { 'stat-stage': { zh: '能力阶级', en: 'Stat Stage' }, 'defensive-weather-stat': { zh: '天气防御修正', en: 'Weather Defense' }, 'ability-stat': { zh: '特性能力修正', en: 'Ability Effect' }, 'item-stat': { zh: '持有物能力修正', en: 'Item Effect' }, 'move-power': { zh: '招式威力修正', en: 'Move Power' }, 'core-base-damage': { zh: '基础伤害', en: 'Core Base Damage' }, weather: { zh: '天气修正', en: 'Weather' }, critical: { zh: '要害', en: 'Critical Hit' }, random: { zh: '随机浮动', en: 'Random (85–100%)' }, 'stellar-usage': { zh: '星晶增伤状态', en: 'Stellar Usage' }, stab: { zh: '属性一致加成', en: 'STAB' }, 'type-effectiveness': { zh: '属性相性', en: 'Type Effectiveness' }, burn: { zh: '灼伤修正', en: 'Burn' }, screen: { zh: '墙类修正', en: 'Reflect / Light Screen' }, 'ability-final': { zh: '特性效果', en: 'Ability Effect' }, 'item-final': { zh: '持有物效果', en: 'Item Effect' }, 'ability-immunity': { zh: '特性免疫', en: 'Ability Immunity' } }

const canonicalFallback = (canonicalName: string): BilingualLabel => ({ zh: '暂无中文', en: canonicalName })
export const typeLabel = (id: string, canonicalName = id) => types[id] ?? canonicalFallback(canonicalName)
export const statLabel = (id: string) => stats[id] ?? canonicalFallback(id)
export const categoryLabel = (id: string) => categories[id] ?? canonicalFallback(id)
export const natureLabel = (natureId: string, canonicalName: string) => natures[natureId.replace('nature:', '')] ?? canonicalFallback(canonicalName)
export const growthRateLabel = (growthRateId: string, canonicalName: string) => growthRates[growthRateId] ?? canonicalFallback(canonicalName)
export const traceLabel = (category: DamageModifierTraceCategory) => trace[category]
export const entityLabel = (zhName: string | null, canonicalName: string): BilingualLabel => zhName ? { zh: zhName, en: canonicalName } : canonicalFallback(canonicalName)
export const formatLabel = (label: BilingualLabel): string => label.zh === label.en ? label.zh : `${label.zh} / ${label.en}`
