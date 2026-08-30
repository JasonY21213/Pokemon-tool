# Pokémon Tool

Pokémon Tool 是一个以固定来源数据构建的轻量静态 Web 工具。它使用 Svelte、TypeScript、Vite 和静态 JSON，在浏览器中完成查询、计算、队伍保存和分享；运行时不需要 Node.js、后端、数据库或外部 API。

## 当前功能

- 按名称、全国图鉴编号和实际 Form 查询宝可梦，展示属性、种族值、特性、标签、进化与已知招式关联。
- 招式查询、属性相性、能力值、经验等级和第九世代限定范围的单次伤害计算。
- 本地队伍构建与客观队伍分析，使用浏览器 `localStorage` 保存，并可通过 URL 查询参数分享。
- 普通太晶与 Stellar 的已实现直接伤害交互，以及明确的未支持机制提示。

## 架构与运行边界

应用是纯静态站点。构建期管线把固定提交的上游来源、项目维护的稳定 ID/审查决策和只读 Excel 验证输入转换为 `public/data/*.json`。浏览器只加载经过裁剪的运行时 JSON，不读取 Excel、构建报告、本地文件系统或上游仓库，也不联网查询宝可梦数据。

`public/data/manifest.json` 固定运行时 schema 版本、文件清单、记录数与 SHA-256。`npm run release:integrity` 在发布前验证文件存在性、哈希、记录数及 Species、Form、Ability、Move、Item、Type、Growth Rate、Learnset、Evolution 和 Tag 引用。浏览器启动时执行较轻的版本、文件集、记录数和引用检查，避免在正常加载时重复计算所有文件哈希。

## 环境要求与安装

- Node.js 24（项目当前验证环境）和 npm。
- 仅开发、检查和构建现有运行时数据：克隆仓库后运行 `npm ci`，不需要 Excel 或上游缓存。
- 完整重新生成数据：还需要 Python 3、`openpyxl`、本地只读的 `data-source/Pokemon-data.xlsx`，以及与 `data-source/source-lock.json` 固定提交一致的上游缓存。缓存默认位于 `%LOCALAPPDATA%/pokemon-tool/upstream/`，也可使用 source lock 中记录的环境变量指定。

```bash
npm ci
```

## 开发、数据与测试

```bash
npm run dev                 # 本地开发服务器
npm run check               # Svelte 与 TypeScript 检查
npm run data:test           # 完整数据和核心逻辑测试
npm run data:runtime        # 从固定来源重新生成 public/data
npm run data:runtime:test   # 在临时目录执行两次并比较确定性输出
npm run release:integrity   # 验证当前 public/data 发布完整性
npm run release:check       # 完整发布门禁：完整测试、检查和生产构建
```

数据生成不会修改 `data-source/Pokemon-data.xlsx`。如果固定输入或缓存不完整，生成应失败并报告来源，不能猜测或静默补值。

## 生产构建与静态部署

站点根目录部署：

```bash
npm run build
```

GitHub Pages 等子目录部署应把 Vite base 设置为最终公开路径，例如：

```bash
npm run build -- --base=/Pokemon-tool/
```

将生成的整个 `dist/` 目录原样发布。不要只上传 `index.html`，也不要遗漏 `dist/data/`。站点必须通过 HTTP(S) 静态服务器访问，不能直接双击 `index.html`。应用没有客户端路由；分享队伍使用 `?team=...` 查询参数，因此刷新仍落在同一个静态入口。

## 数据来源与许可

- [Pokémon Showdown](https://github.com/smogon/pokemon-showdown/tree/84d7ceb4f009928221fce7a00e711bab263c5f4e)，固定提交 `84d7ceb4f009928221fce7a00e711bab263c5f4e`，用于规范化的宝可梦、Form、招式、特性、道具、属性和 Learnset 等数据。
- [pokemon-dataset-zh](https://github.com/42arch/pokemon-dataset-zh/tree/82ce04e611d19a12556c3955125b048b36187f52)，固定提交 `82ce04e611d19a12556c3955125b048b36187f52`，用于选定的简体中文本地化数据。
- `data-source/Pokemon-data.xlsx` 是项目原始/历史数据源副本，只用于迁移、交叉验证和审查，不是浏览器运行时输入，也不进入 Git。

上游数据已转换为本项目的稳定 ID 和运行时结构，并非上游文件的直接镜像。两个固定上游仓库在对应提交均包含 MIT License；完整归属与许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Pokémon 相关名称和商标归其各自权利人所有；本项目不声明与 Nintendo、GAME FREAK、Creatures 或 The Pokémon Company 存在官方关联。

## 已知范围限制

- Learnset 表示固定来源中跨世代出现过的已知关联，不代表当前游戏、世代、规则或个体的合法性。
- 只有明确列为“支持”的 Ability 和 Item 效果会影响伤害；未支持效果不会近似套用。
- 伤害计算器面向确定的普通单目标、单次直接伤害，不是完整战斗模拟器；动态威力/属性、扩散、多段、固定伤害等机制会明确返回不支持。
- Stellar 每种属性增伤是否已经使用必须由用户明确选择，工具不会推测战斗历史。
- 场地、天气、墙、要害、灼伤和太晶只覆盖界面明确说明的直接伤害范围，不模拟回合、状态持续、行动顺序或完整战场。
- 某些 Form、Ability 或内容本地化仍可能为空；界面保留英文规范名或“暂无”，不会猜译。
- 队伍分析只报告所选 Form、Ability 和招式产生的客观倍数与覆盖，不提供合法性判断、评分或对战建议。
