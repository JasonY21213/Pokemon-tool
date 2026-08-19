# Pokémon Tool Converter and Data Pipeline Design

本文定义开发期转换器和静态数据生成 pipeline。它以 [canonical data model](./data-model.md) 为目标模型，但本阶段不实现转换代码、不获取上游、不生成正式 JSON。

## 1. Goals

目标 pipeline：

```text
Pinned Pokémon Showdown snapshot
  + Pinned pokemon-dataset-zh snapshot
  + Local curated data
  + Read-only Excel validation
                ↓
Adapters → normalization → identity mapping → candidate merge
                ↓
provenance capture → conflict detection → validation
                ↓
canonical runtime JSON + build-time reports/provenance
```

设计原则：

- 最终 Svelte runtime 只读取项目生成的静态 JSON，不导入 Showdown、Git、Excel 或 Node-only 代码。
- 上游必须固定完整 commit SHA 或文件 hash；浮动分支不能生成发布数据。
- Adapter 只解释来源，不决定 canonical source priority。
- identity mapping、字段选择、冲突和 validation 是显式阶段。
- 相同输入、相同 converter/schema 版本必须得到 byte-stable runtime 输出。
- unresolved 必须可见；允许 unknown 的字段与会破坏 identity/reference 的问题区别处理。
- pipeline 可以先在小型 fixtures 上端到端运行，再扩大领域，避免第一次就构建全量同步器。

非目标：运行上游 crawler、复制图片、迁移 Showdown battle callbacks、建立后端、生成 learnsets，或让 UI 直接理解任何上游字段。

## 2. Directory Layout

推荐的最终逻辑目录如下。这里只做设计，不在本阶段创建这些目录或文件。

```text
Pokemon-tool/
  data-source/
    Pokemon-data.xlsx              # 用户只读副本，已忽略
    source-lock.json                # tracked；预期上游版本与输入清单
  data-curated/
    id-registry.json
    mapping-exceptions.json
    overrides.json
    tags.json
    dex-scopes.json
  scripts/data/
    cli.ts
    adapters/
    normalization/
    mapping/
    merge/
    provenance/
    validation/
    emission/
    fixtures/
  src/lib/data-model/
    schemas/                        # 纯 schema/type；UI 只 type-import
    types/                          # 必要时由 schema 推导/重导出
  src/lib/domain/                   # 浏览器可用纯函数
  generated/                        # ignored；可再生 build-time artifacts
    intermediate/
    provenance/
    smoke-runtime/
    run-metadata/
  reports/data-build/               # deterministic summaries for review
  public/data/                      # 验证通过的 canonical runtime JSON
```

### 2.1 上游缓存

Showdown 与中文仓库 checkout 必须在项目外，例如用户级 cache，具体位置由 future CLI 参数或 `POKEMON_TOOL_UPSTREAM_CACHE` 指定。缓存目录不能是 `data-source/`、不能成为 Git submodule，也不能进入本仓库 Git。cache key 使用 source name + full SHA。

### 2.2 各候选目录的判断

| Directory | Decision |
| --- | --- |
| `scripts/` | 使用 `scripts/data/` 保存 Node build-time 代码 |
| `tools/` | 不创建；与 `scripts/data/` 职责重复，会增加入口混乱 |
| `data-source/` | 只放用户原始输入和 tracked source lock；不放 checkout |
| `data-curated/` | tracked、人工审查的小型政策/例外输入 |
| `schemas/` | 第一版不建顶层手写 schema；schema source 放 `src/lib/data-model/schemas/`，如需对外 JSON Schema 再生成到顶层 `schemas/generated/` |
| `generated/` | ignored、完全可再生的 intermediate、full provenance 和 smoke output |
| `reports/` | 保存 deterministic conflict/validation/change summary；数据 checkpoint 时可审查并提交 |
| `src/` | 仅共享数据类型和浏览器纯 domain logic；不得放 fs/Git/Excel adapter |
| `public/data/` | 正式 runtime output；只有 release validation 通过后才更新 |

完整 provenance 可由 pinned inputs 重建，默认不提交 Git；`source-lock.json`、runtime `manifest.json` 和确定性 reports 足以在 Git 中记录生成依据。若以后需要长期归档完整 provenance，应作为 CI/release artifact，而不是进入前端目录。

## 3. Pipeline Stages

正常 build 不应修改 curated 输入。任何 registry 更新必须使用显式 proposal/update 流程并单独审查。

| # | Stage | Input | Output | Cache | Failure conditions | Unresolved policy |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Acquire / verify pinned sources | `source-lock.json`, external cache | verified SourceSnapshot descriptors | 按 full SHA/hash | source 不存在、SHA/hash/size 不符、selected path 缺失 | 不允许 |
| 2 | Parse adapters | verified files | source-specific records + SourceReferences | source hash + adapter version | parse error、required root/object 缺失、编码错误 | optional unknown field 可 warning；record identity 缺失不允许 |
| 3 | Source normalization | adapter records | normalized SourceRecord | 上阶段 key + normalization version | 无法规范 type/stat/slot/number、静默丢弃字段 | optional metadata 可 unresolved；identity/mechanics core 不允许 |
| 4 | Identity mapping | SourceRecords + ID registry + exceptions | IdentityMatch + grouped EntityDraft | normalized hash + registry/exception hash | non-unique match、orphan base species、stable ID collision | core entity 不允许；明确 excluded/non-product record 可 quarantine |
| 5 | Candidate collection | EntityDraft + normalized records | FieldCandidate sets + ValueProvenance | mapping hash + priority config | fieldPath 非法、candidate 无 source | optional field允许空候选 |
| 6 | Conflict detection / canonical merge | candidates + priorities + overrides | canonical draft + ConflictRecords | candidate/override/schema hash | blocking conflict、override 无 rationale、候选选择不确定 | 仅模型允许 unknown 的字段可保留 unresolved |
| 7 | Canonical validation | canonical draft + schemas + registry | validated canonical graph | canonical semantic hash + validator version | schema、identity、reference、mechanics 等失败 | 按字段/领域政策；见 Conflicts |
| 8 | Regression fixtures | validated graph + fixture expectations | fixture results | canonical hash + fixture version | 任一永久 fixture invariant/snapshot 失败 | 不允许绕过；fixture 可显式断言 expected unresolved |
| 9 | Runtime emission | validated graph + localization | staged runtime JSON | canonical hash + emitter version | nondeterministic serialization、文件清单不符 | 只输出已允许的 unresolved 状态 |
| 10 | Manifest / reports / publish | staged JSON + source manifest + validation | runtime manifest、reports；原子更新 `public/data` | content hashes | report 不完整、staged output 与 manifest hash 不符 | release policy 不满足则不 publish |

### 3.1 Cache key

每一阶段的 cache key 至少包含：

- 固定输入文件 hashes；
- source-lock、curated inputs、ID registry hashes；
- schema version；
- adapter/stage implementation version（可由 converter source tree hash 得到）；
- 上一阶段 semantic/content hash。

cache 只优化速度，不能成为唯一数据来源。`--no-cache` 运行必须产生相同输出。

### 3.2 Publish 原子性

runtime 先写入 `generated/` 下的新 staging 目录，完成所有 validation 和 hash 检查后才整体替换 `public/data`。失败不能留下“部分文件来自新数据、部分来自旧数据”的混合状态。实现时在 Windows 上采用同一文件系统内的安全目录切换方案，并在替换前校验目标路径。

## 4. Adapter Responsibilities

Adapter 的边界是“来源 schema → 有来源定位的 SourceRecord”。它不能选择 source priority、分配最终 ID 或写 runtime JSON。

### 4.1 ShowdownAdapter

职责：

- 读取固定 snapshot 的 Dex 结果或已确认的 TypeScript data exports；
- 暴露 Species/Form、Ability、Move、Type、Nature 和基础 evolution source records；
- 保留 Showdown object key、原始 status、baseSpecies/form relations 和 field locators；
- 明确区分 source literal 与 Dex-derived field。

不得：把 CAP 自动纳入主 namespace、把 `isNonstandard` 直接转换成删除、序列化 callbacks，或决定中文/Excel 冲突。

### 4.2 PokemonDatasetZhAdapter

职责：

- 读取固定 SHA 的 JSON，而不是运行 crawler；
- 输出 Species localization、form candidates、GrowthRate raw value、Ability/Move localization、evolution raw text 和 regional dex candidates；
- 保留原文件 path、JSON Pointer、原始中文文本和显示字符串；
- 区分总表与详情文件，缺详情只作为 coverage 信息。

不得：把 `home_images` 当 Form identity、把 708 行 Hisui 直接当单一 Dex，或用中文名去重 Ability/Move。

### 4.3 ExcelValidationAdapter

职责：

- 只读打开固定 hash 的 Excel；永不调用 save；
- 输出验证候选和 legacy locators（sheet/cell/row）；
- 区分公式文本、缓存值和原始静态值；
- 仅抽取当前 validation 需要的范围，不把整张工作簿镜像成中间 JSON。

它默认不是 canonical selector。Excel 值与主来源不一致时生成 candidate/conflict，不修改 Excel。

### 4.4 LocalCuratedAdapter

职责：

- 解析 ID registry、mapping exceptions、overrides、tags 和 verified dex scopes；
- 验证每个手工记录包含 rationale、状态和必要 source refs；
- 把 curated 规则转换成与其他来源一致的 records/candidates。

它不能允许任意字段通过无 schema JSON 注入。override 只能作用于明确允许的 entity/field，并必须留下 manual provenance。

### 4.5 Adapter contract

所有 Adapter 输出都必须包含：sourceRecordId、source kind/version、source locator、entity kind hint、upstream identity anchors、payload、adapter warnings。canonical model 和 UI 不得引用 `pokedex_id`、`baseStats` 的上游拼写差异、Excel 列号等 adapter 细节。

## 5. Intermediate Build Model

需要 build-time intermediate model，但保持四个最小概念，不为每个 primitive 嵌套多层 wrapper。

### 5.1 SourceRecord

Adapter/normalization 的记录级输出：

- `sourceRecordId`；
- `entityKindHint`；
- `upstreamKey` 与 identity anchors（官方编号、英文名等）；
- normalized payload；
- `sourceReferenceId`。

它是 source-neutral pipeline contract，但仍未取得项目 stable ID。

### 5.2 IdentityMatch

记录一个 SourceRecord 如何连接项目实体：

- `sourceRecordId` → `entityId`；
- `mappingClass`: automatic/rule-based/manual-exception/unresolved；
- rule/exception ID；
- match anchors；
- status: matched/excluded/quarantined/unresolved。

### 5.3 EntityDraft

只保存 `entityId`、entity kind、关联 SourceRecord IDs 和待合并字段集合。它避免在每个 stage 复制完整 canonical entity，也不进入 runtime。

### 5.4 FieldCandidate

仅为需要 selection/provenance 的 canonical field 建立：

- `entityId`、RFC 6901 fieldPath；
- normalized value 或 long-value hash；
- sourceReferenceId；
- mapping class/rule；
- candidate status。

字段只有一个可靠 source 时仍产生一条轻量 provenance，但 pipeline 不需要把 `number` 包成十层对象。ConflictRecord 与 selected canonical value 分开保存。

不再增加 `CanonicalCandidate` 或通用 event-sourcing 层；上述四个概念足以支持多来源、mapping、selection 和 audit。

## 6. Stable ID Registry

推荐 **B：确定性自动 proposal + version-controlled curated registry/exception**。

完全手写容易漏新增；完全代码规则无法抵抗 upstream rename、form remodel 和 one-off cosmetic。正常 release build 只读 registry；发现新 entity 时输出 proposal 并阻止发布。开发者使用显式 future command 接受 proposal，审查 Git diff 后更新 registry。

### 6.1 Registry record

每条记录最少包含：

- entity kind、project stable ID；
- immutable identity anchors：National Dex/official number 等；
- current external IDs，例如 Showdown ID；
- status: active/retired/quarantined；
- firstSeen/lastSeen source version（使用 SHA，不使用时间作为 identity）；
- migration aliases（旧项目 ID → current ID）；
- optional note/exception link。

### 6.2 分配规则

- Species：`species:<4-digit-national>`；
- Ability/numbered Move：official number；
- Form：Species ID + project-owned form token；
- Appearance：Species + project-owned aspect tokens；
- unnumbered Move/Dex：经过 review 的 project token；
- Evolution ID 由稳定 source/target/method token proposal；
- 不使用随机 UUID、数组 index 或中文名。

### 6.3 Rename/add/remove

- **upstream rename**：同一 official anchor/已确认 entity 保持 local ID，只更新 external ID；报告 `renamed`。
- **added**：生成 deterministic proposed ID；未审查 registry diff 前不发布。
- **removed**：registry record 标为 retired 或 missing-upstream，不能自动删除；报告 references 与 availability 影响。
- **local ID migration**：旧 ID 放入 registry alias，转换器验证没有 runtime 输出继续使用旧 ID。

任何同一 anchor 映射多个 active local IDs、或多个 source records 非唯一竞争同一 Form，都属于 blocking。

## 7. Curated Inputs

最小集合为五个文件；不机械拆成每领域一个 override 文件。

| File | Purpose | Why separate |
| --- | --- | --- |
| `id-registry.json` | stable IDs、external IDs、retired status、migration aliases | identity 生命周期独立且必须高可见 diff |
| `mapping-exceptions.json` | Arceus、Embody Aspect、无编号 Move 等非通用连接 | mapping 例外不同于字段 override |
| `overrides.json` | growthRate、availability、已裁决 field conflict 等少量 override | 用受限 fieldPath 合并；暂不单建 growth 文件 |
| `tags.json` | TagDefinition、assignment、rationale | 项目分类是一项独立 curated domain |
| `dex-scopes.json` | 已验证 Dex game/version/subdex/scope 与 raw segment mapping | scope 复杂，不能塞入通用 override |

不单建 `id-aliases.json`：migration alias 属于 registry。不单建 `growth-rate-overrides.json`：当前数量很小，放在受 schema 限制的 `overrides.json`。当任一文件明显变大或需要独立 reviewer 时再拆分。

所有 curated record 必须有 stable record ID、rationale、status、source evidence 和 review metadata。禁止用通用“ignore error”开关。

## 8. Source Manifest

需要区分“预期锁定输入”和“本次实际读取结果”。

### 8.1 `data-source/source-lock.json`（tracked input）

对 Git upstream 保存：

- source name、repo URL；
- full SHA；
- acquisition mode（external sparse/cache）；
- selected paths/globs；
- expected hashes 或 tree/file manifest hash；
- license/NOTICE reference。

对 Excel 保存：

- project-relative path；
- SHA-256；
- exact byte size；
- mtime（审计信息，不作为内容 identity）；
- read-only policy。

### 8.2 Generated source manifest

verify stage 生成 `generated/run-metadata/source-manifest.json`，记录实际 resolved paths、每个输入 hash、adapter version 和 retrieval observation。它必须与 source lock 对比。

为保持 determinism，runtime `manifest.json` 只保存 source name、full SHA/content hash、schema version、data content hash 和 notices；不保存 `retrievedAt`。真实 `retrievedAt` 仅进入 ignored run metadata 或 CI artifact。这样既能回答“来自哪一份上游”，又不会让相同输入每天产生不同 runtime bytes。

selected paths 应足够精确，便于审核 source scope；目录遍历得到的文件清单必须稳定排序并纳入 manifest hash。

## 9. Provenance

### 9.1 SourceReference ID

使用 deterministic content-derived ID：

```text
src:<source-short-name>:<sha256(canonical(source|version|path|locator))[0..15]>
```

hash 前的组件以 UTF-8、LF、固定 key order 序列化；生成后做 collision check。不得使用自增序号或随机 ID。

### 9.2 Field path

`entityId` 单独保存；`fieldPath` 使用 RFC 6901 JSON Pointer，相对于 canonical entity，例如：

- `/baseStats/atk`
- `/abilities/0/abilityId`
- `/growthRate/id`
- `/localization/zh-CN/name`

数组若有稳定业务 key，provenance 尽量引用规范排序后的 index，并同时保存 element identity；避免依赖不稳定 source row order。

### 9.3 Locator

locator 使用判别对象而不是脆弱字符串：

- Showdown/object：path、export/object name、key、field path；
- JSON：path + JSON Pointer；
- Excel：path + sheet + cell/range + view（formula/cached/static）；
- curated：path + JSON Pointer + curated record ID。

### 9.4 Raw values

- 短 scalar、小对象/数组：保存 normalized raw value，方便报告。
- 长文本：保存 SHA-256、byte length、encoding 和 locator，不在 provenance 复制全文。
- 图片/binary：本项目当前不读取；未来只存 hash/locator，绝不内嵌。
- 敏感或许可证未确认长文本：只存 hash 与 source reference。

### 9.5 File split

```text
generated/provenance/
  source-references.ndjson
  identity-matches.ndjson
  species.ndjson
  forms.ndjson
  abilities.ndjson
  moves.ndjson
  localization.ndjson
  relations.ndjson
```

NDJSON 每行一条、按 entityId + fieldPath + sourceReferenceId 排序，便于流式处理和局部 diff。`reports/data-build/` 只保存小型 summary/conflicts/validation/change reports，不复制所有 provenance。

## 10. Conflicts

### 10.1 ConflictRecord

最小字段：conflictId、entityId、fieldPath、candidate summaries、severity、status、selected candidate、resolution method、rationale、source refs、related exception/override。

| Severity | Meaning | Examples | Release behavior |
| --- | --- | --- | --- |
| `info` | 已知、无数据风险的归一化差异 | 全半角、已确认 alias、重复验证值 | 记录，不阻止 |
| `warning` | optional/展示字段缺失或不一致 | 中文长描述缺失、optional height 不一致 | 可发布，但 summary 非零 |
| `error` | 影响一个可隔离实体/领域，不能悄悄进入 runtime | 未确认 Dex scope、可选 domain entity 不完整 | strict release 阻止相关 dataset；只有显式 quarantine 才允许其他领域继续 |
| `blocking` | 破坏全局 identity/reference/canonical mechanics | Species identity 冲突、orphan、Form 非唯一、source hash 不符、stable ID collision | 不生成/不 publish runtime |

### 10.2 MappingException

MappingException 是 reviewed input，不是运行时自动产生的冲突：exceptionId、source selector、target entity、mapping class、reason、source evidence、review status、适用 upstream version/range、recheck policy。

上游 source key 改变或 fixed SHA 超出 exception 适用范围时，该 exception 不能静默继续使用，必须变成 review-required error。

### 10.3 Allowed unresolved

可进入 runtime：

- data model 明确允许 unknown 的 GrowthRate（Raging Bolt）；
- optional description/height/weight 等缺失，并标 `partial`；
- availability detail unknown，但 entity identity/mechanics 已可靠；
- 产品允许显示“待确认”的非引用字段。

不得进入 runtime：

- Species/Form/Ability/Move identity 未确定；
- non-unique form mapping、stable ID collision；
- orphan reference；
- required types/baseStats/ability slots 不完整；
- source fingerprint 不符；
- official number 重复未解释；
- 要发布的 Dex scope 未确认；
- schema invalid 或 provenance 缺失；
- mechanics conflict 无选择策略且字段不允许 unknown。

Hisui 可保持 build-time quarantined，因而不输出该 Dex，但不能把 708 行猜成 runtime entries。Nihil Light 在其 mechanics 未裁决前应从当前 target runtime scope 排除或阻止 Move dataset 发布，不能仅用 warning。

## 11. Validation

把 data-model validation rules 分为八类，每类未来都有 machine-readable result 和 tests。

| Category | Checks | Future test method |
| --- | --- | --- |
| Schema validation | source lock、curated files、intermediate records、canonical entities、reports、runtime JSON | runtime schema `safeParse`；invalid fixtures；全输出再读回 |
| Identity validation | ID format/uniqueness、positive National Dex、official number、registry lifecycle、rename/add/remove | table-driven unit tests + registry diff tests |
| Reference integrity | Species→Form、Form→Ability/Item/Move、Evolution、DexEntry、localization/tag refs | 构建全局 ID sets 后 graph scan；orphan fixture 必须失败 |
| Source consistency | pinned hashes、三源编号/英文名、selected path completeness、adapter coverage | manifest verification + cross-source comparison tests |
| Mechanical consistency | types、stats ranges、ability slots、accuracy semantics、growth formulas、form requirements | domain validators + known examples + Excel independent checks |
| Localization completeness | required zh-CN names、duplicate display names允许、description coverage 分级 | locale key set comparison；missing required name blocking |
| Provenance completeness | 每个 selected canonical field 有 source/method，manual 值有 rationale | canonical field traversal 与 provenance index 对比 |
| Regression fixtures | 12 个复杂案例及 expected unresolved | Node test runner invariant tests + small deterministic snapshots |

Validation report 包含 validator ID、entity/field、severity、message、source refs 和 suggested next action。测试失败不能通过删 fixture、降低 severity 或过滤记录来“变绿”。

## 12. Schema Strategy

### 12.1 比较

| Option | Strength | Weakness | Decision |
| --- | --- | --- | --- |
| A. TypeScript types only | 无额外 runtime dependency，开发体验好 | 读入 JSON/Excel/upstream 时没有运行时保证 | 不足 |
| B. JSON Schema only | 跨语言、可验证生成 JSON | TypeScript 使用体验差，容易手写 schema/type 漂移 | 不推荐作为唯一来源 |
| C. TypeScript + runtime schema library | 单一 schema 可运行验证并推导 TS 类型，适合 build-time 边界 | 增加一个小型 dev dependency；需防止打进浏览器 | **推荐** |
| D. TypeScript + generated JSON Schema | 适合对外 contract | generator 配置和 TS 特性兼容增加复杂度 | 将来需要外部 contract 时再加 |

推荐 C，并优先评估 **Zod 作为 dev/build-time schema source**：它能在 Adapter/curated/runtime emission 边界运行解析，并从 schema 推导 TypeScript 类型，学习和维护成本适合小型项目。它只应作为 `devDependency`，Node pipeline import schema value；前端只 `import type` 推导出的类型，禁止在 UI 代码中 value-import Zod schema，因此不会进入浏览器 bundle。

本阶段不安装库。实施前应确认当时版本、Node 24/TypeScript 支持和 lockfile 变化；如果 Zod 的实际依赖/构建影响不符合要求，再比较更小的 runtime schema library。不要同时引入 Zod、AJV、TypeBox 多套体系。

若未来必须向其他工具发布 JSON Schema，可从同一 canonical schema 生成并把生成物放到 `schemas/generated/`，禁止手工同时维护第二份真相。

## 13. Runtime/Build-time Boundaries

### 13.1 浏览器可用

- `src/lib/data-model/` 导出的纯类型、ID type helpers（无 Node side effect）；
- `src/lib/domain/` 的纯函数：属性倍率、成长经验、能力值等；
- `public/data/` canonical JSON；
- 小型 runtime loader/index。

### 13.2 Node build-time only

- `scripts/data/adapters/`：fs、Git、Excel、TypeScript VM/Dex parsing；
- acquisition/cache/source verification；
- normalization/mapping/merge/provenance/conflict；
- schema validation value imports；
- reports、registry proposal 和 runtime emission。

### 13.3 Boundary enforcement

- `src/` 不得 import `scripts/`；
- UI 只可 `import type` canonical schema types；
- Node-only modules必须位于 `scripts/data/`；
- Vite bundle 检查不得出现 `node:fs`、Git、openpyxl、Showdown 或 schema library runtime；
- pipeline 不 import Svelte components。

Python/openpyxl 只属于 Excel adapter subprocess 或独立只读 helper；canonical mapping 仍由 TypeScript pipeline 统一调度，避免两套 priority/ID 逻辑。

## 14. Runtime Emission

遵循 data-model logical layout，但第一次正式版本分阶段输出。

### 14.1 第一批目标文件

- `manifest.json`；
- `core/types.json`、`core/natures.json`；
- `core/species.json`、`core/forms.json`；
- `core/abilities.json`；
- `localization/zh-CN.core.json` 与 `zh-CN.abilities.json`（在中文 mapping slice 完成后）。

延后：Appearance 全量、Move full mechanics/description、Evolution、Dex/DexEntry、encyclopedia、learnsets、images。

### 14.2 Serialization rules

- UTF-8 without BOM；
- LF line endings；
- trailing newline；
- schema-defined object key order；未知 key 禁止输出；
- entity arrays stable sort；map/object dynamic keys lexicographic sort；
- 每个 entity 可压成单行、外层数组分行，兼顾体积和 Git diff；
- 不做自定义二进制压缩，不把 gzip 文件作为 canonical source；以后由 production packaging 测量决定压缩；
- 不输出 `undefined`、NaN、Infinity 或含义不明 null。

### 14.3 Stable sort

- Species：nationalDexNumber；
- Form：speciesId、base first、formId；
- Appearance：speciesId、formId、appearanceId；
- Ability/Move：officialNumber（null last）、stable ID；
- Type/Nature/Growth/Tag：stable ID；
- Evolution：source ID、target ID、evolutionId；
- DexEntry：dexId、normalized regional sort key、speciesId、formId；
- localization：entity ID。

Ability slots 固定 `0, 1, H, S`；types 的展示/机械顺序使用 canonical source order并验证；无序 tag/alias/source sets 词法排序；AND conditions 按规范 kind/payload 排序。不能依赖 filesystem、Git tree、JSON object 原始遍历或 Excel row discovery 顺序。

Runtime `manifest.json` 保存 schemaVersion、dataVersion/content hash、file hashes、source fingerprints 和 notice refs。`dataVersion` 应来自内容或 reviewed release version，不使用当前时间。

## 15. Determinism

Byte-stable 输出要求：

1. 所有 upstream 由 full SHA/hash lock；
2. selected files 清单稳定排序并校验 hash；
3. curated inputs 也纳入 content hash；
4. stable ID 只来自 registry/确定性规则；
5. 不使用 UUID/random、数组 index、OS 路径或当前时间生成 identity；
6. normalization 不依赖 locale-sensitive sort，使用明确 Unicode/code-point 或 ASCII ID comparator；
7. object key order、array order、number/string formatting固定；
8. canonical JSON 不含 `retrievedAt`、absolute cache path、machine username、mtime 等运行环境信息；
9. line endings固定 LF，避免 Windows checkout 改写 generated bytes；
10. 同一输入连续运行两次，对每个 runtime 文件逐字节比较；
11. `--no-cache` 与 cached run 的文件 hashes 必须一致；
12. manifest 的 file hash 在写入后重新读取验证。

`retrievedAt`、耗时、cache hit 等只写 ignored `generated/run-metadata/`，不进入 deterministic reports/runtime。Reports 若要跟随数据 checkpoint，也必须使用 source SHA、内容 hash 和稳定排序，不写墙上时钟。

## 16. Incremental Updates

一次上游升级不是“重新生成后看有没有报错”，而是多层 diff：

```text
old source-lock → proposed new SHA
  → selected upstream file/tree diff
  → parsed SourceRecord diff
  → identity/registry diff
  → FieldCandidate diff
  → canonical semantic diff
  → runtime byte diff
  → conflicts/validation/regression reports
```

### 16.1 Change classification

| Change | Detection |
| --- | --- |
| added | 新 source record/official anchor；生成 proposed stable ID |
| removed | 旧 registry external mapping 在新 source 缺失；先标 retired candidate，不自动删 |
| renamed | 同 official/stable anchor，external ID或 canonical English name变化 |
| changed mechanics | 同 stable entity 的 types/stats/slots/move fields 等 candidate/canonical field diff |
| changed localization | locale candidate text/hash diff，不混作 mechanics diff |
| new unresolved | 原自动/已解决 mapping 变为 non-unique、missing 或 conflict |

### 16.2 Update workflow

1. 人工修改 source-lock 的 proposed SHA；
2. acquire 到项目外 cache 并 verify selected paths；
3. 生成 `upstream-changes.json`；
4. 运行 adapters/normalization，比较 SourceRecords；
5. registry 识别 add/remove/rename，并输出 proposal，不自动改 local IDs；
6. 比较 candidates 与 canonical fields；
7. 生成 mechanics/localization/identity/unresolved 分组报告；
8. 运行所有 validators 和永久 fixtures；
9. 审查 mapping exceptions/overrides 是否仍适用；
10. 只有审查通过才更新 registry、runtime data 和 deterministic reports。

报告必须明确 old/new SHA、added/removed/renamed 数量、字段 diff、new/resolved conflicts。Git diff 继续作为最终人工审查层，但不能替代 semantic diff。

## 17. Regression Fixtures

Fixtures 保存最小 source snippets/expected canonical invariants 或固定 snapshot selectors，不复制全量上游。每个 fixture 都必须长期保留。

| Fixture | Required assertions |
| --- | --- |
| Charizard | 一个 Species；base/Mega X/Mega Y/G-Max 四 Form；required items；G-Max 可共享 base stats；stable IDs不随中文名变 |
| Rotom | base + 五 appliances；共享 stats 不合并 Form；types 和 changesFrom正确 |
| Arceus | type forms、requiredItems、中文 forms 缺失时 exception；home_images 不生成 identity |
| Zygarde | 50/10/Complete；Complete battleOnly + requiredAbility + multiple changesFrom；上游 form count change 被报告 |
| Ogerpon | 四 mask + Tera battle forms；item/ability/Tera requirement；同一 Form多 traits |
| Meowstic | male/female stats 相同但 ability slot不同，必须是两个 Form |
| Unown | 一个 mechanics Form + glyph Appearances；cosmetic 不复制 stats |
| Alcremie | base/G-Max Form；9×7 Appearance；Showdown cream ID不能一对一覆盖63组合 |
| Eevee | 八 evolution branches；Partner Form growth override；普通进化边不错误应用 Partner |
| Milcery | spin/direction/duration/held sweet 条件；resultAppearanceId；raw fallback 不丢 |
| Raging Bolt | Species/Form identity成功；GrowthRate unresolved 被允许且 provenance完整；不得猜值 |
| Hisui Dex | 708 rows 不输出单一 Dex；242 unique/body/form duplicates被识别；scope unresolved/quarantine 报告存在 |

Fixture tests 分为 invariants（推荐、稳定）和小型 snapshots（仅用于结构/serialization）。上游升级时只有确认语义改变后才更新 snapshot；不能以“上游变了”为理由自动接受所有 diff。

## 18. First Implementation Slice

第一份代码应构建**可运行但不发布正式数据的 Showdown smoke pipeline**。

### 18.1 Scope

实现：

- `source-lock.json` 的 Showdown fixed SHA/path verification；
- ShowdownAdapter 最小读取；
- runtime schema strategy 和 shared ID types；
- Type 与 Nature 全量 normalization；
- fixture selection 中的 Species/Form：Charizard、Rotom、Meowstic；
- 上述 Forms 引用的 Ability identity；
- ID registry proposal/read-only resolution；
- SourceReference、IdentityMatch、最小 ValueProvenance；
- schema/identity/reference/mechanical validation；
- deterministic smoke JSON 与 validation report，输出到 `generated/smoke-runtime/`，不写 `public/data/`。

暂不实现：中文仓库、Excel adapter、Move full mechanics、GrowthRate、Appearance 全量、Evolution、Dex、encyclopedia、images、正式 runtime publish。

### 18.2 Acceptance criteria

1. source SHA/path 不匹配时立即失败；
2. 只使用项目外 upstream cache；
3. 生成 Type、Nature、三个 fixture Species及其 Forms、引用 Ability identity；
4. Charizard、Rotom、Meowstic invariants 通过；
5. CAP/负编号不会取得主 namespace Species ID；
6. 所有引用和 selected fields 有最小 provenance；
7. 同一输入连续两次输出 hashes 完全一致，cached/uncached 一致；
8. 人为制造 orphan、duplicate ID 或 non-unique Form 时测试失败；
9. Node/fs/Showdown/schema validation runtime 不进入 Vite browser bundle；
10. `npm run check`、相关 converter tests 和 `npm run build` 全部通过；
11. 不修改 Excel、不生成 production JSON、不需要 Svelte UI 改动。

这个 slice 证明 pipeline 边界、stable IDs、validation、provenance 和 determinism。通过后再接中文 localization，而不是直接扩大到全量 Move/Evolution/Dex。

## 19. Open Questions

- Zod 的最终版本和 scripts 执行方式需在实施时确认；本阶段不添加依赖。
- 完整 provenance 是仅本地/CI artifact，还是每个正式数据 release 另行归档，需要在首次发布前决定。
- `reports/data-build/` 哪些 deterministic summary 跟随 runtime commit：建议至少 source、conflict、validation 和 change summary。
- first production target 的 game/generation/availability policy 尚未定，会影响 Past/Future/Unobtainable emission。
- Nihil Light mechanics 冲突解决前，Move dataset 的 strict release policy仍需确认。
- Hisui scope 的恢复流程与证据来源尚未设计完成；当前保持 quarantine。
- 中文百科长文本许可证/再分发策略未解决，不进入 converter early slices。
- Windows 原子 publish 的具体实现需在 skeleton 阶段用临时目录测试，不应假设 rename 总是成功。
- 是否提交 `public/data` generated JSON：推荐提交以便 Git review 和离线构建，但首次正式生成前再确认仓库体积。

## 20. Recommended Next Step

已经适合开始 converter skeleton，但下一阶段应严格限定为 First Implementation Slice：

1. 先创建目录、source-lock/curated schema 和 smoke fixtures；
2. 只引入一套小型 runtime schema 方案；
3. 完成 Showdown verify → adapter → normalize → map → validate → smoke emit 的单源闭环；
4. 证明失败不会更新 `public/data`，且相同输入 byte-stable；
5. 为 Charizard、Rotom、Meowstic 和非法/orphan cases 建立自动测试；
6. checkpoint 后再规划中文 localization slice。

不要在 skeleton 阶段同时加入 Excel、中文仓库、Move full mechanics、Evolution、Dex 或 UI。先让最小 pipeline 的边界、审计和 determinism 真实可靠，再扩展数据领域。
