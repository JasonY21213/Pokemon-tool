# Pokémon Showdown 数据源可行性分析

分析日期：2026-08-19  
上游仓库：[smogon/pokemon-showdown](https://github.com/smogon/pokemon-showdown)  
分析快照：`84d7ceb4f009928221fce7a00e711bab263c5f4e`（分析开始时 `master` 的最新提交）

本文只评估数据源，不定义最终数据模型，也不实现同步或转换程序。结论同时参考本项目的 [Excel 结构审计](./excel-analysis.md)。文中所说的“Showdown 数据”应理解为固定提交下的仓库源码和经该提交的 `Dex` 解析后的结果，而不是随时变化的 `master` 页面。

## 1. Executive Summary

**建议把 Pokémon Showdown 作为宝可梦英文对战基础数据的 canonical upstream（主要上游），但不能把它当作本项目全部领域的唯一真相。**

Showdown 特别适合作为以下内容的主来源：

- Pokémon form 级稳定的上游标识、英文名、全国编号、基础物种关系和形态关系。
- 属性、种族值、特性槽、身高、体重、性别、蛋组、世代等对战相关资料。
- 特性和招式的英文元数据、当前效果说明与编号。
- 属性克制基础表、25 种性格修正。
- 进化图的前后关系和多数常见进化条件。

Showdown 不足以独立负责：

- 简体中文实体名称和中文效果说明。
- 六种经验成长曲线及每个物种的成长类型。
- 完整、带编号且面向图鉴产品的地区图鉴数据。
- 御三家、准神等本项目分类；Showdown 只覆盖部分对战/官方标签。
- Excel 中的自定义分类、猜宝可梦辅助字段及项目特有说明。
- 全部纯外观差异；Showdown 明确不支持部分外观变化。

推荐架构为：

```text
固定 Showdown commit（英文对战事实）
              +
本地 localization（中文名称与说明）
              +
本地 custom metadata（地区图鉴、分类、产品字段）
              +
Excel（迁移来源、补充来源、交叉验证证据）
              ↓
开发期验证与规范化
              ↓
项目自有静态 JSON
              ↓
Svelte App（离线，不包含 Showdown runtime）
```

主要风险不是最终包体，而是**上游语义和接口并未承诺稳定**。Showdown 的 [Dex 文档](https://github.com/smogon/pokemon-showdown/blob/master/sim/DEX.md)明确说返回值尚未稳定，应固定版本；形态文档也明确说明某些实现可能改变。因此必须记录上游 commit、保留 ID 重命名映射、过滤非官方数据，并为复杂形态建立回归样例。

## 2. Relevant Showdown Repository Structure

### 2.1 主要文件及职责

| 文件 | 实际职责 | 适合本项目的用途 |
| --- | --- | --- |
| [`data/pokedex.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts) | Pokémon/form 的原始对战资料，以对象 key 作为 ID | Species/Form、属性、种族值、特性槽、形态与进化关系的核心来源 |
| [`data/abilities.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts) | 特性编号、名称、评分、标志和模拟器回调 | 元数据可抽取；回调代码不迁移 |
| [`data/text/abilities.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/text/abilities.ts) | 英文完整说明、短说明、旧世代说明和战斗消息 | 当前英文说明来源；战斗消息通常不需要 |
| [`data/moves.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts) | 招式数值、标志、特殊效果和模拟器回调 | 招式基础事实的核心来源；回调不迁移 |
| [`data/text/moves.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/text/moves.ts) | 招式英文说明及世代差异 | 英文说明来源 |
| [`data/learnsets.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/learnsets.ts) | form → move → 获得来源编码 | 将来做可学招式时使用；MVP 可不输出 |
| [`data/natures.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/natures.ts) | 25 种性格的英文名和增减能力 | 性格修正的主来源 |
| [`data/typechart.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/typechart.ts) | 防守属性对应的伤害代码及少量非伤害免疫 | 属性克制矩阵主来源，转换时需过滤与解码 |
| [`data/items.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/items.ts) | 道具元数据和模拟器逻辑 | 解析进化/形态所需道具引用；以后可扩展道具页 |
| [`data/text/items.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/text/items.ts) | 道具英文说明 | 必要时提供道具说明 |
| [`data/aliases.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/aliases.ts) | 便捷简称和旧称到 canonical 名称的映射 | 同步时解析别名、发现重命名；不能作为实体主键表 |
| [`data/formats-data.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/formats-data.ts) | Smogon tier、NatDex tier、双打 tier、非标准状态 | 过滤 `Past`、`CAP` 等；tier 不是核心图鉴事实 |
| [`data/FORMES.md`](https://github.com/smogon/pokemon-showdown/blob/master/data/FORMES.md) | Showdown 的形态语义说明 | 决定形态纳入范围时的必要规范 |
| [`data/tags.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/tags.ts) | Mythical、Restricted Legendary 等标签过滤器 | 可提供部分分类，但覆盖不等于项目分类需求 |
| [`data/rulesets.ts`](https://github.com/smogon/pokemon-showdown/blob/master/data/rulesets.ts) | 对战规则及部分地区可用名单 | 只能作地区收录的候选验证，不是规范地区图鉴数据库 |
| [`sim/dex.ts`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex.ts) | 合并数据、文本、mod、别名并暴露 Dex | 开发期生成器可调用；不得进入最终 Web runtime |
| [`sim/dex-species.ts`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex-species.ts) | Species/Form 类型、推导字段和查询实现 | 确认字段语义的首要来源 |
| [`sim/dex-moves.ts`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex-moves.ts) | Move 类型和解析实现 | 确认招式字段语义 |
| [`sim/dex-abilities.ts`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex-abilities.ts) | Ability 类型和解析实现 | 确认特性字段及世代推导 |
| [`sim/DEX.md`](https://github.com/smogon/pokemon-showdown/blob/master/sim/DEX.md) | Dex 查询 API 简介 | 指导开发期读取并提醒接口未稳定 |

### 2.2 原始表与 Dex 结果不可混同

`pokedex.ts`、`abilities.ts` 和 `moves.ts` 是可执行 TypeScript 数据模块，不是纯 JSON。部分字段直接写在文件中，部分由 `Dex` 推导，说明文字则从 `data/text/` 合并；旧世代还会通过 `data/mods/` 覆盖。`FORMES.md` 进一步说明，部分 cosmetic forme 并没有独立的 `pokedex.ts` 条目，而是由 `Dex.species.get()` 动态生成。

因此，长期同步时更可靠的输入是**固定提交的 Dex 解析结果 + 明确保留的原始来源信息**，而不是仅用正则读取几个 `.ts` 对象。

## 3. Pokémon / Form Model

### 3.1 已确认字段

[`SpeciesData`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex-species.ts) 明确要求：

- `name`
- `num`（注释明确为 National Dex number）
- `types`
- `abilities`，槽位为 `0`、可选 `1`、隐藏槽 `H`、特殊槽 `S`
- `baseStats`
- `eggGroups`
- `weightkg`

它继承 `Partial<Species>`，所以 `pokedex.ts` 条目还可包含或由 Dex 产生：

- 标识与显示：`id`、`name`、`baseSpecies`、`forme`、`baseForme`、`spriteid`。
- 形态集合：`otherFormes`、`cosmeticFormes`、`formeOrder`、`isCosmeticForme`。
- 战斗资料：`types`、`baseStats`、`abilities`、`heightm`、`weightkg`、`gender`、`genderRatio`、`eggGroups`、`color`。
- 进化：`prevo`、`evos`、`evoType`、`evoLevel`、`evoItem`、`evoMove`、`evoCondition`、`evoRegion`。
- 形态变化要求：`requiredItem`、`requiredItems`、`requiredMove`、`requiredAbility`、`requiredTeraType`、`battleOnly`、`changesFrom`。
- 特殊能力：`canGigantamax`、`cannotDynamax`、`gmaxUnreleased`、`isMega`、`isPrimal`。
- 版本与状态：`gen`、`isNonstandard`、`tags`、`tier`、`doublesTier`、`natDexTier`、`nfe`、`canHatch` 等。

这里需要注意：`id` 是 `pokedex.ts` 的对象 key 经 `toID` 规则规范化后的值；`gen`、`bst`、`nfe`、`isMega` 等有些值可由构造器推导，不保证每条都在原始文件中逐字出现。

### 3.2 Showdown 如何区分 Species 与 Form

Showdown 的 `Species` 对象实际上表示**一个具体 forme**。例如查询 `Basculin-Blue-Striped` 返回的是完整形态对象；其 `id` 是 `basculinbluestriped`，`baseSpecies` 才是 `Basculin`。代码注释还特别警告：`baseSpecies` 只是归组关系，不能据此推断可以从基础形态变换到该形态；可变换关系应读取 `changesFrom`。

对本项目而言应映射为：

- 一个 Showdown `baseSpecies` 归入一个项目 Species。
- 一个 Showdown `Species` 结果通常归入一个项目 Form。
- 普通形态也必须成为明确 Form，不能用缺少 form 代表普通形态。
- `changesFrom`、`battleOnly` 是形态变化关系，不是进化关系。

### 3.3 Showdown ID 是否适合作为 formId

结论：**适合作为有命名空间的上游 form 标识，但不应在没有迁移机制时假定永远不变。**

优点：

- 对象 key/`id` 在同一快照内唯一，能区分 `rotomheat`、`zygardecomplete`、`ogerponwellspringtera` 等。
- 全小写、去除空格和符号，适合程序引用。
- `aliases.ts` 能帮助解析部分简称和旧称。

限制：

- ID 从英文名称经 `toID` 得到，本质仍受上游命名影响。
- Dex 文档明确说返回值尚未稳定。
- `FORMES.md` 明确提醒某些形态实现会调整。
- aliases 是输入便利层，不是永久 ID 合同。

建议未来保存 `upstream.showdownId`，并将项目 formId 设计成 `showdown:<id>` 或由本项目分配的稳定 ID；每次升级比较 ID 集合，若出现删除/新增组合，必须通过 alias 或人工映射确认是否重命名，禁止静默当成“删除一个、新增一个”。

### 3.4 全国编号是否适合作为 speciesId

结论：**`num` 适合作为 `nationalDexNumber` 和官方物种的主要分组依据，但不宜无条件作为整个数据域唯一 speciesId。**

- 同一物种的所有形态共用 `num`，正好适合 Species 层归组。
- `pokedex.ts` 也包含 CAP 等非官方数据，能看到负数编号；Dex 文档要求使用方自行过滤 nonstandard 数据。
- 占位、未来和非标准条目需要通过 `isNonstandard`、`formats-data.ts` 等明确过滤。
- 全国编号不表达来源命名空间，若以后纳入非官方或特殊实体会冲突。

若本项目只收录官方、正数全国图鉴条目，可使用 `national:<num>` 作为内部 Species ID；仍建议把 `nationalDexNumber` 独立保存，并在同步验证中拒绝“同一正数对应多个无关 baseSpecies”。

### 3.5 不同形态的表示方式

| 形态 | Showdown 表示 |
| --- | --- |
| 普通/基础形态 | 基础对象；`baseSpecies` 通常等于自身名称，`forme` 为空，可能有 `baseForme` |
| 地区形态 | 独立对象，共用 `num`，含 `baseSpecies` 和 `forme: "Alola"/"Galar"/"Hisui"/...` |
| Mega/Primal | 独立对象，共用 `num`，通常含 `baseSpecies`、`forme`、`requiredItem`；Dex 还会推导 `isMega`/`isPrimal` |
| Gigantamax | 有独立便利条目和 G-Max 相关字段，但官方游戏语义并不把它当普通 forme；Showdown 没有为普通 Dynamax 建形态条目 |
| 性别差异 | 若影响对战数据/合法性，则可为独立 form，例如 `Meowstic-F` 有 `forme: "F"`、`gender: "F"`；纯贴图差异不保证全部建模 |
| 战斗形态 | 独立对象，常用 `battleOnly`、`requiredAbility`、`changesFrom` 表达来源限制 |
| 纯外观/cosmetic | 基础对象列出 `cosmeticFormes`，部分由 Dex 动态生成，不一定在 `pokedex.ts` 有完整条目 |

### 3.6 复杂案例

- **阿尔宙斯**：基础条目列出 17 个 `otherFormes` 和完整 `formeOrder`。例如 `arceusbug` 共享 `num: 493`，含 `baseSpecies: "Arceus"`、`forme: "Bug"`、`requiredItems` 和 `changesFrom: "Arceus"`。`FORMES.md` 特别说明其显示属性是为了符合用户预期，实际游戏属性由 Multitype 作用，因此“展示形态属性”和“底层战斗机制”存在语义差异。
- **洛托姆**：Heat/Wash/Frost/Fan/Mow 都是独立对象，列于 `otherFormes`/`formeOrder`，共享 `num: 479`，各有不同属性并以 `changesFrom: "Rotom"` 表示可从原始形态改变。
- **基格尔德**：10%、Complete 等为独立对象。Complete 有 `requiredAbility: "Power Construct"` 和 `battleOnly: ["Zygarde", "Zygarde-10%"]`。`FORMES.md` 对其事件特性形态建模给出明确的不稳定警告，所以它必须成为升级回归样例，不能硬编码当前条目数量。
- **厄诡椪**：面具形态用 `requiredItem`、`changesFrom`、`requiredTeraType`；太晶形态再以独立条目和 `battleOnly` 表示，特性也随形态变化。这说明只存 `forme` 字符串不足以表达形态语义。

### 3.7 纯外观形态的覆盖程度

覆盖是**有意不完整**的。`FORMES.md` 说明 Unown、多数 Vivillon、Deerling/Sawsbuck、Gastrodon、Flabébé 系列、Minior 颜色等可用 `cosmeticFormes`；某些视觉形态因招式合法性、闪光限制或必需道具而被当作普通 forme。与此同时，Alcremie 装饰和 Spinda 斑点明确不支持，普通 Dynamax 也不建 form。

因此 Showdown 可作为“对战相关形态”的主来源，不能宣称是所有官方外观组合的完整清单。项目应先确定产品是否需要纯图鉴外观穷举，再决定补充来源。

## 4. Ability Data

### 4.1 字段位置

| 内容 | 来源 |
| --- | --- |
| 稳定上游 ID | `data/abilities.ts` 对象 key，经 `toID` 解析 |
| 英文名 | `data/abilities.ts` 的 `name`，文本表也有 `name` |
| 编号 | `data/abilities.ts` 的 `num` |
| generation | `Ability` 构造器根据编号推导，个别数据可覆盖 |
| 简短说明 | `data/text/abilities.ts` 的 `shortDesc` |
| 完整说明 | `data/text/abilities.ts` 的 `desc`；有些仅提供短说明 |
| 旧世代说明 | 文本条目中的 `genN` 覆盖 |
| 对战逻辑 | `data/abilities.ts` 中 `onStart`、`onModify...` 等回调及 flags/condition |

### 4.2 应抽取与不应迁移的内容

建议抽取：`id`、`num`、英文名、`gen`、当前世代 `shortDesc`/`desc`、必要的 `isNonstandard`。若页面需要解释代际差异，可将旧世代说明作为可选独立版本数据，而不是混进当前说明。

不建议迁移：模拟器回调函数、battle event、战斗消息模板和整个 `condition`。它们属于 Showdown 模拟器实现，本项目不是对战模拟器。`rating` 是 Showdown 用于决策/评价的竞争性指标，不是特性本身的官方固有事实；除非未来有明确功能，否则不输出。少量 flags 只有在产品确实提供“可否被压制/复制”筛选时才抽取。

## 5. Move Data

[`MoveData`](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex-moves.ts) 和 `data/moves.ts` 已确认包含：

- 对象 key 形成的 Move ID。
- `num`、英文 `name`、`type`。
- `category`：Physical、Special 或 Status。
- `basePower`。
- `accuracy`：数值或 `true`；`true` 表示不走普通命中率判定，不能机械转换为 100。
- `pp`、`priority`、`target`、`flags`。
- 由 Dex/编号推导或覆盖的 `gen`。
- 状态、能力变化、吸血、反伤、多段、Z/Max 等大量可选结构字段。
- 更复杂机制的 TypeScript 回调。
- `data/text/moves.ts` 中的英文 `shortDesc`/`desc` 和世代差异说明。

结论：**可以替代 Excel `招式列表` 成为英文机械数据主来源，而且字段类型更明确、特殊机制覆盖更深。** Excel 仍应承担中文名、中文说明和迁移核对。

建议静态输出：`id`、`num`、英文名、属性、分类、威力、命中语义、PP、优先度、目标、世代、说明、非标准状态，以及产品明确需要的少量结构化机制。不要把回调源码或整个 `Move` 对象序列化进应用。

需要制定过滤规则：Showdown 同时包含过去世代、Z-Move、Max/G-Max、CAP、占位和未来数据。Dex 文档指出这些仍可能 `exists: true`，必须以 `isNonstandard` 和业务范围过滤，不能只判断是否存在。

### 5.1 Learnsets 的边界

`learnsets.ts` 按 form ID 记录 move ID 和来源码。源码定义：第一位是世代 1–9，随后 `M`（TM/HM）、`T`（教学）、`L`（升级及等级）、`R`（限制）、`E`（蛋招式）、`D`（Dream World）、`S`（活动）、`V`（转移）、`C`（内部链式遗传标记）。

它足以成为将来“可学招式”功能的重要上游，但体积和合法性语义都较复杂。本项目当前没有该功能需求时，不应为了“可能以后用到”把全量 learnset 放入最终 JSON。

## 6. Type and Nature Data

### 6.1 属性克制

`typechart.ts` 按**防守属性**保存 `damageTaken`。代码含义为：

- `0`：普通效果，倍率 1。
- `1`：弱点，倍率 2。
- `2`：抗性，倍率 0.5。
- `3`：免疫，倍率 0。

表中还混有 `brn`、`par`、`powder`、`prankster` 等非攻击属性键，以及当前的 `Stellar`。生成本项目 18×18 基础矩阵时必须只选择目标世代的标准攻击属性，并明确行列方向，不能把全部 `damageTaken` key 机械复制。

结论：足以替代 Excel `属性克制` 的基础矩阵成为主来源；Excel 已经通过 171 种单双属性组合验证完整，可继续作为独立交叉验证。双属性结果应继续由 TypeScript 实时计算，不存重复表。

### 6.2 性格

`natures.ts` 当前恰好列出 25 个性格。非中性性格用 `plus`/`minus` 指向 `atk`、`def`、`spa`、`spd` 或 `spe`；Hardy、Docile、Bashful、Quirky、Serious 等中性性格不写增减字段。

结论：足以替代 Excel 的 25 种能力修正成为主来源。它不提供本项目需要的中文名，也没有 Excel 中的口味展示映射，因此中文与额外展示字段仍需本地维护或从 Excel 迁移。

## 7. Evolution Data

### 7.1 结构化程度

Showdown 已确认提供：

- `prevo`：单个前置 form/species 名称。
- `evos`：数组，天然支持多分支；Eevee 条目直接列出 8 个目标。
- `evoType`：`trade`、`useItem`、`levelMove`、`levelExtra`、`levelFriendship`、`levelHold`、`other`。
- `evoLevel`。
- `evoItem`。
- `evoMove`。
- `evoCondition`：自由文本补充条件。
- `evoRegion`：类型当前只明确允许 `Alola` 或 `Galar`。

### 7.2 是否比 Excel 更适合作为主来源

**是。** 它的 `prevo`/`evos` 能构成明确图关系，常见等级、道具、交换、持有道具和已知招式条件有独立字段，比 Excel 主要依靠中文名称和自由文本更可靠，也能直接表达多分支。

但它不是完整的结构化条件语言：

- “夜晚”“傍晚”等继续写在 `evoCondition`。
- Alcremie 的旋转、Ursaluna 的月相、Basculegion 的累计反伤等复杂条件仍是英文自由文本。
- 部分看似道具的条件也可能写入 `evoCondition` 而非 `evoItem`。
- `evoRegion` 的类型范围有限，不能假定能覆盖所有今后地区/游戏限定条件。

因此推荐：Showdown 负责进化边与基础条件，项目转换层将可识别字段规范化；无法无损结构化的内容保留原始英文条件和来源，中文展示及必要补充由本地维护。禁止猜测或静默丢弃未知条件。

还必须区分：`requiredItem`、`requiredAbility`、`battleOnly`、`changesFrom` 是**形态变化**字段，不应错误转换成进化边。

## 8. Missing Domains

### 8.1 经验成长

在当前 `SpeciesData`/`Species` 接口、`pokedex.ts` 目标字段和 Dex 文档中，没有发现：

- experience growth rate。
- level-up growth type。
- 六种经验曲线或逐级经验表。

这与 Showdown 以对战模拟为目标一致：战斗数据直接使用等级，不负责游戏内升级流程。结论仅基于当前官方仓库接口和目标数据文件，不以一般宝可梦知识补全。

所以 Excel `等级` 中六条曲线仍需迁移为本地规则；每个 Species 的成长类型还需要 Excel 或另一个经确认的来源。Showdown 不能替代这一领域。

### 8.2 地区图鉴

`data/rulesets.ts` 确实含有 Paldea Pokédex、Galar/Isle of Armor/Crown Tundra 等对战合法性名单，但它们位于规则回调或大型名称数组中，目标是判断某格式是否允许，而不是提供：

- 完整的地区图鉴目录。
- 每个版本/子图鉴的正式编号。
- 稳定的 `dexId + regionalNumber + formId` 结构。
- 历代所有地区图鉴的一致覆盖。

因此这些名单可用于交叉验证“是否收录”，不应取代 Excel 中已经存在的关都、伽勒尔、铠岛、雪原、神奥、洗翠、帕底亚、北上乡、蓝莓学园等编号资料。地区图鉴仍属于本地维护领域。

### 8.3 分类

`pokedex.ts` 的 `tags` 与 `data/tags.ts` 当前支持 Mythical、Restricted Legendary、Sub-Legendary、Ultra Beast、Paradox、Pokestar，并能推导 Mega/Gigantamax 等过滤标签。这些对部分分类有用。

未发现同等层级、可直接满足项目要求的完整御三家或准神标签；Showdown 的 Smogon tier 也不能替代这些图鉴分类。Starter 还可能出现在某些特殊 form 名称中（例如 `Eevee-Starter`），这不等于“御三家分类表”。项目分类和 Excel 自定义分类仍需本地定义，并记录判定标准。

### 8.4 猜宝可梦辅助数据

Excel `猜宝可梦` 中的属性拼接、能力值极值、进化阶段、排名和展示字段大多是产品派生数据，不属于 Showdown 的数据目标。基础事实可从规范数据计算，用户自定义题库/分类需本地维护。

## 9. Localization

Showdown 主数据使用英文：`pokedex.ts`、abilities、moves、items 及 `data/text/` 都不是简体中文实体数据库。

仓库确有 [`translations/`](https://github.com/smogon/pokemon-showdown/tree/master/translations) 和 `simplifiedchinese` 目录，但官方 README 将其定义为“Pokémon Showdown 的可翻译字符串”。当前简体中文目录只见 `main.ts`、`minor-activities.ts`、`helptickets.ts` 等服务器/UI 活动文本，并不是完整的 Pokédex、特性、招式名称与效果说明表。

所以不能假设 translations 能替代中文数据库。当前建议：

- Showdown ID 作为跨语言关联键。
- 简体中文 Pokémon/form 名、特性名、招式名和说明由本项目 localization 层维护。
- Excel 作为首次迁移和校验来源；迁移时报告无法匹配、重复或语义冲突。
- 中文文本要记录来源和最近核对版本，不能因为英文上游更新而自动覆盖中文。

## 10. Licensing Notes

### 10.1 pokemon-showdown 主仓库

主仓库当前 [`LICENSE`](https://github.com/smogon/pokemon-showdown/blob/master/LICENSE) 是 MIT License，版权声明为 2011–2026 Guangcong Luo 及其他贡献者。许可证要求：软件副本或实质性部分中包含版权声明和许可声明。

如果本项目复制 Showdown 代码、文本或其具有表达性的实质部分，应至少保留相应 MIT notice，并在生成数据中记录来源仓库和 commit。对于“仅事实型数据经过规范化后的结果”究竟在不同法域如何定性，仓库许可证文本本身没有给出结论；本报告不作超出许可证文本的法律保证。Pokémon 名称、角色和其他知识产权问题也不是该 MIT 文件所能解决的。

### 10.2 pokemon-showdown-client

[`pokemon-showdown-client`](https://github.com/smogon/pokemon-showdown-client) 的 LICENSE 是 AGPLv3，与 server 主仓库的 MIT 不同。本项目的数据转换不需要复制 client 代码或资源，应避免把两者许可证混为一谈。若以后使用客户端图片、UI 或索引产物，必须单独重新审查来源和许可证。

## 11. Upstream Sync Options

| 方案 | 可复现性 | 更新与 diff | 离线开发 | 依赖/体积 | 判断 |
| --- | --- | --- | --- | --- | --- |
| A. 安装 `pokemon-showdown` npm package | 可由精确版本和 lockfile 固定，但 npm 版本不等同于任意 Git commit | 升级方便；跨版本源码 diff 不如 Git commit 直观 | 安装后可离线 | 当前包含 server、数据库等大量与本项目无关依赖；若严格 dev-only 可不进最终包 | 不作为首选；若直接使用 Dex API 能显著降低转换复杂度，可作为隔离的数据工具依赖重新评估 |
| B. git clone / shallow clone | checkout SHA 后强；普通 shallow clone 若只保留一个提交，历史 diff 需额外 fetch | Git 对比最清楚，可查看指定目录变更 | 最好 | 整仓较大；不能放进本项目 Git；可用临时缓存、shallow/sparse 变体 | **推荐的开发期工作副本方式**，前提是位于项目外缓存且固定 commit |
| C. 下载指定 commit 的相关文件 | 精确 SHA + 文件清单 + SHA-256 时很强 | 更新时需自己生成文件级 diff；容易漏掉 `data/text`、`sim`、`mods` 等隐含依赖 | 缓存后可离线 | 最小，但这些文件是 TS 而非 JSON，仅下载十个表不一定能正确复现 Dex 结果 | 适合成熟后做最小上游快照；第一版不宜低估依赖闭包 |
| D. GitHub raw URL | 使用 `master` 不可复现；URL 固定完整 SHA 才可复现 | 单文件查看方便，多文件一致性和 diff 较差 | 首次必须联网，需自行缓存 | 无安装、请求简单 | 适合人工审计和小规模试验，不推荐作为长期正式同步机制 |

当前 [`package.json`](https://github.com/smogon/pokemon-showdown/blob/master/package.json) 显示 npm 包除了模拟器还带有服务器、数据库和渲染相关依赖；[`sim/README.md`](https://github.com/smogon/pokemon-showdown/blob/master/sim/README.md) 也说明 API 目前是 Node-only、不是浏览器 API。无论采用哪种方式，最终 Svelte 构建都只应导入转换后的项目 JSON，不应把 `pokemon-showdown` package、Dex 或 server runtime 放入前端依赖图。

### 11.1 推荐同步方式

推荐 **B 为主、C 为发布留档**：

1. 在项目目录之外的开发缓存中，创建可丢弃的 shallow/sparse 上游工作副本。
2. 必须 checkout 已记录的完整 commit SHA，不直接以 `master` 生成正式数据。
3. 由开发期工具调用该快照的 Dex，获得已经合并文本、形态和推导字段的结果。
4. 在本项目中记录 commit、获取日期、转换器版本、输入文件清单和校验值；只提交规范化 JSON、来源清单、许可证 notice 和验证报告。
5. 若以后转换器稳定且能明确依赖闭包，可改为下载指定 commit 的 source archive 或最小文件集，减少缓存体积。

这比直接 npm 安装更容易查看 `oldSHA..newSHA -- data/ sim/dex-*` 的变化，也比散落的 raw URL 更能保证同一提交的一致快照。上游 checkout 只是生成期工具，不进入最终应用，也不嵌套提交到本仓库。

## 12. Showdown vs Excel Source Matrix

| 数据领域 | 判断 | 推荐来源与理由 |
| --- | --- | --- |
| Species | Showdown 更适合作为主来源、Excel 用于验证 | `baseSpecies`、正数 `num` 和非标准过滤比 Excel 混合行更清晰；中文与 Excel 差异需核对 |
| Form | Showdown 更适合作为主来源、Excel 用于补充/验证 | 独立 ID、形态关系和战斗条件明显更强；纯外观覆盖仍不完整 |
| 全国编号 | Showdown 可完全替代 Excel（官方对战条目范围内） | `num` 类型明确；仍应验证正数编号与 baseSpecies 的一对一归组 |
| 中文名称 | Showdown 缺失，需要 Excel/自维护 | translations 不是完整实体本地化 |
| 属性 | Showdown 可完全替代 Excel，Excel 验证 | form 级 `types` 明确；复杂形态覆盖更适合作主来源 |
| 种族值 | Showdown 更适合作为主来源、Excel 用于验证 | form 级六项齐全且可过滤非标准；Excel 已有 32 条缺失记录 |
| 特性槽 | Showdown 更适合作为主来源、Excel 用于验证 | `0/1/H/S` 槽语义清晰；Excel 存在复制第一槽等展示结构 |
| 特性英文说明 | Showdown 可完全替代 Excel 的英文领域 | `data/text/abilities.ts` 有短/完整及世代说明 |
| 特性中文说明 | Showdown 缺失，需要 Excel/自维护 | 主文本为英文 |
| 招式基础事实 | Showdown 更适合作为主来源、Excel 用于中文和验证 | 字段更完整且类型明确；需过滤非标准、保留 `accuracy: true` 语义 |
| 可学招式 | Showdown 可提供，Excel 审计未显示等价完整来源 | learnsets 结构丰富，但是否纳入产品仍是开放需求 |
| 属性克制 | Showdown 可完全替代 Excel，Excel 作为强验证 | Showdown 为版本化主来源；Excel 18×18 及 171 组合已验证一致性基础 |
| 性格能力修正 | Showdown 可完全替代 Excel，中文/口味仍本地化 | 25 种 plus/minus 完整；Excel 可验证与提供中文展示 |
| 经验类型/经验曲线 | Showdown 缺失，需要 Excel/自维护 | Species 接口和目标文件没有成长率；Excel 有六条曲线 |
| 进化关系 | Showdown 更适合作为主来源、Excel 用于补充/验证 | `prevo/evos` 和基础条件结构化；复杂条件仍有自由文本 |
| 世代 | Showdown 更适合作为主来源、Excel 用于验证 | Dex 可由编号/形态推导并支持 mod；需注意形态晚于基础物种出现 |
| 地区图鉴编号 | Showdown 缺失，需要 Excel/自维护 | rulesets 的部分成员名单无规范地区编号且覆盖目标不同 |
| 神兽/幻兽等分类 | 两边都有但语义不同 | Showdown 有 Mythical/Restricted/Sub-Legendary 等对战标签；项目中文分类和口径仍需定义 |
| 御三家/准神等分类 | Showdown 缺失或覆盖不足，需要 Excel/自维护 | 未发现完整、稳定的对应标签表 |
| Smogon tier | Showdown 独有，但不是当前核心需求 | 来自 formats-data，更新频繁，不应混作官方分类 |
| 猜宝可梦辅助数据 | Showdown 提供基础事实，产品字段需自维护/实时计算 | Excel 多为派生列和游戏逻辑，不应直接迁移成 canonical 数据 |
| 纯外观形态 | 暂时未知/需另定范围 | Showdown 部分支持，明确遗漏 Alcremie 装饰、Spinda 斑点等；Excel 覆盖也需另行核对 |
| 中文分类与说明 | Excel/自维护 | Showdown 的目标不是中文百科式数据库 |

## 13. Recommended Architecture

推荐采用以下职责边界：

### 13.1 Pokémon Showdown = canonical upstream

负责英文对战基础事实：Species/Form 关系、Showdown ID、全国编号、属性、种族值、特性槽、特性/招式英文资料、属性表、性格、基础进化关系、世代和非标准标记。

“canonical” 不代表不验证，而是冲突时默认以固定 Showdown commit 为基准，除非项目有记录完整的 override 和理由。

### 13.2 localization = 本地维护

以 Showdown ID 或本项目稳定 ID 为键，保存简体中文 Pokémon/form 名、特性名、招式名、说明及必要别名。来源可以先从 Excel 迁移，但必须处理重复、全半角、拼写和无法匹配项。

### 13.3 custom metadata = 本地维护

保存地区图鉴及编号、御三家/准神等项目分类、Excel 特有说明、猜宝可梦配置和产品展示规则。派生值继续在 TypeScript 中实时计算。

### 13.4 Excel = 迁移/校验来源

Excel 不再承担所有英文基础事实的唯一来源，但仍有重要价值：

- 初始化中文本地化和地区图鉴。
- 提供经验曲线和 Showdown 缺失领域。
- 对属性、种族值、特性、招式和进化做独立交叉验证。
- 保留用户长期维护的分类与说明。

发现冲突时应生成报告，不修改 Excel，也不静默覆盖本地数据。

### 13.5 理论上的上游更新流程

1. 选择新的 Showdown commit，记录完整 SHA 和上一个 SHA。
2. 查看两次提交在关注目录中的 diff，尤其是 pokedex、abilities、moves、text、learnsets、natures、typechart、items、aliases、formats-data、FORMES、Dex 类型和相关 mods。
3. 在隔离的开发期快照中运行转换，生成候选规范数据和来源清单。
4. 比较实体 ID：新增、删除、重命名、全国编号变化、baseSpecies 变化必须单独列出。
5. 对新增/改变的 form、招式、特性和进化条件运行 schema 与引用完整性验证。
6. 对复杂样例人工抽查：阿尔宙斯、洛托姆、基格尔德、厄诡椪、地区形态、性别形态、Mega、G-Max、cosmetic forme。
7. 将新增上游实体与本地中文/localization 对账；缺少中文时明确标记，不用英文或常识静默覆盖。
8. 与 Excel/自维护数据交叉验证，输出冲突报告。
9. 运行前端数据测试、TypeScript/Svelte 检查和 production build。
10. 只有审阅生成 diff、license notice 和验证报告后，才提交新的静态 JSON checkpoint。

## 14. Risks

1. **接口与形态语义变化**：Dex 返回值未稳定，Zygarde 等形态文档还明确提示实现可变。必须固定 commit 和做 ID/关系迁移。
2. **范围污染**：Dex 会返回 CAP、Past、Future、Unobtainable 等非标准数据；只看 `exists` 会把非目标实体混入正式图鉴。
3. **原始文件不是 JSON**：直接解析 `.ts` 容易漏掉文本合并、推导字段、mods 和动态 cosmetic forme。
4. **ID 并非永久合同**：Showdown ID 很实用，但仍由名称衍生；上游重命名必须显式迁移。
5. **形态和机制混淆**：G-Max、Tera、battleOnly、changesFrom 并非同一种关系；若统一当普通 form 会产生错误 UI 和进化关系。
6. **本地化滞后**：上游新增实体时，中文层不会自动出现，必须允许“待翻译”状态并阻止错误匹配。
7. **缺失领域**：经验成长、地区编号和项目分类不能因切换主来源而丢失。
8. **tier 波动**：formats-data 的 Smogon tier 更新频繁，不应与较稳定的物种事实同版本承诺。
9. **许可证和第三方权利**：MIT notice 义务容易处理，但仓库许可证不能替代对 Pokémon 品牌、图片或其他来源的单独审查。
10. **最终包体误引入**：如果生成脚本与前端依赖未隔离，打包器可能把 Showdown runtime 带入应用；必须用生成后的 JSON 作为唯一运行时输入。

## 15. Open Questions

- 本项目的正式收录范围：只收录当前官方主系列，还是也保留 Past、LGPE、Pokéstar、CAP 等？默认建议排除 CAP/Custom，并对 Past 条目保留但标注版本状态。
- 纯 cosmetic forme 是否需要完整枚举？如果页面只关注对战差异，可按 Showdown 覆盖；若要做完整外观图鉴，需要额外来源。
- `formId` 是直接采用 `showdown:<id>`，还是项目自己分配并把 Showdown ID 作为外部键？需要在正式 data model 阶段决定。
- 同一物种在不同世代的属性、特性、招式差异是否需要展示？若只显示最新世代，数据体积和模型会简单很多。
- 可学招式是否属于第一阶段？若不是，应避免把庞大 learnsets 输出到前端。
- 中文说明采用 Excel 原文、官方中文资料还是项目重写？需要明确来源许可和更新责任。
- 地区图鉴要按“游戏版本”“地区”“DLC 子图鉴”哪一级建模？Excel 已显示多种混合口径。
- 经验成长类型在 Excel 中能否可靠映射到每个 Species，还是还需另一个可追溯来源？
- Showdown 的 Legendary 标签口径是否与用户期望的“神兽/幻兽”中文分类一致？不能直接按名称翻译后假定等价。
- 生成数据中需要保留多少英文完整说明？完整 desc 会增加静态 JSON，但仍远小于整个 Showdown runtime，可按页面需求拆分或延迟加载。

## 16. Recommended Next Step

下一阶段仍不应直接写正式转换器。建议先做一个**小范围、可丢弃的来源映射验证**，而不是完整 data model：

1. 固定本报告记录的 Showdown commit。
2. 选取 Bulbasaur/Venusaur-Mega/G-Max、Meowstic-F、Rotom、Arceus、Zygarde、Ogerpon、Eevee 进化链等少量案例。
3. 只列出 Dex 实际返回字段、Showdown ID、Excel 对应名称和冲突，不生成正式 JSON。
4. 验证 nonstandard 过滤、cosmetic forme 生成、`data/text` 合并和 ID 重命名检测是否可行。
5. 基于验证结果，再进入正式 `data-model.md` 设计。

这个顺序能先证明“我们能稳定、可复现地读取 Showdown”，再决定项目 ID 和 JSON 结构，避免围绕错误的上游假设设计模型。
