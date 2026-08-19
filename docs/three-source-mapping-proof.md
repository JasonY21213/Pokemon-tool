# Three-Source Mapping Proof

## 1. Validation Setup

本文件是一次可丢弃的映射验证，不是最终数据模型、正式数据集或同步器。验证采用三类只读输入：Pokémon Showdown、`pokemon-dataset-zh` 和本地 Excel 副本。

- Pokémon Showdown 仅稀疏读取 `data/pokedex.ts`、`data/abilities.ts`、`data/moves.ts`、`data/formats-data.ts`、`data/FORMES.md` 和 `sim/dex-*.ts`。
- `pokemon-dataset-zh` 通过固定提交对象读取少量 `data/pokemon/*.json`、`data/ability_list.json`、`data/abilities/*.json`、`data/move_list.json`、`data/moves/*.json`、`data/pokedex/*.json` 以及 `scripts/pokedex_crawler.js`；没有把图片检出到项目，也没有把上游仓库放入项目。
- Excel 使用 `openpyxl 3.1.5` 以 `read_only=True` 打开，只读取工作表值；没有保存工作簿。
- 分类含义：`automatic` 表示可由确定性连接键和验证字段唯一映射；`rule-based` 表示需要可复用的明确转换规则；`manual-exception` 表示需要具名例外；`unresolved` 表示现有证据不足，不能安全决定。
- 所有百分比只描述本次 proof 样本，不代表未经运行全量验证的全库成功率。

Excel 检查基线与结束目标均为：大小 `3,206,646` bytes、UTC 修改时间 `2026-08-18 17:12:06.6075694`、SHA-256 `AA25849772C7D6CCBF56C24943CF97DBE9C34FAE3211826B39A82658DDCB49E5`。

## 2. Fixed Upstream Versions

| Source | Fixed version | Proof source paths |
| --- | --- | --- |
| Pokémon Showdown | `84d7ceb4f009928221fce7a00e711bab263c5f4e` | `data/pokedex.ts`, `data/abilities.ts`, `data/moves.ts`, `data/formats-data.ts`, `data/FORMES.md`, `sim/dex-species.ts`, `sim/dex-abilities.ts`, `sim/dex-moves.ts` |
| `42arch/pokemon-dataset-zh` | `82ce04e611d19a12556c3955125b048b36187f52` | `data/pokemon/*.json`, `data/ability_list.json`, `data/abilities/*.json`, `data/move_list.json`, `data/moves/*.json`, `data/pokedex/*.json`, `scripts/pokedex_crawler.js` |
| Excel | 上述 SHA-256 | `全国图鉴`, `全形态图鉴`, `Mega进化`, `特性列表`, `招式列表`, 各地区图鉴表, `等级` |

所有上游观察均来自固定 SHA；没有使用 floating `master`/`main`。

## 3. Species Mapping

候选连接策略为：`nationalDexNumber` 主连接，`English species name` 做一致性验证，再取得 Showdown canonical ID。中文名只作为 localization/验证字段，不参与 identity。

| Proof population | Count | Classification | Result |
| --- | ---: | --- | --- |
| Bulbasaur, Charizard, Rotom, Arceus, Unown, Zygarde, Alcremie, Ogerpon, Terapagos, Raging Bolt, Pecharunt, Meowstic, Eevee | 13 | automatic | 三源全国编号一致；Showdown ID 可稳定取得 |
| Eevee 的 8 个进化目标：Vaporeon, Jolteon, Flareon, Espeon, Umbreon, Leafeon, Glaceon, Sylveon | 8 | automatic | 编号与英文名均唯一一致 |
| Kadabra, Alakazam, Milcery | 3 | automatic | 用于交换/复杂进化 proof，三源唯一一致 |
| Syclant (`num: -2`, CAP) | 1 | unresolved | 仅 Showdown 有；中文仓库与 Excel 没有全国图鉴实体 |

结果：25 个 Species 中 24 个自动唯一映射，样本成功率 **96.0%**。只统计正式全国编号实体时为 **24/24（100%）**。Syclant 证明导入前必须先按 `num > 0` 与 `isNonstandard` 策略过滤，而不能把负编号塞入全国图鉴。

该策略在正式 Pokémon 样本中可靠，但 `nationalDexNumber` 不能单独表示 form；同一编号下的 form 必须另行处理。

## 4. Form Mapping

本次固定测试 42 个 form 候选。Showdown ID 适合作为 Showdown 覆盖范围内的 canonical upstream form identifier，但不是所有外观组合的通用身份键。

| Classification | Count | Tested forms | Reason |
| --- | ---: | --- | --- |
| automatic | 30 | 13 个正式 Species 的 base form；Charizard Mega X/Y；Rotom 5 家电形态；Zygarde 10%/Complete/Mega；Alcremie Gmax；Ogerpon 3 个非基础面具；Terapagos Terastal/Stellar；Meowstic-F | 全国编号确定 Species 后，类型、六项种族值、特性或结构化形态字段可唯一确认 Showdown ID |
| rule-based | 5 | Charizard-Gmax；Unown-B/Exclamation/Question；Ogerpon-Wellspring-Tera | Gmax 需要 `changesFrom`/超极巨规则；Unown 需要 cosmetic 后缀规则；Ogerpon Tera 需要 `parent mask + tera` 规则 |
| manual-exception | 3 | Arceus-Bug/Fire/Water | 中文仓库 `forms` 只有 base，属性形态只在 `home_images` 出现；可人工绑定 Showdown type form，但不能把图片清单当结构化实体来源 |
| unresolved | 4 | 3 个抽样 Alcremie cream×sweet 外观组合；Syclant | Showdown 仅表达 9 个 cream 外观，不表达中文仓库/Excel 的 63 个 cream×sweet 组合；CAP 无另外两源 |

具体观察：

- Charizard 的 base、Mega X/Y、Gmax 在中文 `forms` 中都有；Gmax 没有独立 `stats`，Showdown 也沿用 base stats，因此不能要求每个 form 都有独立 stats 记录。
- Rotom 五种家电形态可由第二属性唯一分开；中文 `stats` 对五者共享一组数值标签，因此应允许多个 form 引用相同 stats。
- Arceus 在 Showdown 有 17 个属性 form；中文 `forms` 只有 base，但 `home_images` 有 18 种图像。`home_images` 是覆盖线索，不是可靠 identity 表。
- Unown 的字母和符号是 Showdown `cosmeticFormes`；不应与改变对战数据的 form 混为一类。
- Zygarde Complete 是 `battleOnly` 且依赖 `Power Construct`；固定版本还包含 Zygarde-Mega，中文仓库和 Excel 也存在对应结构/记录。
- Alcremie 揭示一对多语义：Showdown 的 cosmetic ID 表示 cream，中文仓库和 Excel 还组合 sweet。不能把 63 个组合强行折叠成 9 个 Showdown ID。
- Ogerpon 中文 `forms` 有四个面具，但没有单列四个 Tera form；Showdown 明确区分并提供 `battleOnly`、`requiredItem`、`requiredTeraType`。
- Terapagos 三个形态在三源的类型、种族值和特性上均可对应。
- Meowstic 的雌雄形态种族值相同，但隐藏特性不同；仅比较 stats 会误合并，必须把能力槽纳入验证。

结论：form 中文名适合作为 localization，不适合作为 identity。Cosmetic 应与对战 form 分层表示，但最终结构留待 `data-model.md` 决定。

## 5. Ability Mapping

测试 15 个官方编号行，覆盖普通、隐藏、新世代以及详情文件。中文总表 311 行对应 307 个唯一中文名；307 个唯一中文名都有详情文件。差额不是“4 个缺失详情”，而是编号 301–304 共用中文名和基础英文名 `Embody Aspect`。

| Classification | Count | Samples | Result |
| --- | ---: | --- | --- |
| automatic | 11 | Levitate #26, Chlorophyll #34, Overgrow #65, Blaze #66, Drought #70, Solar Power #94, Multitype #121, Tough Claws #181, Power Construct #211, Tera Shift #307, Poison Puppeteer #310 | `official number + normalized English name` 与 Excel 均一致 |
| rule-based | 4 | Embody Aspect #301–304 | 官方编号唯一，但中文/Excel 英文名都省略 Showdown 的 `(Teal/Wellspring/Hearthflame/Cornerstone)` 后缀；必须按编号绑定，并保留四条不同说明 |
| manual-exception | 0 | — | — |
| unresolved | 0 | — | — |

因此 identity 为 15/15 可确定，其中 11 automatic、4 rule-based。不能按中文名或详情文件名去重 `Embody Aspect`，也不能用一个详情对象覆盖四个编号的说明。

## 6. Move Mapping

测试 12 个招式：Pound #1、Swords Dance #14、Swift #129、Tri Attack #161、Triple Kick #167、10,000,000 Volt Thunderbolt #719、Max Flare #757、G-Max Wildfire、Ivy Cudgel #904、Tera Starstorm #906、Malignant Chain #919、Nihil Light #920。

| Classification | Count | Result |
| --- | ---: | --- |
| automatic | 11 | 有官方编号的 11 项均能由编号和英文名映射 Showdown 与中文总表；Excel 覆盖其中 10 项，缺少 Nihil Light |
| rule-based | 1 | G-Max Wildfire 在中文仓库和 Excel 的编号为 `—`，Showdown 使用内部 `num: 1000`；需按标准化英文名和特殊招式类别绑定 |
| manual-exception | 0 | — |
| unresolved | 0 | identity 无未决项；字段值冲突仍需单独处理 |

字段合并不能跟 identity 一样自动：

- Showdown `accuracy: true` 对应中文/Excel 的 `—`（必定命中），需要明确的语义转换，不能按字符串比较。
- Max/Z 招式在 Showdown 中可能使用模拟器占位威力/PP，中文表用 `—`；这些字段不能无条件覆盖。
- Nihil Light 在固定 Showdown 中为 power 100、PP 10、`isNonstandard: Future`，中文总表为 power 200、PP `—`，Excel缺失。identity 可自动映射，但 mechanics 明显冲突，必须报告并等待上游版本/来源策略决定。
- 中文 `data/moves/` 仅有 349 个详情文件，而 `move_list.json` 有 953 行；详情缺失不能解释为招式不存在。

## 7. Growth Rate Mapping

成长值位于中文 Pokémon 文件的 `forms[].experience_100`，不是顶层 `growth_rate`。本次从固定提交抽取每类前 4 个，共 24 个正式 Species，再加 Raging Bolt，共 25 个样本。

| Raw group | Exact level-100 value | Four proof Species | Classification |
| --- | ---: | --- | --- |
| 较慢 | 1,059,860 | Bulbasaur, Ivysaur, Venusaur, Charmander | automatic |
| 较快 | 1,000,000 | Caterpie, Metapod, Butterfree, Weedle | automatic |
| 快 | 800,000 | Clefairy, Clefable, Jigglypuff, Wigglytuff | automatic |
| 慢 | 1,250,000 | Growlithe, Arcanine, Tentacool, Tentacruel | automatic |
| 最慢 | 1,640,000 | Shroomish, Breloom, Makuhita, Hariyama | automatic |
| 最快 | 600,000 | Nincada, Ninjask, Shedinja, Volbeat | automatic |
| 未知 | — | Raging Bolt #1021 | unresolved |

结果为 24 automatic、0 rule-based、0 manual、1 unresolved。六类均有样本覆盖。Excel 的 `等级` 表提供六条曲线，但没有可靠的 Species→曲线关联；Raging Bolt 在 Excel 的全国、全形态、猜宝可梦、帕底亚和蓝莓记录中也没有成长类型字段，因此不能用 Excel 补值。

重要反例：Eevee 文件的 base form 为 `1,000,000（较快）`，Partner Eevee form 为 `1,059,860（较慢）`。所以“同一 Species 所有 form 成长类型必然一致”在源数据层不成立。后续若建立 Species 级字段，应明确选择 base-form 来源并把不同 form 值作为异常验证，而不是静默取第一项或多数值。

## 8. Regional Dex Mapping

| File | Rows | Unique regional IDs | Classification | Finding |
| --- | ---: | ---: | --- | --- |
| `关都.json` | 153 | 153 | rule-based | #001–151 后接 Meltan #152、Melmetal #153；需要把 scope 明确命名为该文件代表的 153-entry 版本，不能假定“关都=最初151” |
| `神奥.json` | 210 | 210 | automatic | 可直接生成 DexEntry |
| `伽勒尔.json` | 400 | 400 | automatic | 可直接生成 DexEntry |
| `洗翠.json` | 708 | 242 | unresolved | 不是 708 个独立图鉴编号；见下文 |
| `帕底亚.json` | 400 | 400 | automatic | 可直接生成 DexEntry |
| `帕底亚-北上.json` | 200 | 200 | automatic | 可直接生成独立 Dex |
| `帕底亚-蓝莓.json` | 243 | 243 | automatic | 可直接生成独立 Dex |
| `丰缘.json` | 211 | 211 | automatic | Excel 没有对应工作表，但中文文件可独立映射 |

八个文件结果：6 automatic、1 rule-based、0 manual、1 unresolved。

`洗翠.json` 的 708 行可分为：前 245 行（242 个地区编号，Vulpix/Ninetales/Sneasel 的 form 造成 3 个附加行）、随后 85、75、96、90、91 行的五段重新从 #001 开始的列表，以及最后 26 行的另一子集。抓取器 `scrapeRegion` 会遍历页面匹配到的所有表并直接 `push` 到同一个数组，却不保存表标题或 scope。因此只能安全恢复前段的主体图鉴与 form 重复；后 463 行无法仅凭 JSON 确定各段 Dex 名称，不能直接生成一个 708-entry Dex。需要补抓页面 heading/provenance 或人工定义 scope 后再转换。

地区文件中的 `name` 有时含 form 后缀，因此 `national_id` 先连 Species，`name + types` 只能帮助选择 optional `formId`，不能替代 Showdown form identity。

## 9. Evolution Mapping

测试 10 条边：Eevee 的 8 个分支、Kadabra→Alakazam、Milcery→Alcremie。

| Concern | Preferred source | Proof result |
| --- | --- | --- |
| Graph identity (`prevo`/`evos`) | Showdown | 10/10 边可自动确定；Eevee 多分支无歧义 |
| Structured condition | Showdown | Eevee 八条包含 `useItem`, `levelFriendship`, `levelExtra` 及 item/time/move 条件；可作为基础结构 |
| Chinese condition text | `pokemon-dataset-zh` | 保存版本差异和中文说明，例如 Leafeon/Glaceon 的地点或第八世代起道具方案、Sylveon 的友好度文字 |
| Legacy validation | Excel | Eevee 道具、白天/夜晚、交换等可交叉检查，但文字较短且不是规范结构 |

条件分类：Eevee 8 条 automatic；Kadabra→Alakazam 为 rule-based，因为 Showdown 表达 `trade`，中文还含《传说 阿尔宙斯》的“联系绳”替代，Excel仅写连接交换；Milcery→Alcremie 为 manual-exception，因为 Showdown 只有 `evoType: other` 与 “spin while holding a Sweet”，中文/Excel含旋转、时间、方向、时长、糖饰及 63 个结果组合，不能安全压成一个通用字段。无 graph identity unresolved。

原始中文 condition text 必须保留 provenance；结构化字段和展示文字不能相互覆盖。

## 10. Automatic Mapping Rules

可推广的规则：

1. Species：要求 `Showdown.num == int(pokedex_id) == Excel 全国编号`，再验证标准化英文名；中文名仅作 localization。
2. Form：先确定 Species，再比较 Showdown form 的类型、六项 stats、能力槽和结构关系；只有候选唯一时才 automatic。
3. Ability/Move：官方编号为主键，标准化英文名为一致性断言；编号或名称缺失时不得静默降级到中文名。
4. `accuracy: true` 与中文 `— + 必定命中语义` 使用显式转换规则。
5. Growth：读取 base `forms[0].experience_100` 的原始值与括号标签，同时验证同文件其他 form；冲突进入异常清单。
6. Regional Dex：`national_id` 先连 Species；只有文件内 regional ID 唯一且 scope 明确时才批量生成 DexEntry。
7. Evolution：Showdown 提供图边和基础结构，中文 raw text 提供 localization/版本细节，Excel只做验证。
8. `num <= 0` 或 `isNonstandard` 的 Showdown 实体先进入非官方过滤流程。

## 11. Manual Exception Cases

- Arceus 属性 form：中文结构化 `forms` 缺失，只能为具名属性图像候选建立到 Showdown form ID 的明确例外；不能从文件顺序猜。
- Milcery→Alcremie：保留完整 raw condition，并等待正式模型决定 cream、sweet、time、direction、duration 的表示。
- 如果未来必须导入 Alcremie 63 个外观组合，它们需要自己的本地 identity 或外观维度，不能冒充 Showdown 的 9 个 cosmetic IDs。

## 12. Unresolved Cases

- Raging Bolt 的成长类型：中文源为“未知”，Showdown无成长字段，Excel无 Species 关联值。
- Hisui 后 463 行的准确 scope 名称：固定 JSON 已丢失表标题；需要重新保留页面结构或外部人工定义。
- Alcremie 个别 cream×sweet 组合与 Showdown cream-only cosmetic 的正式关系。
- CAP/nonstandard 是否完全排除，或未来建立独立命名空间；本阶段只确认不能进入全国图鉴 identity。
- Nihil Light 的 mechanics 冲突应以哪个版本/来源为准；本 proof 不裁决。

## 13. Assumptions Confirmed

- 正式 Species identity 可以主要由 Showdown + 全国编号稳定确定；英文名适合验证，Showdown ID 适合 canonical upstream reference。
- `pokemon-dataset-zh` 在 24 个正式 Species 样本中可靠提供 Species 级简体中文名。
- Showdown form ID 对其覆盖的对战形态适合作为 canonical upstream identifier。
- Ability/Move 的官方编号加英文名是强连接策略，但需要少量显式规则。
- 六种成长类型可主要从中文仓库获取；Excel不适合做 Species 级主来源。
- Excel 可以降级为 legacy/validation source，并在形态、中文、进化自由文本和自定义分类上继续有价值。
- 四类 classification 足以描述本次样本，且 unresolved 必须允许存在。

## 14. Assumptions Rejected

- **“311 个特性总表行而只有 307 个详情文件，说明缺 4 个详情”被推翻。** 301–304 四条 Embody Aspect 共用一个中文名/详情文件名。
- **“官方编号 + 完全相同英文名对所有 Ability/Move 都直接成立”被推翻。** Embody Aspect 在 Showdown 带 form 后缀；G-Max Wildfire 在中文/Excel没有编号。
- **“同一 Species 所有 form 的 Growth Rate 一定一致”被推翻。** Eevee 与 Partner Eevee 的原始值不同。
- **“关都 153 条是明显错误”被推翻。** 额外两条是 Meltan 和 Melmetal，编号连续且唯一。
- **“洗翠 708 条就是 708 个 DexEntry”被推翻。** 实际只有 242 个唯一地区编号，多个页面表被扁平拼接且 scope 丢失。
- **“中文 `forms` 完整覆盖所有 Showdown form”被推翻。** Arceus 属性形态和 Ogerpon Tera 形态缺少独立结构化记录。
- **“Showdown cosmetic 足以代表所有 Alcremie 外观”被推翻。** Showdown 只有 cream 级外观，中文/Excel还区分 sweet 组合。
- **“招式 identity 对齐后 mechanics 也可直接覆盖”被推翻。** `accuracy: true`、Max/Z 占位字段和 Nihil Light 冲突均需要独立策略。

## 15. Data Model Implications

本节只记录 proof 对未来设计的约束，不定义最终 schema：

- Species identity、battle form identity、cosmetic appearance、localization 和 source provenance 必须分开。
- Showdown ID 可作为上游 form reference，但本地模型必须容纳没有 Showdown 1:1 ID 的外观组合。
- 所有合并字段都需要 `source`, `upstream SHA` 和冲突状态；identity 成功不代表各属性值可以自动覆盖。
- Ability/Move 必须保留官方编号；重复中文名不能去重。
- Growth 应是经验证的 Species 级事实，同时保留原始 form 值与异常。
- Regional Dex 必须有明确 scope/version；文件名本身不总能提供足够语义。
- Evolution graph、structured condition 和 localized raw text 应分层保存。
- 自动转换必须产生 exception/unresolved 报告，禁止静默丢弃。

## 16. Recommended Next Step

本 proof 已足以开始正式设计 `docs/data-model.md`，但设计时应先确定四个政策边界：

1. 官方与 CAP/nonstandard 的命名空间/过滤规则；
2. battle form 与 cosmetic appearance 的边界，特别是 Alcremie；
3. Regional Dex 的 scope/version 表示以及 Hisui 的补证方案；
4. 字段冲突优先级与 provenance，特别是 mechanics 和 Growth unknown。

随后再设计小型、规范化、带 provenance 的模型；不要直接把任一上游 JSON 或 Excel 列机械复制成正式数据。
