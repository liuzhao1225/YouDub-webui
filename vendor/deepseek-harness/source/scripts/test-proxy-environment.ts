/** Keep local fixture requests independent of the workstation's proxy settings. */
import { PROXY_ENV_NAMES } from '../packages/util/http-proxy/src/policy.ts'

// NODE_USE_ENV_PROXY must also be unset before starting Node: its built-in fetch
// samples that flag at startup. Suites explicitly supply any proxy they test.
for (const name of [...PROXY_ENV_NAMES, 'NODE_USE_ENV_PROXY']) {
  Reflect.deleteProperty(process.env, name)
}
