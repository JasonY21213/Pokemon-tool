# Pokémon Tool Data Model

本文定义 Pokémon Tool 第一版规范数据的设计边界。它是转换器和运行时 JSON 的设计依据，不是任何上游 schema 的镜像，也不包含转换器实现或正式数据。

## 1. Design Goals

模型必须同时满足以下目标：

- **稳定**：项目引用不因中文改名或 Showdown ID 调整而整体失效。
- **规范化**：Species、Form、Appearance、本地化、进化关系和地区图鉴各自承担单一职责。
- **轻量**：最终 Svelte App 只加载产品需要的静态数据，不包含上游 runtime、抓取器或完整 provenance。
- **离线**：生成后的应用不依赖网络、后端或数据库。
- **可验证**：任何规范值都能在生成阶段追溯到固定上游版本、文件和映射方法。
- **不丢信息**：无法安全结构化的值保留原文和冲突记录，不猜测、不静默忽略。
- **可扩展**：能表达新 Species、对战形态、纯外观、版本可用性和未来语言，同时避免提前建立无产品价值的大型体系。

三个重要分界：

1. identity 对齐不代表 mechanics 值自动可信；
2. 对战数据与纯视觉外观分开；
3. canonical runtime data 与 build-time audit data 分开。

## 2. Data Source Responsibilities

| Source | Primary responsibility | Not responsible for |
| --- | --- | --- |
| Pokémon Showdown | 对战机械事实、英文名、Species/Form 关系、battle-form identity、Type、Nature、基础进化图 | 中文本地化、成长率、规范地区图鉴、完整 cosmetic appearance |
| `pokemon-dataset-zh` | 简体中文候选本地化、成长率候选、地区图鉴候选、中文百科字段 | canonical battle mechanics、稳定 form identity、最终 scope 判定 |
| Local curated data | 项目稳定 ID、映射例外、冲突裁决、分类、经验公式、scope 定义、人工验证 override | 批量复制上游数据 |
| Excel | legacy migration、独立验证、项目历史分类和复杂中文原文 | canonical identity、自动覆盖更可靠的结构化上游 |

所有上游都必须固定版本。Showdown 使用完整 commit SHA；中文仓库使用完整 commit SHA；Excel 使用 SHA-256、大小和修改时间。显式、带理由的本地 override 可以高于默认上游优先级，但不能伪装成自动同步结果。

## 3. Scope Policy

### 3.1 第一版主 namespace

默认纳入：

- 官方 Pokémon；
- 正数 National Dex；
- 当前目标主系列数据；
- base、地区、Mega、Primal、G-Max、战斗中变化及其他有明确对战意义的 form；
- 能安全映射、且产品确实需要的 cosmetic appearance。

默认不纳入主 namespace：CAP、Custom、Pokéstar 等非官方实体，以及负编号条目。它们可以在 build-time 报告中出现，但不能获得 `species:*` 主 namespace ID。未来若决定支持，应使用单独 namespace，而不是复用全国编号。

### 3.2 Availability 与数据质量分离

`Past`、`Future`、`Unobtainable` 不应被删除。每个可能受版本影响的实体使用：

| Field | Values | Meaning |
| --- | --- | --- |
| `availability.lifecycle` | `current`, `past`, `future`, `unknown` | 相对于项目目标规则集的时间状态 |
| `availability.obtainability` | `obtainable`, `unobtainable`, `unknown` | 是否可正常获得；与时间状态不是同一个概念 |
| `availability.contexts` | 可选 game/generation 范围 | 仅在产品需要版本筛选时输出 |
| `dataStatus` | `complete`, `partial`, `unresolved` | 项目数据是否完整，不能代替游戏可用性 |

这样可表达“过去存在但当前不可获得”“未来占位且不可获得”等组合。上游原始 `isNonstandard` 保留在 provenance 中，转换成项目语义后才进入 runtime。

## 4. Entity Overview

| Entity/value | Runtime? | Decision |
| --- | --- | --- |
| Species | 是 | 官方物种层，按全国编号归组 |
| Form | 是 | 一组明确的对战数据与形态要求；base 也必须存在 |
| Appearance | 是 | 不改变 mechanics 的视觉差异，可无 Showdown ID |
| Ability | 是 | 独立官方特性 identity |
| Move | 是 | 独立招式 identity 与当前机械元数据 |
| Type | 是 | 基础属性 identity 与单属性克制表 |
| Nature | 是 | 25 种性格修正 |
| GrowthRate | 是 | 六条成长曲线的 identity 与公式标识 |
| EvolutionEdge | 是 | 进化图的有向边 |
| EvolutionCondition | 值对象 | 只在 EvolutionEdge 内存在，不需要独立文件或全局 ID |
| Dex / DexEntry | 是 | 地区图鉴定义及成员关系 |
| Localization | 是，独立文件 | 以稳定实体 ID 为键；英文 canonical name 仍内嵌核心实体 |
| TagDefinition / TagAssignment | 是 | 项目自维护分类，避免大量 boolean |
| Item | 最小支持实体 | Form 与进化需要稳定 item 引用；第一版只收录实际被引用的道具 |
| ExternalIdentifier | build-time 值对象 | 不建立大型 runtime 实体表；关键编号仍是强类型字段 |
| SourceReference / ValueProvenance | 仅 build-time | 记录固定版本、路径、原始定位和映射方法 |
| MappingException | 仅 build-time | 记录不能由通用规则完成的稳定映射 |
| ConflictRecord | 仅 build-time | 记录候选值、裁决与 unresolved |

不建立独立 `Region`、`Game`、`Location` 或 `EncyclopediaEntry` 实体，直到产品确实需要跨领域复用它们。第一版用受控 ID/文本即可，避免为了架构完整而增加空壳。

## 5. Species

Species 表示共享全国编号的官方物种归组，不表示某一行对战数据。

| Field | Type | Rule |
| --- | --- | --- |
| `speciesId` | string | 项目稳定 ID，例如 `species:0006` |
| `nationalDexNumber` | positive integer | 官方正数；在主 namespace 唯一 |
| `canonicalName.en` | string | Showdown canonical English base species name |
| `generation` | positive integer | 物种首次出现世代；与某个 form 的出现世代可不同 |
| `defaultFormId` | FormId | 必须指向本 Species 的显式 base/default Form |
| `growthRate` | GrowthRateResolution | Species 默认成长率，允许 unresolved |
| `tagIds` | TagId[] | 项目分类引用，不使用一组 boolean |
| `availability` | Availability | 时间/可获得状态 |
| `dataStatus` | enum | `complete`, `partial`, `unresolved` |

示例 ID 使用 `species:0006`，而不是 `national:6` 或 `charizard`：

- 固定四位宽便于排序、检查和 diff；
- 不依赖中文或英文名称；
- 类型前缀避免与 Ability/Move 的官方编号冲突；
- `nationalDexNumber` 仍单独保存，不能把 ID 字符串当数值字段使用。

Species 与 Form 是一对多。全国编号只能确定 Species，不能作为 Form ID。每个 Species 恰好有一个 `defaultFormId`，且该 Form 必须真实存在；禁止用“找不到 form 时隐式使用普通形态”。

`GrowthRateResolution` 的 runtime 最小形态为 `{ id: GrowthRateId | null, status: "resolved" | "unresolved" }`。人工 override、冲突候选和来源不放进该对象，而记录在 build-time provenance/conflict 数据。

## 6. Form

Form 表示具有明确对战数据、合法性或形态变化语义的形态。字段如下：

| Field | Type | Rule |
| --- | --- | --- |
| `formId` | string | 项目稳定 ID，如 `form:0006:mega-x` |
| `speciesId` | SpeciesId | 必须引用所属 Species |
| `canonicalName.en` | string | 当前 canonical English form name |
| `formLabel.en` | string/null | `Mega X`, `Wash`, `Hisui` 等；base 可为 `null` |
| `formKind` | coarse enum | `base`, `regional`, `mega`, `primal`, `gmax`, `battle`, `special` |
| `traits` | FormTrait[] | 可组合语义，如 `battle-only`, `tera-related`, `item-dependent`, `gender-specific` |
| `showdownId` | string/null | 上游 locator，不是项目主键 |
| `types` | TypeId[] | 1–2 个当前目标规则集属性 |
| `baseStats` | StatBlock | hp/atk/def/spa/spd/spe 六项 |
| `abilities` | AbilitySlot[] | 槽 `0`, `1`, `H`, `S` 唯一 |
| `heightM`, `weightKg` | number/null | 缺失时为 null，不猜值 |
| `gender` | `M`, `F`, `N`, null | 固定性别；否则使用 ratio |
| `genderRatio` | object/null | male/female 百分比，合计必须为 100 |
| `eggGroupIds` | string[] | 使用受控本地 ID；需要时再升级为实体 |
| `battleOnly` | boolean | 是否只能在战斗等状态中存在 |
| `changesFromFormIds` | FormId[] | 形态变化来源，不是 evolution |
| `requiredItemIds` | ItemId[] | 0..n；覆盖 requiredItem(s) |
| `requiredAbilityId` | AbilityId/null | 形态要求 |
| `requiredMoveId` | MoveId/null | 形态要求 |
| `requiredTeraTypeId` | TypeId/null | Tera 相关要求 |
| `growthRateOverride` | GrowthRateResolution/null | 仅当 form 与 Species 默认不同 |
| `availability`, `dataStatus` | common metadata | 同 Scope Policy |

### 6.1 `formKind + traits`，而不是大量 flags

只用一个巨大 enum 会失败：Ogerpon-Wellspring-Tera 同时是面具、道具依赖、Tera、battle-only；Zygarde-Complete 同时是 battle-only 和 ability-dependent。只用一组 boolean 又会迅速膨胀并失去分类主线。

推荐一个**粗粒度 `formKind` + 可组合 `traits` + 结构化 requirement 字段**：

- `formKind` 用于 UI 分组和主要语义；
- `traits` 表达重叠能力，不承载具体 item/ability 值；
- `required*`、`battleOnly`、`changesFromFormIds` 承载真实约束。

`FormTrait` 是可扩展的项目受控词表，不把当前 Showdown 字段直接当永久 enum。base form 也可有 traits，但 `formKind` 必须是 `base`。

## 7. Appearance

Appearance 必须独立存在。判断规则很简单：**如果差异不改变 types、stats、ability slots、合法性或形态要求，只改变视觉/显示，则优先是 Appearance；否则是 Form。**

| Field | Type | Rule |
| --- | --- | --- |
| `appearanceId` | string | 项目稳定 ID，例如 `appearance:0869:vanilla-cream:strawberry-sweet` |
| `speciesId` | SpeciesId | 必填，支持没有明确 Form 的来源记录 |
| `formId` | FormId/null | mechanics 由某 Form 承担时关联它 |
| `isDefault` | boolean | 同一 Form 最多一个默认外观 |
| `aspects` | AppearanceAspect[] | 维度和值，例如 cream、sweet、glyph、season |
| `availability` | Availability | 可选版本状态 |
| `dataStatus` | enum | 允许 partial/unresolved |

Appearance 不保存 `types`、`baseStats`、`abilities` 或 evolution mechanics。显示名来自 localization；图片资产若未来引入，只引用受许可的项目资源 ID，不把上游图片路径当 identity。

Alcremie 示例概念：

```json
{
  "appearanceId": "appearance:0869:vanilla-cream:strawberry-sweet",
  "speciesId": "species:0869",
  "formId": "form:0869:base",
  "aspects": [
    { "dimension": "cream", "value": "vanilla-cream" },
    { "dimension": "sweet", "value": "strawberry-sweet" }
  ]
}
```

9 个 cream × 7 个 sweet 形成 63 个 Appearance。Showdown 的 cream-level cosmetic 名称可作为 build-time 映射证据，但不能充当每个组合的唯一 external ID。Alcremie-Gmax 仍是 Form，不是 Appearance。

Unown 字母/符号通常是 Appearance；Meowstic 雌雄因 hidden ability 不同而是 Form；只有贴图差异、mechanics 完全相同的性别差异才是 Appearance。Arceus 属性形态改变对战属性和 required items，因此是 Form，`home_images` 只用于验证覆盖。

## 8. Ability

| Field | Type | Rule |
| --- | --- | --- |
| `abilityId` | string | 有官方编号时如 `ability:0065` |
| `officialNumber` | positive integer | 重要 identity 字段，主范围内不可重复 |
| `showdownId` | string | external locator，例如 `overgrow` |
| `canonicalName.en` | string | Showdown 英文名 |
| `generation` | integer | 当前 canonical generation |
| `mechanicalMetadata` | small object | 仅产品需要的当前 flags/短说明，不含模拟器回调 |
| `availability`, `dataStatus` | common metadata | 可表达 Future/Past/Unobtainable |

中文名、简述和长说明在 localization 文件中，以 `abilityId` 为键。Showdown 的 callback、battle event 和 rating 不进入 runtime。

Embody Aspect 301–304 必须得到 `ability:0301` 至 `ability:0304` 四个实体。即使中文名和基础英文名相同，也不能去重。其各自 Showdown ID 和形态后缀英文名分别保存，中文共用文本只能作为 localization/provenance 的复用，不改变 identity。

## 9. Move

| Field | Type | Rule |
| --- | --- | --- |
| `moveId` | string | 编号招式如 `move:0904`；无编号使用项目分配的 `move:special:*` |
| `officialNumber` | positive integer/null | G-Max Wildfire 等可为 null |
| `showdownId` | string | external locator，不是主键 |
| `canonicalName.en` | string | Showdown 英文名 |
| `typeId` | TypeId | 当前机械属性 |
| `category` | `physical`, `special`, `status` | 项目 canonical 值 |
| `basePower` | NumericSemantic | 数值、variable、not-applicable 或 unknown |
| `accuracy` | AccuracySemantic | 见下文 |
| `pp` | NumericSemantic | 数值、not-applicable 或 unknown |
| `priority` | integer | 默认 0 也应明确生成 |
| `target` | controlled string | 从 Showdown 规范化 |
| `generation` | integer | 当前 canonical generation |
| `availability`, `dataStatus` | common metadata | 保留 Past/Future 等概念 |

`accuracy` 不能是 `number | null`，推荐判别联合：

```text
{ kind: "percent", value: 90 }
{ kind: "always" }
{ kind: "not-applicable" }
{ kind: "unknown" }
```

Showdown `true` 映射为 `always`，不能转换成 100。中文/Excel 的 `—` 只有在说明明确“必定命中”时才能映射 `always`，否则为 `not-applicable` 或 `unknown`。

`basePower` 和 `pp` 同样使用带 `kind` 的语义值，避免 Max/Z 招式占位值与真实数值混淆。G-Max Wildfire 使用本地稳定 ID `move:special:gmax-wildfire`、`officialNumber: null`、`showdownId: gmaxwildfire`。Nihil Light 等 Future mechanics 冲突必须在 build-time 阻止静默覆盖；runtime 只能包含已裁决值或明确 `dataStatus: unresolved`。

第一版不纳入 learnsets。若未来加入，应作为独立关系数据，不在 Move 内保存反向 Pokémon 清单。

## 10. Type

Type 是小型 lookup entity：

- `typeId`：如 `type:fire`；
- `canonicalName.en`；
- `generation`；
- `availability`；
- localization key。

基础克制使用单独的 `TypeChart` 值表，以 `(attackingTypeId, defendingTypeId) -> 0 | 0.5 | 1 | 2` 保存当前目标规则集的 18×18 基础矩阵。不要保存：

- 每个双属性组合结果；
- 每只 Pokémon 的完整弱点表；
- ability、item 或状态造成的条件免疫。

这些结果由 TypeScript 纯函数基于 Form types 和必要规则实时计算。Showdown 是主来源，Excel 基础矩阵是验证来源。

## 11. Nature

| Field | Type | Rule |
| --- | --- | --- |
| `natureId` | string | 如 `nature:adamant`；项目受控稳定 slug |
| `canonicalName.en` | string | Showdown name |
| `plusStat` | StatId/null | 中性性格为 null |
| `minusStat` | StatId/null | 中性性格为 null |
| `neutral` | boolean | 必须与 plus/minus 一致 |

中文名在 localization。中性性格必须满足 `neutral=true` 且 plus/minus 均为 null；非中性必须两者都有且不同。口味映射不是第一版核心字段，可留在本地扩展数据，不污染 Nature mechanics。

## 12. GrowthRate

六个 canonical 实体：

| `growthRateId` | Canonical enum | Formula identity | Lv.100 total |
| --- | --- | --- | ---: |
| `growth:erratic` | `erratic` | `erratic` | 600,000 |
| `growth:fast` | `fast` | `fast` | 800,000 |
| `growth:medium-fast` | `medium-fast` | `mediumFast` | 1,000,000 |
| `growth:medium-slow` | `medium-slow` | `mediumSlow` | 1,059,860 |
| `growth:slow` | `slow` | `slow` | 1,250,000 |
| `growth:fluctuating` | `fluctuating` | `fluctuating` | 1,640,000 |

经验公式由本地 TypeScript 纯函数实现。canonical data 不保存 1–100 完整表；Excel 曲线只作为公式回归测试来源。

推荐 **C：Species 默认 + Form override**：

- 绝大多数数据只在 Species 保存一次；
- `Form.growthRateOverride` 只在可靠证据证明不同或产品必须表达时出现；
- Eevee 使用 Species 默认 `growth:medium-fast`，Partner Eevee 使用 Form override `growth:medium-slow`；
- Raging Bolt 使用 `{ id: null, status: "unresolved" }`，不能猜值。

生成阶段为每个 assignment 保存 `ValueProvenance`。若多个来源冲突，建立 `ConflictRecord`；人工验证后可选择 manual override，并记录 reviewer/rationale。runtime 不携带完整冲突历史，只携带最终 ID 或 unresolved 状态。

## 13. Evolution

EvolutionEdge 是有向关系，不嵌入 Species/Form：

| Field | Type | Rule |
| --- | --- | --- |
| `evolutionId` | string | 项目稳定 ID，不由显示文本生成 |
| `source` | EntityRef | `{kind: species|form, id}`；form-specific 时必须用 Form |
| `target` | EntityRef | 通常指目标 Species 或 default Form |
| `resultAppearanceId` | AppearanceId/null | 进化结果同时决定纯外观时使用 |
| `conditions` | EvolutionCondition[] | AND 条件；多种方法使用多条 Edge |
| `conditionTextKey` | localization key/null | 保留中文/英文 raw fallback |
| `dataStatus` | enum | 未完全结构化时为 partial |

`EvolutionCondition` 是判别联合，至少支持：

- `level`、`item`、`trade`、`held-item`、`move-known`、`friendship`；
- `time`、`gender`、`region`、`location`；
- `spin`（方向与时长）、`party-condition`、`stat-comparison`；
- `other-structured`（命名 key + 受控参数）；
- `raw`（locale、原文、source reference）。

可结构化部分和 raw text 可以同时存在。`raw` 不是失败，而是无损保存尚未建模的条件。Showdown 负责 graph identity 和基础条件；中文仓库负责 zh-CN 原文；Excel做 legacy 验证。

### 13.1 Eevee

建立 8 条独立 edge，而不是在 Eevee 记录中保存一个混合数组。由于 Partner Eevee 不应自动继承普通 Eevee 的可进化性，边的 source 使用 `form:0133:base`，目标指向各目标 default Form。水/雷/火之石、友好度+时间、招式条件均进入 `conditions[]`；中文版本差异保留 raw text。

### 13.2 Milcery → Alcremie

机械目标始终是 `form:0869:base`，但结果 Appearance 取决于 sweet、时间、旋转方向和时长。最简单且通用的表达是为可验证的结果建立多条 edge：共享 source/target，分别设置 `resultAppearanceId` 和结构化条件。这样 63 个组合不需要创造 63 个 battle Form，也不需要 Alcremie 专用 schema。尚不能结构化的文字继续使用 `raw` 条件。

Mega、G-Max、Tera 和 `changesFrom` 是形态变化，不是 EvolutionEdge。

## 14. Dex / DexEntry

### 14.1 Dex

| Field | Type | Rule |
| --- | --- | --- |
| `dexId` | string | 语义稳定，例如 `dex:sv:kitakami`；不能只来自文件名 |
| `regionId` | controlled string/null | 如 `region:paldea` |
| `gameIds` | string[] | 明确游戏或系列 scope |
| `versionIds` | string[] | 必要时区分版本 |
| `subdex` | string/null | DLC、岛屿、区域分区 |
| `scope` | short controlled description | 说明收录口径 |
| `dataStatus` | enum | scope 未确认时 unresolved |

Dex 的 localized name 在 localization 文件；来源在 build-time SourceReference。`dexId` 只有在 scope 被确认后才能进入 canonical runtime。来源文件名只是候选线索。

### 14.2 DexEntry

| Field | Type | Rule |
| --- | --- | --- |
| `dexId` | DexId | 必须引用已定义 Dex |
| `regionalNumber` | string | 保留 `001`、字母或特殊格式；另生成 sort key |
| `speciesId` | SpeciesId | 由 national ID 映射 |
| `formId` | FormId/null | 来源明确指定形态时使用 |
| `sourceName` | string | 保留上游原显示名用于审计/差异检查 |
| `sourceReferenceId` | string/build-only | runtime 可剥离 |

同一 `dexId + regionalNumber` 可以因明确的 form variant 出现多行，但必须有相同 Species 或具名 scope 规则；否则生成冲突。建议 build-time 为 DexEntry 分配内部 row identity，runtime 使用上述复合关系即可。

Kanto 153 不能硬改为 151；必须先确认其具体游戏/scope，再创建相应 Dex。Hisui 708 行不能直接变成 708-entry Dex：主体 242 编号、重复 form 行和后续被扁平化的子表必须先恢复 scope。未恢复的候选停留在 build-time unresolved 数据，不进入正式 `dex-entries.json`。

## 15. Localization

### 15.1 方案比较

| Concern | A. 每个实体内嵌 | B. 独立 locale 文件 |
| --- | --- | --- |
| 当前实现简单度 | 略简单 | 需要一次按 ID 合并 |
| 多语言 | 每加语言重写所有实体 | 新增 locale 文件即可 |
| diff | mechanics 与文字混在一起 | 上游 mechanics/localization diff 清晰 |
| bundle | 即使不用某语言也携带 | 可按 locale/领域加载 |
| 上游同步 | 中文变化造成核心数据 churn | 两条同步管线可独立验证 |
| 长文本延迟加载 | 困难 | 自然支持 |

推荐 **B 为主的轻量混合方案**：

- 核心实体内嵌 `canonicalName.en`，因为它是 identity 验证和开发诊断的重要字段；
- zh-CN 名称、简述和描述放在独立 locale 文件，以项目稳定 ID 为键；
- 第一版 UI 固定简体中文，但加载器仍以 `zh-CN` locale 处理，未来不会锁死；
- 长百科文本与常用短名称分文件，避免首屏加载大量说明。

Localization 记录最小字段为 `name`、可选 `shortDescription`、`description`、`aliases`。同一个中文名可以对应多个 entity ID，例如四个 Embody Aspect；localization key 永远是实体 ID，不是中文字符串。

## 16. Classification

不把 Starter、Legendary、Mythical、Pseudo-Legendary、Fossil、Paradox、Ultra Beast 等设计成 Species 上的一组 boolean。

使用：

- `TagDefinition { tagId, canonicalName.en, appliesTo, descriptionKey }`；
- `TagAssignment { entityId, tagId }`，runtime 可压缩为实体内 `tagIds`；
- build-time assignment provenance 保存 source、rationale 和映射方法。

示例 ID：`tag:starter`、`tag:mythical`、`tag:pseudo-legendary`、`tag:paradox`。这些是项目分类，不自动等于 Showdown battle tags。Showdown/Excel 可以作为证据，但本地 curated policy 决定最终 assignment。

## 17. IDs and External Identifiers

### 17.1 稳定 ID 规则

| Entity | Recommended ID | Example |
| --- | --- | --- |
| Species | 类型前缀 + 四位 National Dex | `species:0006` |
| Form | Species number + 项目受控稳定 token | `form:0006:mega-x` |
| Appearance | Species number + 一个或多个外观维度 token | `appearance:0869:vanilla-cream:strawberry-sweet` |
| Ability | 四位 official number | `ability:0301` |
| Move | 四位 official number；无编号用 curated special token | `move:0904`, `move:special:gmax-wildfire` |
| Type | 项目受控英文 token | `type:fire` |
| Nature | 项目受控英文 token | `nature:adamant` |
| GrowthRate | 固定 canonical token | `growth:medium-fast` |
| Dex | 已验证 game/scope token | `dex:sv:kitakami` |
| EvolutionEdge | source/target + 稳定 method token | `evolution:0133:0134:water-stone` |
| Item | official/project stable token | `item:water-stone` |

所有 token 都由项目维护；显示名称更新不自动重命名 ID。若项目确实需要调整 token，必须提供 migration alias 并验证所有引用。

### 17.2 为什么不直接使用 `showdown:<id>`

直接使用 Showdown ID 简单，但上游英文重命名、`toID` 变化或 form 重新建模会让所有引用产生级联 diff。推荐**项目稳定 ID + `showdownId` external field**：

- 项目引用在上游 rename 时保持不变；
- 同步器只更新 external mapping；
- 没有 Showdown ID 的 Appearance 仍可自然存在；
- 项目可以拒绝 CAP 等上游实体而不污染 namespace。

### 17.3 ExternalIdentifier 是否做统一实体

不建议在 runtime 建立通用 `ExternalIdentifier` 实体或为每个字段包一层 namespace 数组，这会增加体积和使用复杂度。

采用混合方案：

- `nationalDexNumber`、Ability/Move `officialNumber` 是领域固有字段，直接保存；
- `showdownId` 是最常用的 canonical upstream locator，直接放在相关实体；
- `pokemon-dataset-zh` 文件名、Excel sheet/row、旧别名等只进入 build-time ExternalIdentifier/SourceReference 索引；
- build-time 统一记录形态为 `{ namespace, value, entityId }`，便于反向查找和 rename diff。

## 18. Provenance

Provenance 是生成系统的审计数据，不是每个 runtime 字段的包装层。

### 18.1 SourceReference

每个固定输入定义一次：

- `sourceReferenceId`；
- `source`: `pokemon-showdown`, `pokemon-dataset-zh`, `excel`, `local-curated`；
- `version`: 完整 commit SHA、文件 SHA-256 或 curated revision；
- `path`；
- `locator`: JSON Pointer、对象 key、Excel sheet/cell/row；
- `retrievedAt`（仅审计，不参与可复现 identity）。

### 18.2 ValueProvenance

每个被选择或拒绝的候选值记录：

- `entityId`、`fieldPath`；
- `sourceReferenceId`；
- `mappingClass`: `automatic`, `rule-based`, `manual-exception`, `unresolved`；
- `ruleId` 或 exception ID；
- 原始值或稳定 hash；
- 是否成为 selected canonical value。

长文本可只保存 hash + source locator，避免 provenance 本身复制大量内容。

### 18.3 三层输出

1. **canonical runtime data**：精简实体、关系和必要 unresolved 状态；
2. **build-time provenance records**：字段级来源与映射方法；
3. **build reports**：conflicts、unresolved、统计和验证结果。

runtime 只保留轻量 `manifest.json`，记录 schema version、data version、生成时间、上游 SHA 摘要和 notice 引用，不包含字段级 provenance。

## 19. Conflict Handling

### 19.1 MappingException

用于稳定、可复用的非通用映射，例如 Arceus 属性 image candidate 到 Form、Embody Aspect 后缀、G-Max Wildfire 无编号：

- `exceptionId`；
- `entityType`、upstream key、target entity ID；
- `reason`、`status`、`sourceReferences`；
- `reviewedBy`、`reviewedAt`；
- 可选 `expiresAfterUpstreamChange`，要求上游变更后复审。

### 19.2 ConflictRecord

字段：`conflictId`、`entityId`、`fieldPath`、候选值及各自 source、severity、resolution status、selected value、rationale、review metadata。

resolution status：

- `unresolved`：阻止相关 runtime 值生成或输出明确 unknown；
- `source-priority`：按已定义优先级选择，但仍保留冲突；
- `manual-override`：人工裁决并记录理由；
- `upstream-fixed`：新快照已解决，保留历史记录。

identity 匹配成功绝不自动消除 mechanics 冲突。Nihil Light 即使编号和英文名一致，power/PP 冲突仍必须单独存在。严重 identity/reference 冲突应使构建失败；允许 unknown 的字段可生成 `dataStatus: unresolved`，但报告必须非空且可见。

## 20. Source Priority Matrix

下表为**没有显式 local override 时**的默认顺序。任何 local override 都必须附 provenance 和 rationale，并位于选择链最前。

| Field/domain | Default canonical source | Validators/fallback | Conflict rule |
| --- | --- | --- | --- |
| Species identity | Showdown `baseSpecies + num` | 中文编号/英文名、Excel编号 | 正数编号或英文归组冲突即失败 |
| Form identity | Showdown form ID/relations | 中文 forms/stats、Excel全形态/Mega | 非唯一匹配进入 exception/unresolved |
| English name | Showdown | 中文仓库英文名 | rename 生成 mapping review |
| Chinese name | `pokemon-dataset-zh` | Excel、本地 curated | 不以中文名合并实体 |
| types | Showdown Form | 中文、Excel | 差异生成 conflict，不静默覆盖 |
| baseStats | Showdown Form | 中文 stats、Excel | 差异生成 conflict |
| ability slots | Showdown Form | 中文 forms、Excel | 槽语义必须保留，不能只比较集合 |
| Ability mechanics | Showdown | 无；其他源只验证文本事实 | 不迁移 callback，冲突需裁决 |
| Ability zh-CN | 中文总表/详情 | Excel | 301–304 按 official number 分开 |
| Move mechanics | Showdown | 中文/Excel只验证 | `true`、Max/Z、Future 冲突显式处理 |
| Move zh-CN | 中文总表/详情 | Excel | 缺详情不等于实体缺失 |
| Type chart | Showdown | Excel 18×18 | 方向和标准属性集合必须验证 |
| Nature modifiers | Showdown | Excel | 25 条和 neutral 规则必须验证 |
| growthRate | 中文 Pokémon base form | Excel曲线、本地人工验证 | 未知/跨 form 差异进入 conflict；允许 Form override |
| evolution graph | Showdown | 中文链、Excel | 边 identity 冲突即失败 |
| evolution zh-CN text | 中文 evolution text | Excel、本地 curated | 无法结构化时保留 raw |
| Regional Dex | 中文文件（候选） | Excel、本地 scope 定义 | scope 未确认不得生成 canonical Dex |
| project classification | Local curated | Showdown tags、Excel作为证据 | 必须保存 rationale/source |
| encyclopedia text | 中文仓库（候选） | Excel/本地 | 许可证与 provenance 未确认前不批量发布 |
| availability | Showdown status + local scope policy | 其他来源验证 | Past/Future/Unobtainable 不直接删除 |

## 21. Runtime JSON Layout

建议的逻辑布局如下；实际是否合并小文件可在实现阶段根据构建体积测量决定：

```text
public/data/
  manifest.json
  core/
    species.json
    forms.json
    appearances.json
    abilities.json
    types.json
    natures.json
    growth-rates.json
    items.min.json
    tags.json
  moves/
    index.json
    mechanics.json
  relations/
    evolutions.json
    dexes.json
    dex-entries.json
  localization/
    zh-CN.core.json
    zh-CN.abilities.json
    zh-CN.moves.json
    zh-CN.encyclopedia.<chunk>.json
```

加载策略：

- 首屏/基础搜索加载 Species、Form、必要 tags、Type 及 `zh-CN.core`；
- Ability 页面需要时加载 Ability localization；
- Moves 整体不进入首屏，`index` 可只含 ID、名称索引所需键，mechanics/说明按功能加载；
- 长百科文本按 generation 或 National Dex 范围分块延迟加载；
- evolutions 和 dex entries 仅在对应功能页加载；
- 第一版不输出 learnsets；
- 全量 provenance、mapping exceptions 和 conflicts 放在开发期输出目录，不复制到 `public/data`。

如果测量后多个小文件的请求开销高于收益，可以在不改变逻辑 schema 的前提下合并 `core` 文件。数据模型不依赖物理文件一一对应实体。

## 22. Complex Case Walkthroughs

### 22.1 Charizard

- `species:0006` → `defaultFormId: form:0006:base`。
- `form:0006:base`、`form:0006:mega-x`、`form:0006:mega-y`、`form:0006:gmax` 是四个 Form。
- Mega forms 各保存 required item；G-Max 使用 `formKind: gmax`、`changesFromFormIds: [base]`。
- G-Max 沿用 base stats 不影响其作为 Form；不要求每个 Form 有独立上游 stats row。

### 22.2 Rotom

- 一个 Species，base + heat/wash/frost/fan/mow 六个 Form。
- appliances 共享 stats 但 types 不同；每个有独立项目 ID和 Showdown ID。
- `changesFromFormIds` 表达形态转换，绝不生成 evolution edges。

### 22.3 Arceus

- base 与 17 个 type forms 都是 Form，因为 type/required items 有 mechanics 意义。
- 中文仓库仅 `home_images` 出现的候选通过 MappingException 绑定，图片名不成为 identity。
- plate/Z-item requirement 进入 `requiredItemIds`；不为每张图片建立 Appearance。

### 22.4 Zygarde

- `form:0718:base` 的显示 label 可为 50%；另有 `10-percent` 与 `complete`。
- Complete 为 `formKind: battle`，traits 包含 `battle-only`, `ability-dependent`，required ability 指向 Power Construct，并列出可变化来源。
- growthRate 仍从 Species 默认继承，不在三个 Form 重复。

### 22.5 Ogerpon

- 四个 mask 是 Form；各自 types、ability、required item/Tera type 不同。
- 四个 Tera 版本也是 battle Form，`battleOnly=true`，`changesFromFormIds` 指向对应 mask。
- `formKind + traits + required*` 能表达重叠语义，不需要 Ogerpon 专用字段。

### 22.6 Meowstic

- male/default 与 female 是两个 Form，因为 hidden ability 不同，即使 stats 相同。
- gender 固定值放在 Form；不能降级成 Appearance。
- 纯贴图性别差异的其他 Species 才使用 Appearance。

### 22.7 Unown

- 一个 mechanics base Form；A–Z、Exclamation、Question 是 Appearance。
- 每个 Appearance 使用 glyph aspect，必要时保存 Showdown cosmetic locator 的 build-time mapping。
- 搜索可以返回 appearance，但 battle calculations 始终解析到 base Form。

### 22.8 Alcremie

- base 与 G-Max 是两个 battle Form。
- 9 cream × 7 sweet 为 63 个 Appearance，均关联 base Form；G-Max 外观由 G-Max Form 自身表示。
- cream/sweet 是两个通用 Appearance aspects；不创建 63 个 Form，也不强行给每个组合添加 Showdown ID。

### 22.9 Eevee

- `species:0133` 默认成长率为 medium-fast；Partner Eevee 是独立 Form，可靠原始证据允许 medium-slow override。
- 八条 evolution edge 从可进化的 base Form 出发，避免 Partner Eevee错误继承。
- 不同 item/time/friendship/move 条件各自结构化并保留中文 raw text。

### 22.10 Milcery → Alcremie

- source/target 是 Form，63 个结果可通过多条 edge 的 `resultAppearanceId` 区分。
- held sweet、time、direction、duration 使用通用 conditions；无法确认的细节使用 raw fallback。
- 复杂性留在关系数据，不污染 Form 或 Appearance schema。

### 22.11 Raging Bolt

- Species/Form 正常存在；Species `growthRate.id=null`、`status=unresolved`。
- build report 保留中文“未知”、Showdown缺字段和 Excel无映射值三项证据。
- UI 可显示“成长类型待确认”，转换器不得默认 slow 或其他值。

### 22.12 Hisui Dex

- 708 raw rows 先作为 build-time candidate collection；不创建 708-entry canonical Dex。
- 已识别主体、form 重复和后续分段，但在恢复每段 heading/scope 前保持 unresolved。
- 确认 scope 后分别建立 Dex，并用 optional `formId` 表达同一地区编号下的形态行。

这些案例都可由通用实体、trait、requirement、condition 和 provenance 表达；只有源映射需要少量 exception，没有出现为单一 Pokémon 增加专属 schema 字段的情况。

## 23. Validation Rules

生成器至少必须验证：

1. 所有 runtime ID 全局符合各自格式，且实体类型内唯一。
2. 主 namespace Species 的 `nationalDexNumber` 为正数且唯一；CAP/Custom 不得混入。
3. 每个 Species 至少一个 Form，恰好一个 `formKind: base`，`defaultFormId` 指向本 Species。
4. Form 的 types 为 1–2 个有效 Type；六项 stats 完整且为允许范围整数。
5. Ability slot 在单 Form 内唯一，所有 Ability/Move/Item/Form 引用存在。
6. `battleOnly`、`changesFrom`、required fields 不被转换成 EvolutionEdge。
7. Appearance 不含 battle mechanics；aspects 组合在同一 Species/Form 下唯一。
8. Ability/Move official number 不重复；允许 null 的 Move 必须有 curated stable ID 和映射证据。
9. accuracy/NumericSemantic 不使用含义不明的裸 null 或 `—`。
10. GrowthRate 六个 Lv.100 总值与本地公式一致；Form override 必须有 provenance；unresolved 不得被默认补值。
11. Evolution 引用存在、conditions 可解析；任何未解析文本必须以 raw condition 保留。
12. Dex scope 为 resolved 才可进入 runtime；regional number 重复必须由明确 form/scope 规则解释。
13. 必需的 zh-CN name localization 完整；重复显示名不构成 identity 冲突。
14. TagAssignment 引用有效 TagDefinition，并带 build-time rationale/source。
15. 每个 canonical field 有 selected provenance；同字段多候选不一致时必须生成 ConflictRecord。
16. 高严重度 conflict、orphan reference、未知 mapping 或静默丢弃都会使生成失败。
17. runtime 输出不得包含 callback 代码、上游图片路径、反向重复索引、完整 provenance 或未批准的百科长文本。
18. 每次上游升级都回归 Charizard、Rotom、Arceus、Zygarde、Ogerpon、Meowstic、Unown、Alcremie、Eevee、Milcery、Raging Bolt 和 Hisui。

## 24. Open Questions

- Raging Bolt 的可靠成长率来源仍未解决。
- Hisui 708 raw rows 后续各分段的准确 heading/scope 尚未恢复。
- Nihil Light 的 Future mechanics 冲突应采用哪个已验证版本尚未裁决。
- Alcremie 63 个 Appearance 的最终中文命名、排序和产品是否全量展示仍需确认。
- Past/Future/Unobtainable 的第一版目标 generation/game context 尚需产品决定；模型已能表达。
- 是否在最终应用分发 `pokemon-dataset-zh`/52Poké 的百科长文本，需要单独完成许可和来源策略。
- 图片来源、授权、压缩和离线包体策略不属于本数据模型，仍未决定。
- Item 第一版是否只收录被 Form/Evolution 引用的最小集合，建议在转换器计划中确认。
- 是否需要保留旧世代 Ability/Move mechanics；第一版建议只输出当前目标规则集，旧世代留待扩展。

## 25. Recommended Implementation Sequence

下一阶段适合进入**正式转换器设计**，但仍不应立即全量生成。推荐顺序：

1. 把本文字段收敛为 TypeScript schema/type 设计与 JSON Schema 验证计划；先不接上游。
2. 定义 stable ID registry、source manifest、MappingException 和 ConflictRecord 的文件格式。
3. 先实现最小 Showdown normalization：Type、Nature、Ability、Move identity、Species/Form。
4. 加入中文 Species/Ability/Move localization mapping，并输出 conflict report。
5. 加入 GrowthRate 与 Form override 验证，保留 Raging Bolt unresolved。
6. 加入 Appearance，先覆盖 Unown 与 Alcremie proof 样本。
7. 加入 EvolutionEdge/Condition，先回归 Eevee 与 Milcery→Alcremie。
8. 最后处理 scope 已确认的 Dex；Hisui 保持阻断项，不能因全量生成而绕过。
9. 用 12 个复杂案例和 Excel 独立样本运行验证后，再决定首次正式 runtime JSON 生成。

实施过程中应保持生成器、local curated inputs、build reports 和 runtime JSON 四个目录边界清晰。任何为了“先生成出来”而放宽 unresolved/conflict 规则的做法都违背本设计。
