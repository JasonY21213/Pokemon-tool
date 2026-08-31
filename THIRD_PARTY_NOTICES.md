# Third-party data notices

Pokémon Tool 的 `public/data` 包含对以下固定上游数据进行筛选、规范化、建立稳定引用和本地化合并后得到的转换结果。此文件记录上游归属，不改变各上游项目或 Pokémon 相关权利人的许可与权利。

## Pokémon Showdown

- Repository: https://github.com/smogon/pokemon-showdown
- Pinned commit: `84d7ceb4f009928221fce7a00e711bab263c5f4e`
- Upstream license file: `LICENSE`

The MIT License (MIT)

Copyright (c) 2011-2026 Guangcong Luo and other contributors http://pokemonshowdown.com/

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## pokemon-dataset-zh

- Repository: https://github.com/42arch/pokemon-dataset-zh
- Pinned commit: `82ce04e611d19a12556c3955125b048b36187f52`
- Upstream license file: `LICENSE`

MIT License

Copyright (c) 2024 42arch

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Project-local Excel input

`data-source/Pokemon-data.xlsx` 是项目维护者提供的本地原始/历史数据源副本。它保持 Git 忽略和只读输入，只参与迁移与交叉验证，不随静态站点发布。本项目没有为该文件推断或新增许可条款。

## 神奇宝贝百科 / 52Poké Wiki Item names

- Source: [神奇宝贝百科 / 52Poké Wiki](https://wiki.52poke.com/wiki/道具列表（在其他语言中）)
- Source name: `神奇宝贝百科 / 52Poké Wiki`
- Primary table: `道具列表`；secondary `道具列表2` 仅作交叉检查，本阶段不接入其中的 Item description。
- Copy date: `2026-08-31`
- Independent manual source workbook: `data-source/52poke-item-localization.xlsx`
- Formal input: `data-curated/item-localization.json`
- Runtime output: `public/data/item-localization.json`
- Mapping boundary: existing 567 active Item registry → canonical English / Showdown ID → source English column → Simplified Chinese column → explicit owner overrides.
- Provenance mode: manual list snapshot / manually copied source. No per-Item page or revision URL is asserted.
- License: [CC BY-NC-SA 3.0](https://wiki.52poke.com/wiki/神奇宝贝百科:版权声明)

Only short Item-name localization is used from this source. Pokémon Tool is non-commercial for this integration, and this attribution does not imply endorsement by 52Poké Wiki. No Wiki images, audio, or long-form Item descriptions are used. This notice applies to the localized Item-name data boundary; it does not relicense the Pokémon Tool source code as CC BY-NC-SA 3.0.
