# pokemon-dataset-zh 数据源系统性只读审计

分析日期：2026-08-19  
上游仓库：[42arch/pokemon-dataset-zh](https://github.com/42arch/pokemon-dataset-zh)  
分析快照：[`82ce04e611d19a12556c3955125b048b36187f52`](https://github.com/42arch/pokemon-dataset-zh/commit/82ce04e611d19a12556c3955125b048b36187f52)（分析开始时 `main` 的最新提交）

本文只评估数据源，不定义最终数据模型，也不实现同步或转换程序。分析通过 GitHub 仓库页面、固定提交下的文本/JSON 文件和 Git tree 元数据完成；没有 clone 仓库，没有下载或解析图片二进制，没有修改 Excel。结论同时参考本项目的 [Excel 审计](./excel-analysis.md) 与 [Pokémon Showdown 数据源分析](./showdown-data-source-analysis.md)。

## 1. Executive Summary

**建议使用 `pokemon-dataset-zh`，但不建议把它作为全部 Pokémon 事实的唯一主要数据源。** 更准确的定位是：

- Pokémon Showdown：英文实体标识、form 关系和对战机械事实的 canonical upstream。
- `pokemon-dataset-zh`：简体中文名称、中文说明、中文图鉴文本、成长类型和地区图鉴的候选上游。
- 本地 custom data：项目分类、稳定映射、来源记录和 Showdown/中文数据都缺失的字段。
- Excel：legacy、迁移证据和交叉验证来源，不再承担主要运行时数据职责。

该仓库的优势很明确：`data/pokemon/` 恰有 1,025 个文件，文件编号连续覆盖 `#0001`～`#1025`；Pokémon、特性和招式总表通常同时保存中文名、英文名与官方编号；24 份全国/地区图鉴覆盖面明显超过现有 Excel；`experience_100` 几乎完整给出六种成长类型。

但它不能直接成为规范化数据库：

- form 没有稳定 ID，`forms`、`stats`、`type_effectiveness`、`home_images` 使用不同粒度和不同名称。
- 1,320 条 form 记录中有 1 条成长类型为“未知”（`#1021 猛雷鼓`）。
- 特性总表有 311 条，但详情文件只有 307 份；招式总表有 953 条，但详情文件只有 349 份。
- 进化条件主要是中文自由文本，结构化程度低于 Showdown。
- 数据抓取自神奇宝贝百科（52Poké）；仓库 MIT 许可证不能被直接理解为抓取文本和 Pokémon 图片都自动获得相同授权。
- 仓库包含大量图片，GitHub 报告的仓库 size 约 1.88 GiB；完整 clone 与本项目的轻量目标不符。

因此推荐“**固定上游提交 → 只取所需 JSON → 显式映射与验证 → 生成项目自有静态 JSON**”，最终 Web App 不包含该仓库、crawler 或图片全集。

## 2. Repository Status

### 2.1 当前状态

| 项目 | 审计结果 |
| --- | --- |
| 默认分支 | `main` |
| 最新提交 | `82ce04e611d19a12556c3955125b048b36187f52` |
| 最新提交时间 | 2026-03-17 |
| 最新提交说明 | `修复home_images获取` |
| 提交数 | GitHub 页面显示 41 commits |
| GitHub repository size | 1,973,096 KiB，约 1.88 GiB；这是 GitHub 仓库元数据值，不等同于当前 checkout 的精确磁盘大小 |
| 当前 tree 的 blob 合计 | 137,297,515 bytes，约 131 MiB |
| 根许可证 | MIT，Copyright (c) 2024 42arch |
| README 声明 | 第一至第九世代简体中文 JSON；数据抓取自神奇宝贝百科 |

官方依据见仓库 [README](https://github.com/42arch/pokemon-dataset-zh/blob/main/README.md)、[LICENSE](https://github.com/42arch/pokemon-dataset-zh/blob/main/LICENSE) 和 [commit history](https://github.com/42arch/pokemon-dataset-zh/commits/main/)。

### 2.2 最近数据更新

最近能明确识别的数据/脚本更新包括：

| 日期 | commit | 说明 |
| --- | --- | --- |
| 2026-03-17 | `82ce04e` | 修复 `home_images` 获取 |
| 2026-02-23 | `904b0ca` | 更新数据 |
| 2026-02-04 | `f9f77dc` | 更新数据和脚本 |
| 2026-02-01 | `a993554` | 更新数据和脚本 |
| 2026-01-31 | `7feda19` | 更新数据和脚本 |
| 2026-01-30 | `f2e8e86` | 更新脚本和数据 |
| 2025-10-23 | `feff1f8` | 更新全国图鉴 |

结论是：**仓库在 2026 年仍有维护迹象，但更新节奏不稳定，不能假定会及时跟随每次官方数据变化。** 分析日距最近提交约五个月；应把上游更新视为需要主动检查的事件，而不是可靠的自动 feed。

### 2.3 更新机制

- 根目录没有发现 `.github/workflows`，未发现 GitHub Actions 自动更新流程。
- `scripts/` 有 crawler、batch crawler、图片抓取、列表抓取和 `fix_data.js` 手动修正规则。
- 主要 crawler 使用 `axios`、`cheerio`、`fs`、`path` 等，并直接访问 `wiki.52poke.com` 与 `media.52poke.com`。
- `pokemon_info_crawler.js` 约 2,217 行，`fix_data.js` 约 3,732 行，说明结果不只是通用页面解析，还依赖大量项目内修正。
- `package.json` 只有默认失败的 `test` 脚本，没有数据验证测试或一键可复现的生成命令；依赖为 `axios` 与 `cheerio`。

因此现有流程更接近“维护者按需运行 crawler 并修正”，不是经过自动测试的可复现数据管线。

## 3. Dataset Structure

固定提交的 recursive tree 共 8,726 个 blob。与本项目相关的目录职责如下：

| 路径 | 数量/规模 | 数据职责 | 审计判断 |
| --- | ---: | --- | --- |
| `data/pokemon/` | 1,025 JSON；约 31.8 MB | 每个全国编号一个详细 Pokémon 文件 | 中文百科主数据候选；不能原样作为 canonical model |
| `data/pokedex/` | 24 JSON；约 0.97 MB | 全国及地区/游戏图鉴列表 | `Dex + DexEntry` 的强候选来源，需验证异常与版本语义 |
| `data/abilities/` | 307 JSON；约 0.99 MB | 特性详细介绍、效果、拥有者 | 中文详情候选；覆盖不等于总表 |
| `data/ability_list.json` | 311 条；约 90 KB | 特性编号、多语言名、简述、世代、使用计数 | 特性 localization 的首选入口 |
| `data/moves/` | 349 JSON；约 7.87 MB | 部分招式详细效果、变更和学习者 | 详情覆盖不完整，不宜单独作为全量招式源 |
| `data/move_list.json` | 953 条；约 353 KB | 全量招式编号、多语言名、数值、简述 | 招式中文 mapping 的首选入口 |
| `data/item_list.json` | 约 464 KB | 13 个顶层分类组成的树状道具清单 | 有中/日/英文名、说明与图标引用；未见稳定官方编号 |
| `data/images/` | 约 91.9 MB 当前 blob | `dream`、`home`、`official`、items 和 sprite 资源 | 不下载、不打包；仅可借助命名发现候选外观 |
| `data/raw/` | 3 个文件；约 1.42 MB | 抓取页面/样式的原始快照 | 可解释 crawler 来源，也反映页面结构耦合 |
| `scripts/` | 17 个文件；约 0.65 MB | crawler、批处理、图片下载和手工修正 | 可作上游实现参考，不建议成为本项目运行依赖 |

README 中写的是 `data/move/**` 和 `data/ability/**`，实际目录名是复数 `moves/`、`abilities/`。同步程序应以固定提交的真实 tree 为准，不能只照 README 拼路径。

## 4. Pokémon Coverage

### 4.1 编号完整性

对固定提交下全部 `data/pokemon/*.json` 的文件名与内容做了只读统计：

- 文件数：1,025。
- 最小/最大编号：`0001` / `1025`。
- `#0001`～`#1025` 缺失编号：0。
- 重复编号：0。
- 文件命名规律：`四位编号-简体中文名.json`。
- 每个全国编号恰有一个文件；各种 form 嵌套在该文件中。
- 没有以独立文件形式出现的非全国编号实体。

这一规律适合作为 **Species 文件边界**，但全国编号本身不应直接代替本项目的字符串 `speciesId`；更稳妥的做法是保留 `nationalDexNumber` 数值字段，并用与 Showdown 对齐的稳定字符串 ID 作为内部主键。

### 4.2 代表案例

| 编号 | 观察到的结构 | 结论 |
| --- | --- | --- |
| `#0001 妙蛙种子` | 1 个 `forms` 项；`stats.form` 为“通常语义的一般” | 简单 Species 也存在 form/stats 名称不一致 |
| `#0006 喷火龙` | 普通、Mega X、Mega Y、Gigantamax 共 4 个 `forms`；stats 只有前三者 | 战斗值不发生改变的 Gigantamax 不一定有独立 stats |
| `#0479 洛托姆` | 6 个 `forms`；stats 把 5 种家电形态合并为一项 | forms 与 stats 不是按索引或名称一对一 |
| `#0493 阿尔宙斯` | `forms` 只有普通项；`home_images` 有 18 属性外观 | 属性外观覆盖存在，但不在规范 form 数组中 |
| `#0718 基格尔德` | 50%、10%、完全体及新的 Mega 项；另有独立 Mega 列表 | 同一概念可能重复出现在多个数组，名称还不同 |
| `#0869 霜奶仙` | `forms` 只有普通和 Gigantamax；`home_images` 列出大量奶油/糖饰组合 | cosmetic 覆盖远高于结构化 form 覆盖 |
| `#1017 厄诡椪` | 4 种面具均有类型和特性；stats 只有“一般” | form 类型/特性完整，但共享 stats 的表达不显式 |
| `#1025 桃歹郎` | 单一 form，进化链标为不进化 | 最新全国编号覆盖存在 |

此外，`#0201 未知图腾` 的 28 个字母/符号只出现在 `home_images`，`forms` 仍只有一项；`#1024 太乐巴戈斯` 的普通、太晶、星晶三形态则在 `forms` 与 `stats` 中均明确列出。

## 5. Form Model

### 5.1 实际模型

仓库没有统一的 `Form` 实体。相关信息散落在：

- `forms[]`：中文 name、types、abilities、身高体重、经验类型等。
- `stats[]`：一个自由文本 `form` 加六项种族值。
- `type_effectiveness[]`：另一个自由文本 `form`、类型及预计算倍率。
- `mega_evolution[]` / `gigantamax_evolution[]`：名称、`form_name` 与图片引用。
- `home_images[]`：图片变体名称；常比 `forms` 更细。
- 全国/地区图鉴：还可能以带后缀的显示名称再次列出形态。

共统计到 1,320 个 `forms` 项、1,295 个 `stats` 项和 1,348 个 `type_effectiveness` 项。数量不同本身就说明三者不能机械按索引合并。

### 5.2 能否表示各类形态

| 类型 | 覆盖判断 | 说明 |
| --- | --- | --- |
| 普通形态 | 是 | 但普通形态名称可能是 Species 名、“一般”或“通常的样子”等不同写法 |
| Mega X/Y | 是 | 喷火龙等能区分 X/Y；还可能重复出现在 `mega_evolution` |
| 地区形态 | 是 | 通常作为 `forms` 项；地区图鉴也用名称后缀表达 |
| Gigantamax | 是 | 常有 `forms` 与图片记录，但不一定有独立 stats |
| 性别差异 | 部分/需逐例验证 | 同战斗数据的外观差异可能只存在图片名称，不能假定都有 form 项 |
| 洛托姆模式 | 是 | 6 个 form；5 个家电 form 在 stats 中合并 |
| 阿尔宙斯属性形态 | 图片层覆盖 | 18 种仅见于 `home_images`，`forms` 不完整 |
| 基格尔德形态 | 是 | 10%、50%、完全体等存在；数组间存在命名与重复问题 |
| 厄诡椪面具 | 是 | 4 个面具有各自类型、特性；stats 共享关系不显式 |
| Tera 相关形态 | 部分明确 | 太乐巴戈斯三形态结构化；不能外推为所有太晶外观都有 form |
| cosmetic forme | 图片层较丰富 | 不适合作为对战 form 直接导入 |
| 霜奶仙外观 | 图片层很丰富 | 奶油与糖饰组合不在 `forms` 中逐项建模 |
| 未知图腾字母 | 图片层完整 | 28 种只在 `home_images` 命名中 |

### 5.3 稳定性与 Showdown mapping

1. `forms` 没有稳定 ID，只有中文 `name`。
2. `forms` 与 `stats` 没有引用键；名称并不总相同，也不保证数量一致。
3. form name 只在局部上下文内有意义；“一般”“超级进化”等名称会跨 Species 重复。
4. 不能仅用中文 form name 直接生成 Showdown ID。
5. 映射应以 Showdown formId 为目标，用全国编号、英文 Species 名、类型、种族值、特性、form 中文名等组合验证，并维护显式例外表。
6. `pokemon-dataset-zh` 对未知图腾、霜奶仙、阿尔宙斯等**纯外观/图片变体的命名**比 Showdown 更丰富。
7. Showdown 对**对战形态的稳定 ID、baseSpecies、forme、changesFrom、battleOnly**更完整；这是本仓库明显不足的部分。

## 6. Pokémon Fields

### 6.1 Species 级字段

全部文件出现过的顶层 key 为：

`name_zh`、`name_ja`、`name_en`、`pokedex_id`、`description`、`profile`、`prototype`、`detail`、`names`、`forms`、`stats`、`type_effectiveness`、`pokedex_entries`、`evolution_chains`、`mega_evolution`、`gigantamax_evolution`、`learnable_moves`、`machine_moves`、`egg_moves`、`home_images`。

其中：

- `name_*`、`pokedex_id`：Species identity/localization。
- `description`、`profile`、`prototype`、`detail`、`pokedex_entries`、`names`：百科展示文本与多语言名称资料。
- `forms`、`stats`：形态候选资料，但语义不统一。
- `evolution_chains`：进化图与中文条件文本。
- `learnable_moves`、`machine_moves`、`egg_moves`：以当前页面语义整理的学习方式。
- `home_images`：图片引用/外观候选，不是规范 form 表。

Pokémon 顶层没有统一的 `generation` 字段；世代可从 `data/pokedex/national.json` 的 `gen` 候选字段或全国编号推导/交叉验证。地区编号也不在 Pokémon 文件内，而在 `data/pokedex/` 外部表中。

### 6.2 Form 级字段

`forms[]` 出现的字段：

- `name`
- `types`
- `category`
- `abilities`（`name` + `is_hidden`，没有槽位 ID）
- `height`、`weight`
- `color`
- `catch_rate`
- `egg_groups`
- `experience_100`
- `base_points`（EV yield）
- `base_exp`
- `battle_exp`
- `gender_ratio`
- `egg_cycles`
- `shape`、`footprint`、`image`

身高、体重、捕获率、经验等多为带单位或说明的字符串，不是已规范化数值。导入前必须解析并保留原值用于异常报告。

### 6.3 `stats` 字段

`stats[]` 只有：

- `form`：自由文本标签。
- `data`：`hp`、`attack`、`defense`、`sp_attack`、`sp_defense`、`speed` 字符串值。

没有稳定 form 引用，也没有必要保存“种族值总和”；总和可由六项数值计算。

### 6.4 字段分类

| 类别 | 例子 | 本项目处理 |
| --- | --- | --- |
| 原始 identity/localization | 中英日名称、全国编号 | 规范化并记录来源 |
| 机械事实候选 | types、stats、ability、height、weight、gender | 主要与 Showdown 对照；冲突时不静默覆盖 |
| 百科文本 | description、detail、prototype、图鉴条目 | 按来源与语言单独存储，不混入机械事实 |
| 图片引用 | image、home_images、shape、footprint | 暂不复制二进制；只保留必要外部映射候选 |
| 衍生/预计算 | type effectiveness、battle exp、统计计数 | 不进入 canonical JSON，运行时或构建时计算 |

## 7. Growth Rate

### 7.1 实际值集合

`experience_100` 位于 `forms[]`，不是 Species 顶层。1,320 个 form 项的值分布如下：

| 原始值 | form 数 | 内部枚举 |
| --- | ---: | --- |
| `600,000（最快）` | 36 | `erratic` |
| `800,000（快）` | 76 | `fast` |
| `1,000,000（较快）` | 523 | `medium-fast` |
| `1,059,860（较慢）` | 326 | `medium-slow` |
| `1,250,000（慢）` | 344 | `slow` |
| `1,640,000（最慢）` | 14 | `fluctuating` |
| `未知` | 1 | 无法映射 |

唯一例外是：

- `#1021 猛雷鼓`，form `猛雷鼓`：`experience_100 = "未知"`。

没有空值，但不能把“无空值”误解为“全部可用”。

### 7.2 是否适合作为主要上游

**适合作为 `Species → GrowthRate` 的主要候选上游，但必须加验证层。** 理由：

- 六种标准曲线都有明确的 Lv.100 总经验和中文标签。
- 同一 Species 的 form 通常重复同一值，说明字段本质上是 Species 级事实。
- 数据比 Showdown 完整；Showdown 不提供该领域。
- Excel 已有六条完整经验曲线，可验证 mapping，并继续负责经验公式/逐等级计算的迁移证据。

转换时应：

1. 解析字符串为枚举，不保存带逗号的显示字符串作为主值。
2. 同一 Species 的所有 form 必须一致，否则失败并报告。
3. `#1021` 先由 Excel或另一可靠来源交叉验证，不允许凭常识猜值。
4. 六种经验公式由本地纯 TypeScript 实现，不复制每级累计表。

## 8. Localization

### 8.1 可用范围

| 实体 | 中文 | 英文 | 官方编号 | 判断 |
| --- | --- | --- | --- | --- |
| Pokémon Species | `name_zh` | `name_en` | `pokedex_id` | 自动 mapping 条件很好 |
| Pokémon Form | 中文 `forms[].name` | form 级通常没有 | 没有 | 需要组合字段与例外映射 |
| Ability | `name_zh` | `name_en` | `id` | 很适合 mapping |
| Move | `name_zh` | `name_en` | `id` | 很适合 mapping |
| Item | `name_zh` | `name_en` | 未见稳定编号 | 可按英文名映射并人工校验 |
| Pokédex entry | 中文版本文本 | 不提供对应英文文本 | 没有统一 entry ID | 适合中文展示，不适合直接跨源逐条对齐 |

Pokémon 还保存 `name_ja` 和一个包含多语言名称/名称来源的 `names` 结构。对本项目的核心价值是简体中文，而不是用它替代所有语言数据。

### 8.2 推荐 mapping 规则

- Species：全国编号为主要 join key，英文名为强校验，中文名用于展示。
- Form：目标键必须是 Showdown formId；全国编号只确定 Species，随后用英文基础物种、中文 form 名、types、stats、abilities 和人工例外共同匹配。
- Ability/Move：官方编号优先，规范化英文名和 Showdown ID 双重校验；中文名不能作为唯一主键。
- Item：先用英文名与 Showdown item ID 对照；因缺少编号，必须保留例外表。

## 9. Ability Data

### 9.1 总表

`ability_list.json` 有 311 条，字段为：

- `id`
- `name_zh`、`name_ja`、`name_en`
- `description`
- `common_count`、`hidden_count`
- `generation`
- `caption`

编号是三位字符串，适合与 Showdown 的 `num` 对照。`common_count`、`hidden_count` 是由拥有者统计出的展示/衍生值，不应进入 canonical ability 数据。

### 9.2 详情文件

`data/abilities/` 有 307 份，以中文名命名。详情字段联合为：

- `id`
- `name_zh`、`name_ja`、`name_en`
- `basic_info`
- `introduction`
- `effect`
- `pokemon_list`

详情中的 `pokemon_list` 又重复保存 Pokémon 编号、显示名、形态、类型和特性槽，属于反向展示索引，不宜迁移为 canonical 数据。

总表 311 条而详情 307 份，说明**详情覆盖不完整**。中文短说明可优先使用总表；长说明只能在存在详情文件时使用，并为缺失项报告异常。

### 9.3 与 Showdown 关联

优先级：

1. 官方编号：最稳定，先与 Showdown `num` 对齐。
2. 英文名：用于检测编号错位、重命名或标点规范差异，并生成 Showdown `abilityId`。
3. 中文名：仅用于展示和文件定位，不作为跨源主键。

Showdown 继续负责实际对战逻辑和当前机械事实；本仓库负责中文名、中文简述和候选长说明。不要迁移 Showdown 回调代码，也不要把 52Poké 长文当成模拟器逻辑。

## 10. Move Data

### 10.1 总表

`move_list.json` 有 953 条，字段为：

- `id`
- `name_zh`、`name_jp`、`name_en`
- `type`、`category`
- `power`、`accuracy`、`pp`
- `description`
- `generation`
- `is_z`

注意特性用 `name_ja`，招式总表用 `name_jp`，这类 schema 不一致需要转换层处理。

### 10.2 详情文件

`data/moves/` 只有 349 份。详情字段联合为：

- identity：`id`、`name_zh`、`name_ja`、`name_en`
- 基础值：`type`、`category`、`pp`、`power`、`accuracy`、`range`
- 中文文本：`description`、`intro`、`effect`、`additional_effect`、`details`、`move_changes`
- 学习者反向索引：`learn_by_level_up`、`learn_by_tm`、`learn_by_breeding`、`learn_by_tutor`

因此详情目录只覆盖约 36.6% 的招式总表，不能称为全量详情源。953 条总表可以作为 Excel 952 条招式列表的强替代候选，但需查明多出的条目和版本口径。

### 10.3 与 Showdown 关联

优先使用官方 move number 与 Showdown `num` 关联，再用英文名/Showdown ID 校验。数值冲突时 Showdown 负责当前对战事实，本仓库负责简体中文名称和说明。威力、命中、PP 等字段在本仓库中是显示字符串，且可能包含“—”“变化”或版本语义；不能无条件覆盖 Showdown 的结构化值。

## 11. Evolution

Pokémon 文件的 `evolution_chains` 是“链数组 → 节点数组”。节点可包含：

- `name`
- `stage`
- `text`
- `image`
- `back_text`
- `from`
- `form_name`

多分支可通过多个节点共享 `from` 表达，整体比 Excel 的单元格自由文本和名称查找更接近图结构。但是核心条件仍集中在 `text`，例如“等级16以上”或“主角结束原地旋转（携带糖饰）”，不是拆开的 `level/item/move/condition` 字段。

此外，Mega 与 Gigantamax 被放在独立数组中，主要记录名称与图片，不应和生物进化链混为一谈。

来源分工建议：

- Showdown：进化前后关系和可结构化条件的 canonical source。
- `pokemon-dataset-zh`：中文进化条件展示文本、复杂条件解释和交叉验证。
- Excel：legacy 校验；其自由文本不再作为首选 canonical source。

遇到 Showdown 缺少而本仓库只有自由文本的条件时，应把原文保留为带来源的 `conditionText.zh-CN`，同时明确标记“尚未结构化”，不要静默猜字段。

## 12. Regional Dex

### 12.1 文件清单

`data/pokedex/` 有 24 份 JSON：

- `national.json`
- 关都、城都、丰缘、神奥、合众
- 卡洛斯：中央、海岸、山岳
- 阿罗拉总表及美乐美乐、阿卡拉、乌拉乌拉、波尼
- 伽勒尔、铠岛、王冠雪原
- 洗翠
- 帕底亚、北上、蓝莓
- 密阿雷、密阿雷-异次元、密阿雷-超级进化

地区条目通常包含：

- `id`：地区图鉴编号。
- `national_id`：全国编号。
- `name`：可能带形态后缀的中文显示名。
- `types`。
- `icon`：sprite 坐标。

`national.json` 的结构不同：使用 `id`、`name`、`types`、`icon`、`filter`、`gen`，且有 1,082 条，包含多于 1,025 个 Species 的形态/展示条目。

### 12.2 对 Excel 的覆盖

仓库明确覆盖 Excel 当前的：关都、神奥、伽勒尔、铠岛、王冠雪原、洗翠、帕底亚、北上、蓝莓；还额外提供城都、丰缘、合众、卡洛斯分区、阿罗拉分岛与密阿雷相关图鉴。

部分条目数与 Excel 或常见单一图鉴口径明显不同，例如固定提交的 `洗翠.json` 有 708 条，而 Excel 洗翠表的主清单规模远小于此；`关都.json` 有 153 条，也不只是简单的 151 个全国物种。这不一定代表错误，可能来自版本、形态或页面表格口径，但在解释清楚前不能直接导入。

### 12.3 是否适合 `Dex + DexEntry`

适合，推荐转换为：

```text
Dex
  id / zh-CN name / game-or-region scope / upstream source

DexEntry
  dexId / regionalNumber / speciesId / optional formId / sourceName
```

但必须先：

- 明确同一地区不同版本/扩展包的 scope。
- 用 `national_id + name` 区分 Species 与 form。
- 忽略 `icon` 坐标等 UI 实现字段。
- 检查重复地区编号、缺号、一个编号多形态以及异常条目数。
- 与 Excel 现有九组地区表交叉验证后再决定主来源切换。

## 13. Derived/Redundant Data

以下内容不应原样复制到项目 canonical JSON：

| 上游字段 | 原因 | 推荐处理 |
| --- | --- | --- |
| `type_effectiveness` | 可由属性矩阵、form types、特性/特殊规则计算；当前还混合“飘浮”等条件 | 从 Showdown type chart 和本地规则实时计算 |
| 种族值总和 | 六项相加即可 | TypeScript 纯函数计算 |
| `battle_exp` | 预计算/展示值，且版本公式可能不同 | 需要时用明确版本公式计算 |
| `common_count` / `hidden_count` | 拥有者统计值 | 从规范化 form-ability 关系统计 |
| `pokemon_list` / `learn_by_*` 反向清单 | 重复实体与关系，容易漂移 | 从 canonical relation 构建索引 |
| `icon` sprite 坐标 | 上游 UI 实现细节 | 不导入 |
| `home_images` 全量 | 图片命名清单不等于 form 模型 | 只作 cosmetic mapping 候选 |
| `experience_100` 中的总值字符串 | 类型已能决定 Lv.100 总值 | canonical 只存枚举；显示值计算或本地常量映射 |
| 重复 `forms` / Mega / Gmax 信息 | 多数组名称不一致 | 映射到单一 Form 后记录来源证据 |

百科文本也不属于“衍生数据”，但应与机械事实分层存储，避免长文本改动导致核心实体无意义 churn。

## 14. Update Strategy

### 14.1 是否运行上游 crawler

**不建议本项目直接运行其 crawler 作为正常同步方式。** 原因：

- 完全依赖 52Poké 的页面与 CSS/表格结构。
- 需要维护大量 selector、图片规则和 `fix_data.js` 特例。
- 没有自动测试、schema contract 或稳定的一键生成命令。
- 运行 crawler 会重新引入网络、页面版权、图片下载和难复现问题。

优先同步上游维护者已生成的 JSON，再由本项目做严格验证。只有当上游停止维护且项目确实需要接管时，才单独评估 fork crawler；那会是新的明确阶段。

### 14.2 方案比较

| 方式 | 优点 | 缺点 | 判断 |
| --- | --- | --- | --- |
| 完整 clone | 离线、历史 diff 完整 | 仓库约 1.88 GiB 元数据规模，图片和历史很重 | 不推荐 |
| shallow sparse checkout + blob filter | 可固定 SHA、可离线复查、只取 JSON/脚本、便于 diff | 初次配置略多；需确保不展开 images | **推荐用于重复同步** |
| GitHub archive | 简单、固定 commit | GitHub archive 通常包含整个 tree，包括图片 | 不推荐 |
| 固定 SHA 的 raw files | 简单、最终不带 Git 历史 | 约千个请求、网络不稳定、目录发现困难 | 适合小样本；全量同步次选 |
| GitHub tree API + pinned raw files | 能先得到 manifest，再只下载所需 JSON | API 限额与大量请求；离线性弱 | 可作为自动同步实现备选 |

推荐的开发期流程：

1. 检查 `main` 新提交，但不直接跟随浮动分支。
2. 选择并记录一个审核过的 upstream SHA。
3. 在项目外缓存区做 `--filter=blob:none` 的 shallow sparse checkout，只展开 `data/pokemon`、`data/pokedex`、列表 JSON，以及确实需要的 `abilities`/`moves`；不展开 `data/images`。
4. 比较旧 SHA 与新 SHA 的相关 JSON diff。
5. 运行 schema、数量、ID、跨源 mapping、成长类型、地区图鉴和复杂 form 回归检查。
6. 人工审查异常后生成项目自己的规范化静态 JSON。
7. 在生成物元数据/NOTICE 中记录 upstream repo、SHA、生成时间和来源说明。

最终 Svelte App 只使用本项目生成的精简 JSON，不包含 crawler、上游仓库或图片全集。

## 15. Licensing and Provenance

必须分开看三层来源：

1. **仓库代码/仓库声明**：根 `LICENSE` 是 MIT，要求在软件副本或实质部分中保留版权与许可声明。根 `package.json` 却写 `"license": "ISC"`，与根 LICENSE 不一致；采用前应把它记录为上游需要澄清的元数据问题，而不是自行选择对自己最有利的解释。
2. **抓取文本/数据**：README 明确说数据抓取自[神奇宝贝百科](https://wiki.52poke.com/)。根 MIT 文件本身不能证明被抓取的百科文本、说明、图鉴条目都由仓库作者拥有并可按 MIT 再许可。
3. **Pokémon 图片**：README 将图片称为 official、版权绘图和 Pokémon HOME 图像。仓库存在图片文件不等于本项目获得重新分发权；本次审计没有下载或分析图片。

工程上的最低措施是：

- 保留 `pokemon-dataset-zh` 的 MIT notice 与固定 SHA。
- 对来自 52Poké 的文本保留来源/provenance，不宣称其自动属于 MIT。
- 在许可证与资源策略未单独确认前，不把上游图片复制进项目或最终包。
- 把“使用短名称/事实字段”和“批量再分发百科长文本”分别评估；两者风险不同。

这里仅记录官方仓库文件表达的来源和风险，不提供法律保证。

## 16. Three-Source Matrix

判定代码：A = Showdown 主来源；B = `pokemon-dataset-zh` 主来源；C = Excel/本地主来源；D = 双源或三源交叉验证；E = 暂时未知/需另行决定。

| 数据领域 | Showdown | pokemon-dataset-zh | Excel / 本地 | 最终判定与说明 |
| --- | --- | --- | --- | --- |
| Species identity | 稳定英文 ID、base species | 1,025 文件与全国编号 | 旧中文关联 | **A**；中文仓库作 D |
| Form identity | formId、baseSpecies、forme、关系 | 中文 form/图片变体，无 ID | 覆盖广但名称不稳 | **A**；另外两源作 D |
| 中文 Pokémon 名 | 缺失 | Species 覆盖完整候选 | 已有名称 | **B**；Excel 作 D |
| 英文名 | canonical display/ID 基础 | Species 中也有 | 覆盖不完整 | **A**；中文仓库作 D |
| 全国编号 | `num` | `pokedex_id` | 已有编号 | **A + D**；三源一致性检查 |
| 属性 | form 级机械事实 | form 级中文值 | 已有 | **A**；其余作 D |
| 种族值 | form 级机械事实 | `stats` 但关联不统一 | 已有 | **A**；其余作 D |
| 特性槽 | 明确 0/1/H/S | 名称 + hidden 布尔值 | 普通/第二/隐藏列 | **A**；其余作 D |
| 特性中文名 | 缺失 | 311 条编号/中英文 | 319 行候选 | **B**；Excel 作 D |
| 特性中文说明 | 缺失 | 311 短说明、307 详情 | 已有说明 | **B（有覆盖标记）**；Excel 作 D |
| 招式机械事实 | 结构化当前值与逻辑 | 953 总表、349 详情 | 952 行 | **A** |
| 招式中文名/说明 | 缺失 | 覆盖最强 | 已有中文 | **B**；Excel 作 D |
| 属性克制 | 基础 type chart | 预计算且混入条件 | 基础矩阵和衍生表 | **A**；本地计算，Excel 作 D |
| 性格 | 25 种结构化修正 | 未发现独立领域 | Excel 有表 | **A**；Excel 作 D |
| Growth Rate | 缺失 | 六种类型，1 条未知 | 六曲线及物种候选 | **B**；Excel 作 D |
| 经验公式 | 缺失 | 仅 Lv.100 类型字符串 | 六曲线公式/结果 | **C**；迁移为本地 TypeScript 公式 |
| 进化关系 | 较结构化字段 | 图结构 + 中文自由文本 | 名称/等级/备注 | **A**；中文仓库负责展示，Excel 作 D |
| 地区图鉴 | 不以图鉴编号为目标 | 24 份，覆盖广 | 九组重点地区 | **B 候选 + D**；验证口径后切换 |
| 分类 | 只有部分 battle/tag 语义 | `filter` 等展示分类有限 | 御三家、神兽、猜宝可梦等 | **C** |
| 图片 | 非本项目目标 | 数量多但授权和包体风险高 | 有部分标记 | **E**；本阶段不采用 |
| 百科文本 | 英文对战说明，不是百科 | 中文 description/detail/entries | 零散说明 | **B 候选**；需先解决 provenance/分发策略 |

## 17. Recommended Architecture

原提案方向正确，但“`pokemon-dataset-zh = zh-CN localization + encyclopedia upstream`”应加两个限定词：**候选**与**经过映射/验证后**。

```text
Pinned Pokémon Showdown SHA
  └─ canonical battle facts, English IDs, Species/Form graph

Pinned pokemon-dataset-zh SHA
  ├─ candidate zh-CN entity names and descriptions
  ├─ candidate Species growth rate
  ├─ candidate regional dex entries
  └─ encyclopedia text with explicit 52Poké provenance

Local curated data
  ├─ Showdown ID ↔ Chinese dataset entity mapping
  ├─ exceptions and unresolved conflicts
  ├─ project classifications and helper metadata
  ├─ experience formulas
  └─ source/version/license metadata

Excel
  └─ legacy migration and cross-validation evidence

                 ↓ validated build-time normalization
             project-owned compact static JSON
                 ↓
             offline Svelte application
```

关键原则：

- canonical entity ID 来自/对齐 Showdown，不来自中文显示名称。
- 一个字段可以有不同来源；不要强迫一个仓库包办所有领域。
- localization 与 mechanics 分层，百科长文本再单独分层。
- 所有冲突显式报告，并记录 field-level provenance。
- 上游 raw 结构不直接暴露给 Svelte UI。
- 最终输出只包含产品需要的字段，不包含重复反向索引和图片全集。

Excel 可以进一步降级：中文 Species/Ability/Move 名称、招式列表和地区图鉴不再默认由 Excel 主导；但在完成三源映射、异常清单和回归验证前，Excel 仍是重要证据，不能删除或忽略。

## 18. Risks

1. **许可与来源风险**：MIT 与抓取自 52Poké 的文本、Pokémon 图片是不同问题。
2. **form identity 风险**：中文 form 无稳定 ID，数组粒度不同，自动匹配可能合错。
3. **schema 漂移风险**：没有 schema/version contract；字段名已有 `name_ja`/`name_jp` 不一致。
4. **不完整详情风险**：311 特性 vs 307 详情；953 招式 vs 349 详情。
5. **数据新鲜度风险**：仍有维护，但不是稳定自动发布流程。
6. **crawler 脆弱性**：依赖 52Poké DOM、媒体路径和数千行修正规则。
7. **地区图鉴口径风险**：部分条目数与 Excel/单一图鉴预期差距很大。
8. **冗余冲突风险**：同一事实存在于 forms、stats、effectiveness、图片和列表中。
9. **体积风险**：完整仓库与图片不符合轻量项目目标。
10. **百科文本 churn**：长文本更新频繁，会放大 diff 和最终 JSON 体积。
11. **package license 元数据冲突**：根 LICENSE 为 MIT，package.json 为 ISC，需要记录并澄清。

## 19. Open Questions

- `#1021 猛雷鼓` 的成长类型应由哪一可靠来源补齐？Excel 是否已有可验证值？
- `ability_list` 中哪 4 条没有详情文件，是否只是尚未抓取的新特性？
- 604 条没有详情文件的招式是否有明确选择规则，还是 crawler 尚未完成？
- `national.json` 的 1,082 项如何定义形态纳入边界？是否包含未来不应进入主产品的展示实体？
- `洗翠.json` 的 708 条具体由哪些版本/分区/重复行组成？
- 新的密阿雷和 Mega 数据应归属第几世代/哪一游戏 scope？不能只靠全国编号推断。
- 是否允许在最终应用中再分发 52Poké 的中文长说明和图鉴文本？需要单独确认使用策略。
- 图片是否完全排除，还是未来另找授权明确、尺寸可控的资源？
- Form mapping 的 cosmetic 边界是什么：霜奶仙糖饰、未知图腾字母、阿尔宙斯属性外观是否都要成为可搜索实体？
- 上游根 MIT 与 package.json ISC 的不一致是否只是模板残留？

## 20. Recommended Next Step

下一阶段建议不是立即设计最终 `data-model.md`，而是做一个**小范围、无正式生成物的三源 mapping proof**：

1. 固定 Showdown SHA `84d7ceb4f009928221fce7a00e711bab263c5f4e` 与本次中文仓库 SHA `82ce04e611d19a12556c3955125b048b36187f52`。
2. 只选择约 12～20 个复杂案例，至少包括喷火龙、洛托姆、阿尔宙斯、未知图腾、基格尔德、霜奶仙、厄诡椪、太乐巴戈斯、猛雷鼓和桃歹郎。
3. 验证 Species、Form、Ability、Move、GrowthRate 与 Regional Dex 的 join key 和异常分类。
4. 记录“自动匹配”“需要规则”“必须人工例外”“上游缺失”四类结果。
5. 明确 cosmetic form 的产品边界及百科文本使用范围。
6. proof 通过后，才进入正式数据模型设计和同步器规划。

这一步的目的不是批量转换，而是尽早证明两套上游 ID/名称体系能否安全合并，避免在最终模型建立后才发现 form 边界不可用。
