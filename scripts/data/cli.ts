import { runSmokePipeline } from './pipeline.ts'

function cacheArgument(args: string[]): string | undefined {
  const index = args.indexOf('--cache')
  if (index >= 0) {
    const value = args[index + 1]
    if (!value) throw new Error('--cache requires a directory path')
    return value
  }
  const inline = args.find(argument => argument.startsWith('--cache='))
  return inline?.slice('--cache='.length)
}

const result = await runSmokePipeline({ cachePath: cacheArgument(process.argv.slice(2)) })
console.log(JSON.stringify({
  status: 'passed',
  sourceCommit: result.sourceCommit,
  outputRoot: result.outputRoot,
  counts: {
    types: result.dataset.types.length,
    natures: result.dataset.natures.length,
    species: result.dataset.species.length,
    forms: result.dataset.forms.length,
    abilities: result.dataset.abilities.length,
  },
}, null, 2))
