import { runSmokePipeline } from './pipeline.ts'

function pathArgument(args: string[], flag: '--cache' | '--zh-cache'): string | undefined {
  const index = args.indexOf(flag)
  if (index >= 0) {
    const value = args[index + 1]
    if (!value) throw new Error(`${flag} requires a directory path`)
    return value
  }
  const inline = args.find(argument => argument.startsWith(`${flag}=`))
  return inline?.slice(`${flag}=`.length)
}

const args = process.argv.slice(2)
const result = await runSmokePipeline({
  cachePath: pathArgument(args, '--cache'),
  localizationCachePath: pathArgument(args, '--zh-cache'),
})
console.log(JSON.stringify({
  status: 'passed',
  sourceCommits: result.sourceCommits,
  outputRoot: result.outputRoot,
  counts: {
    types: result.dataset.types.length,
    natures: result.dataset.natures.length,
    species: result.dataset.species.length,
    forms: result.dataset.forms.length,
    abilities: result.dataset.abilities.length,
    growthRates: result.dataset.growthRates.length,
    moves: result.dataset.moves.length,
    appearances: result.dataset.appearances.length,
    evolutions: result.dataset.evolutions.length,
    dexes: result.dataset.dexes.length,
    dexEntries: result.dataset.dexEntries.length,
  },
}, null, 2))
