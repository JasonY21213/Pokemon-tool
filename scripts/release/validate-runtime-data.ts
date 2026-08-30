import { resolve } from 'node:path'
import { validateRuntimeDataDirectory } from './runtime-data-validation.ts'

const root = resolve(import.meta.dirname, '..', '..')
const summary = await validateRuntimeDataDirectory(resolve(root, 'public', 'data'), resolve(root, 'data-curated', 'tags.json'))
console.log(JSON.stringify({ status: 'passed', ...summary }, null, 2))
