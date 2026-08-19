import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { VerifiedSource } from './source.ts'

const PokemonFormSchema = z.object({
  name: z.string().min(1),
  types: z.array(z.string().min(1)).min(1).max(2),
  abilities: z.array(z.object({
    name: z.string().min(1),
    is_hidden: z.boolean(),
  }).strict()).min(1),
  gender_ratio: z.object({
    male: z.number().min(0).max(100),
    female: z.number().min(0).max(100),
  }).strict().optional(),
  experience_100: z.string().min(1),
}).passthrough()

const PokemonDocumentSchema = z.object({
  name_zh: z.string().min(1),
  name_en: z.string().min(1),
  pokedex_id: z.string().regex(/^\d{4}$/),
  forms: z.array(PokemonFormSchema).min(1),
  evolution_chains: z.array(z.array(z.object({
    name: z.string().min(1),
    text: z.string().nullable(),
    from: z.string().nullable(),
  }).passthrough()).min(1)).optional(),
  home_images: z.array(z.object({
    name: z.string().min(1),
    image: z.string().min(1).optional(),
    shiny: z.string().min(1).optional(),
  }).passthrough()).optional(),
}).passthrough()

const AbilityListEntrySchema = z.object({
  id: z.string().regex(/^\d{3}$/),
  name_zh: z.string().min(1),
  name_en: z.string().min(1),
  description: z.string(),
  generation: z.number().int().positive(),
}).passthrough()

const AbilityListSchema = z.array(AbilityListEntrySchema)

const MoveListEntrySchema = z.object({
  id: z.string().min(1),
  name_zh: z.string().min(1),
  name_en: z.string().min(1),
  type: z.string().min(1),
  category: z.string().min(1),
  power: z.string().min(1),
  accuracy: z.string().min(1),
  pp: z.string().min(1),
  generation: z.number().int().positive(),
}).passthrough()
const MoveListSchema = z.array(MoveListEntrySchema)

export interface ZhFormCandidate {
  nameZh: string
  typesZh: string[]
  abilitiesZh: Array<{ name: string; isHidden: boolean }>
  genderRatio?: { male: number; female: number }
  experience100Raw: string
  sourcePointer: string
}

export interface ZhSpeciesLocalizationCandidate {
  nationalDexNumber: number
  englishName: string
  chineseName: string
  forms: ZhFormCandidate[]
  sourcePath: string
  sourceReferenceId: string
  sourcePointer: string
}

export interface ZhAbilityLocalizationCandidate {
  officialNumber: number
  englishName: string
  chineseName: string
  shortDescription?: string
  generation: number
  sourcePath: string
  sourceReferenceId: string
  sourcePointer: string
}

export interface ZhMoveCandidate {
  officialNumberRaw: string
  englishName: string
  chineseName: string
  typeRaw: string
  categoryRaw: string
  powerRaw: string
  accuracyRaw: string
  ppRaw: string
  generation: number
  sourcePath: string
  sourceReferenceId: string
  sourcePointer: string
}

export interface ZhEvolutionCandidate {
  documentNationalDexNumber: number
  sourceNameZh: string
  targetNameZh: string
  rawText: string
  sourcePath: string
  sourceReferenceId: string
  sourcePointer: string
}

export interface ZhAppearanceCandidate {
  nationalDexNumber: number
  nameZh: string
  sourcePath: string
  sourceReferenceId: string
  sourcePointer: string
}

export interface PokemonDatasetZhAdapterOutput {
  species: ZhSpeciesLocalizationCandidate[]
  abilities: ZhAbilityLocalizationCandidate[]
  moves: ZhMoveCandidate[]
  evolutions: ZhEvolutionCandidate[]
  appearances: ZhAppearanceCandidate[]
}

const POKEMON_PATHS = [
  'data/pokemon/0006-喷火龙.json',
  'data/pokemon/0035-皮皮.json',
  'data/pokemon/0064-勇基拉.json',
  'data/pokemon/0065-胡地.json',
  'data/pokemon/0058-卡蒂狗.json',
  'data/pokemon/0133-伊布.json',
  'data/pokemon/0134-水伊布.json',
  'data/pokemon/0135-雷伊布.json',
  'data/pokemon/0136-火伊布.json',
  'data/pokemon/0196-太阳伊布.json',
  'data/pokemon/0197-月亮伊布.json',
  'data/pokemon/0201-未知图腾.json',
  'data/pokemon/0285-蘑蘑菇.json',
  'data/pokemon/0290-土居忍士.json',
  'data/pokemon/0479-洛托姆.json',
  'data/pokemon/0470-叶伊布.json',
  'data/pokemon/0471-冰伊布.json',
  'data/pokemon/0678-超能妙喵.json',
  'data/pokemon/0700-仙子伊布.json',
  'data/pokemon/0808-美录坦.json',
  'data/pokemon/0809-美录梅塔.json',
  'data/pokemon/0868-小仙奶.json',
  'data/pokemon/0869-霜奶仙.json',
  'data/pokemon/1021-猛雷鼓.json',
] as const

const SMOKE_ABILITY_NUMBERS = new Set([
  10, 11, 14, 18, 22, 26, 27, 28, 34, 39, 42, 50, 51, 56, 62, 66, 70, 81, 89, 90, 91, 93, 94, 95, 98, 102, 107, 115, 132, 151, 154, 156, 158, 165, 172, 175, 181, 182, 281,
])
const SMOKE_MOVE_NAMES = new Set([
  'Pound', 'Swords Dance', 'Swift', 'Tri Attack', 'Triple Kick',
  '10,000,000 Volt Thunderbolt', 'Max Flare', 'G-Max Wildfire',
  'Ivy Cudgel', 'Tera Starstorm', 'Malignant Chain', 'Nihil Light',
])

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function sourceReferenceId(source: VerifiedSource, path: string): string {
  const reference = source.localization.sourceReferenceByPath.get(path)
  if (!reference) throw new Error(`Missing pokemon-dataset-zh SourceReference for ${path}`)
  return reference.sourceReferenceId
}

export async function loadPokemonDatasetZhSource(source: VerifiedSource): Promise<PokemonDatasetZhAdapterOutput> {
  const species: ZhSpeciesLocalizationCandidate[] = []
  const evolutions: ZhEvolutionCandidate[] = []
  const appearances: ZhAppearanceCandidate[] = []
  for (const sourcePath of POKEMON_PATHS) {
    const raw = PokemonDocumentSchema.parse(await readJson(join(source.localization.cachePath, ...sourcePath.split('/'))))
    species.push({
      nationalDexNumber: Number(raw.pokedex_id),
      englishName: raw.name_en,
      chineseName: raw.name_zh,
      forms: raw.forms.map((form, index) => ({
        nameZh: form.name,
        typesZh: [...form.types],
        abilitiesZh: form.abilities.map(ability => ({ name: ability.name, isHidden: ability.is_hidden })),
        ...(form.gender_ratio ? { genderRatio: form.gender_ratio } : {}),
        experience100Raw: form.experience_100,
        sourcePointer: `/forms/${index}`,
      })),
      sourcePath,
      sourceReferenceId: sourceReferenceId(source, sourcePath),
      sourcePointer: '/name_zh',
    })
    for (const [chainIndex, chain] of (raw.evolution_chains ?? []).entries()) {
      for (const [nodeIndex, node] of chain.entries()) {
        if (!node.from || !node.text) continue
        evolutions.push({
          documentNationalDexNumber: Number(raw.pokedex_id),
          sourceNameZh: node.from,
          targetNameZh: node.name,
          rawText: node.text,
          sourcePath,
          sourceReferenceId: sourceReferenceId(source, sourcePath),
          sourcePointer: `/evolution_chains/${chainIndex}/${nodeIndex}/text`,
        })
      }
    }
    if (raw.pokedex_id === '0201' || raw.pokedex_id === '0869') {
      for (const [index, image] of (raw.home_images ?? []).entries()) {
        appearances.push({
          nationalDexNumber: Number(raw.pokedex_id),
          nameZh: image.name,
          sourcePath,
          sourceReferenceId: sourceReferenceId(source, sourcePath),
          sourcePointer: `/home_images/${index}/name`,
        })
      }
    }
  }

  const abilityPath = 'data/ability_list.json'
  const abilityRows = AbilityListSchema.parse(await readJson(join(source.localization.cachePath, ...abilityPath.split('/'))))
  const abilities = abilityRows.flatMap((row, index): ZhAbilityLocalizationCandidate[] => {
    const officialNumber = Number(row.id)
    if (!SMOKE_ABILITY_NUMBERS.has(officialNumber)) return []
    return [{
      officialNumber,
      englishName: row.name_en,
      chineseName: row.name_zh,
      ...(row.description ? { shortDescription: row.description } : {}),
      generation: row.generation,
      sourcePath: abilityPath,
      sourceReferenceId: sourceReferenceId(source, abilityPath),
      sourcePointer: `/${index}`,
    }]
  })

  const movePath = 'data/move_list.json'
  const moveRows = MoveListSchema.parse(await readJson(join(source.localization.cachePath, ...movePath.split('/'))))
  const moves = moveRows.flatMap((row, index): ZhMoveCandidate[] => {
    if (!SMOKE_MOVE_NAMES.has(row.name_en)) return []
    return [{
      officialNumberRaw: row.id,
      englishName: row.name_en,
      chineseName: row.name_zh,
      typeRaw: row.type,
      categoryRaw: row.category,
      powerRaw: row.power,
      accuracyRaw: row.accuracy,
      ppRaw: row.pp,
      generation: row.generation,
      sourcePath: movePath,
      sourceReferenceId: sourceReferenceId(source, movePath),
      sourcePointer: `/${index}`,
    }]
  })

  return {
    species: species.sort((left, right) => left.nationalDexNumber - right.nationalDexNumber),
    abilities: abilities.sort((left, right) => left.officialNumber - right.officialNumber),
    moves: moves.sort((left, right) => left.englishName.localeCompare(right.englishName, 'en')),
    evolutions: evolutions.sort((left, right) => `${left.sourceNameZh}:${left.targetNameZh}`.localeCompare(`${right.sourceNameZh}:${right.targetNameZh}`, 'zh-CN')),
    appearances: appearances.sort((left, right) => left.nameZh.localeCompare(right.nameZh, 'zh-CN')),
  }
}
