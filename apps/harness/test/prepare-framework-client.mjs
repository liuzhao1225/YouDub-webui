/** Prepare the product bundle once before whole-client framework tests, without starting Electron or changing a user profile. */
import { fileURLToPath } from 'node:url'
import { prepareSourceDevelopment } from '../prepare-source-development.mjs'

await prepareSourceDevelopment({
  projectDirectory: fileURLToPath(new URL('../../../.cache/harness/framework-client-project', import.meta.url)),
})
