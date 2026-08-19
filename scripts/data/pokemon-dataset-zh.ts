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
}).passthrough()

const AbilityListEntrySchema = z.object({
  id: z.string().regex(/^\d{3}$/),
  name_zh: z.string().min(1),
  name_en: z.string().min(1),
  description: z.string(),
  generation: z.number().int().positive(),
}).passthrough()

const AbilityListSchema = z.array(AbilityListEntrySchema)

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

export interface PokemonDatasetZhAdapterOutput {
  species: ZhSpeciesLocalizationCandidate[]
  abilities: ZhAbilityLocalizationCandidate[]
}

const POKEMON_PATHS = [
  'data/pokemon/0006-喷火龙.json',
  'data/pokemon/0035-皮皮.json',
  'data/pokemon/0058-卡蒂狗.json',
  'data/pokemon/0133-伊布.json',
  'data/pokemon/0285-蘑蘑菇.json',
  'data/pokemon/0290-土居忍士.json',
  'data/pokemon/0479-洛托姆.json',
  'data/pokemon/0678-超能妙喵.json',
  'data/pokemon/1021-猛雷鼓.json',
] as const

const SMOKE_ABILITY_NUMBERS = new Set([
  14, 18, 22, 26, 27, 50, 51, 56, 66, 70, 90, 91, 94, 95, 98, 107, 132, 151, 154, 158, 172, 181, 281,
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

  return {
    species: species.sort((left, right) => left.nationalDexNumber - right.nationalDexNumber),
    abilities: abilities.sort((left, right) => left.officialNumber - right.officialNumber),
  }
}
