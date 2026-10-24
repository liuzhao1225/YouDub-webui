import { parse } from 'dotenv'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const signingRequire = createRequire(new URL('../apps/harness/package.json', import.meta.url))
const { sign: signElectron } = await import(pathToFileURL(signingRequire.resolve('@electron/osx-sign')))
import { readFile, mkdir, rm, symlink, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { randomBytes, createHash, X509Certificate } from 'node:crypto'
import { resolve, join, basename } from 'node:path'
import { appVersion, validateReleaseVersion } from './release-version.mjs'

const root = resolve(import.meta.dirname, '..')
if (process.env.GITHUB_REF_TYPE === 'tag') validateReleaseVersion(appVersion, process.env.GITHUB_REF_NAME)
const credentials = process.env.YOUDUB_APPLE_CREDENTIALS_DIR
if (!credentials) throw new Error('Set YOUDUB_APPLE_CREDENTIALS_DIR to the private signing directory.')
const [envFile, agentFile] = await Promise.all([stat(join(credentials, '.env')), stat(join(credentials, 'env.txt'))])
if (envFile.ino !== agentFile.ino || envFile.dev !== agentFile.dev) throw new Error('Signing .env and env.txt must be hard links.')
const secrets = parse(await readFile(join(credentials, 'env.txt')))
for (const key of ['CODESIGN_IDENTITY', 'BUILD_CERTIFICATE_FILE', 'P12_PASSWORD', 'APP_STORE_CONNECT_API_KEY_FILE', 'APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID']) {
  if (!secrets[key]) throw new Error(`Missing signing setting: ${key}`)
}
const run = (command, args, quiet = false) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })
  if (result.error) throw new Error(`${command} could not start: ${result.error.code}`)
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).${quiet ? '\n' + result.stderr : ''}`)
  return result.stdout
}
const app = resolve(process.argv[2] || join(root, 'dist/YouDub.app'))
const build = JSON.parse(await readFile(join(app, 'Contents/Resources/build.json'), 'utf8'))
if (build.version !== appVersion) throw new Error('Application bundle version differs from release version.')
if (process.env.GITHUB_SHA && build.baseCommit !== process.env.GITHUB_SHA) throw new Error('Application bundle source differs from release commit.')
const cache = join(root, '.cache/mac')
await mkdir(cache, { recursive: true })
const keychain = join(cache, `signing-${randomBytes(8).toString('hex')}.keychain-db`)
const password = randomBytes(32).toString('hex')
const originalKeychains = [...run('security', ['list-keychains', '-d', 'user'], true).matchAll(/"([^"]+)"/g)].map(match => match[1])
run('security', ['create-keychain', '-p', password, keychain], true)
try {
  run('security', ['set-keychain-settings', '-lut', '21600', keychain], true)
  run('security', ['unlock-keychain', '-p', password, keychain], true)
  run('security', ['import', join(credentials, basename(secrets.BUILD_CERTIFICATE_FILE)), '-k', keychain, '-P', secrets.P12_PASSWORD, '-T', '/usr/bin/codesign'], true)
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], true)
  run('curl', ['-fsSL', '--connect-timeout', '20', '-o', join(cache, 'DeveloperIDG2CA.cer'), 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer'])
  run('security', ['import', join(cache, 'DeveloperIDG2CA.cer'), '-k', keychain], true)
  // codesign's trust service can miss intermediates in a newly added keychain.
  // Keep Apple's public intermediate in the user's default certificate store.
  const defaultKeychain = run('security', ['default-keychain', '-d', 'user'], true).trim().replace(/^"|"$/g, '')
  const intermediate = new X509Certificate(await readFile(join(cache, 'DeveloperIDG2CA.cer')))
  const certificates = run('security', ['find-certificate', '-a', '-p', defaultKeychain], true)
  const installed = [...certificates.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .some(match => new X509Certificate(match[0]).fingerprint256 === intermediate.fingerprint256)
  if (!installed) run('security', ['import', join(cache, 'DeveloperIDG2CA.cer'), '-k', defaultKeychain], true)
  // Trust-chain lookup also uses the user search list, even with codesign --keychain.
  run('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains, keychain], true)
  run('security', ['find-identity', '-v', '-p', 'codesigning', keychain])
  const sign = file => run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--keychain', keychain, '--sign', secrets.CODESIGN_IDENTITY, file])
  if (!process.argv.includes('--package-signed')) {
    await signElectron({ app, platform: 'darwin', identity: secrets.CODESIGN_IDENTITY, keychain,
      optionsForFile: () => ({ hardenedRuntime: true }),
    })
  }
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  if (process.argv.includes('--sign-only')) {
    console.log(`Signed for launch validation: ${app}`)
  } else {
    const notarize = async (file, name) => {
      const report = join(root, `dist/${name}-notary.json`)
      const output = run('xcrun', ['notarytool', 'submit', file, '--key', join(credentials, basename(secrets.APP_STORE_CONNECT_API_KEY_FILE)), '--key-id', secrets.APP_STORE_CONNECT_KEY_ID, '--issuer', secrets.APP_STORE_CONNECT_ISSUER_ID, '--wait', '--output-format', 'json'], true)
      const { writeFile } = await import('node:fs/promises')
      await writeFile(report, output)
      const result = JSON.parse(output)
      console.log(`${name}: ${result.status} (${result.id})`)
      if (result.status !== 'Accepted') {
        run('xcrun', ['notarytool', 'log', result.id, '--key', join(credentials, basename(secrets.APP_STORE_CONNECT_API_KEY_FILE)), '--key-id', secrets.APP_STORE_CONNECT_KEY_ID, '--issuer', secrets.APP_STORE_CONNECT_ISSUER_ID, join(root, `dist/${name}-notary-log.json`)], true)
        throw new Error(`Apple notarization ${result.status}. See ${report}.`)
      }
    }
    const stage = join(root, '.cache/mac/dmg-stage')
    await rm(stage, { recursive: true, force: true })
    await mkdir(stage, { recursive: true })
    run('ditto', [app, join(stage, 'YouDub.app')])
    await symlink('/Applications', join(stage, 'Applications'))
    const dmg = join(root, `dist/YouDub-${appVersion}-macOS-arm64.dmg`)
    run('hdiutil', ['create', '-volname', 'YouDub', '-srcfolder', stage, '-ov', '-fs', 'HFS+', '-format', 'ULMO', dmg])
    sign(dmg)
    console.log('Submitting installer to Apple notarization…')
    await notarize(dmg, 'dmg')
    run('xcrun', ['stapler', 'staple', dmg])
    run('xcrun', ['stapler', 'validate', dmg])
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg])
    // Apple's DMG notarization covers its enclosed app as well.
    run('xcrun', ['stapler', 'staple', app])
    run('xcrun', ['stapler', 'validate', app])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
    const { writeFile } = await import('node:fs/promises')
    await writeFile(dmg + '.sha256', createHash('sha256').update(await readFile(dmg)).digest('hex') + '  ' + basename(dmg) + '\n')
    console.log(`Signed and notarized: ${dmg}`)
  }
} finally {
  run('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains], true)
  run('security', ['delete-keychain', keychain], true)
}
