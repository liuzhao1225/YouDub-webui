import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, target) => { const path = relative(root, target); return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) }

// Read the original archive directly. This does not extract or rewrite vendor files.
export function verifySourceArchive({ manifestPath, sourcePath, archivePath, buildPath }) {
  return JSON.parse(execFileSync('python3', ['-c', String.raw`
import hashlib,json,os,pathlib,sys,tarfile
m=json.loads(pathlib.Path(sys.argv[1]).read_text()); root=pathlib.Path(sys.argv[2]); archive=pathlib.Path(sys.argv[3])
with archive.open('rb') as stream:
    h=hashlib.file_digest(stream,'sha256').hexdigest()
if h!=m['archiveSha256']:raise RuntimeError('Official baseline archive SHA-256 changed')
roots=[root]+([pathlib.Path(sys.argv[4])] if len(sys.argv)>4 else [])
count=0
with tarfile.open(archive,'r:gz') as tar:
    members={x.name.rstrip('/'):x for x in tar.getmembers()}
    expected={e['path'] for e in m['entries']}
    actual=set()
    for directory,dirs,files in os.walk(root,followlinks=False):
        for name in files+[name for name in dirs if (pathlib.Path(directory)/name).is_symlink()]:
            actual.add(str((pathlib.Path(directory)/name).relative_to(root)))
    if actual!=expected:raise RuntimeError('Vendor file inventory changed: '+str(sorted(actual^expected)[:5]))
    missing=expected-members.keys()
    if missing:raise RuntimeError('Not in official archive: '+next(iter(missing)))
    for name,member in members.items():
        if name not in expected:continue
        original=hashlib.sha256(tar.extractfile(member).read()).hexdigest() if member.isfile() else None
        for current in roots:
            p=current/name
            if member.issym():
                if not p.is_symlink() or os.readlink(p)!=member.linkname:raise RuntimeError('Source symlink mismatch: '+str(p))
            elif member.isfile():
                if p.is_symlink() or not p.is_file():raise RuntimeError('Missing source file: '+str(p))
                if hashlib.sha256(p.read_bytes()).hexdigest()!=original:raise RuntimeError('Source bytes changed: '+str(p))
                if bool(p.stat().st_mode & 0o111)!=bool(member.mode & 0o111):raise RuntimeError('Source executable bit changed: '+str(p))
            else:raise RuntimeError('Unexpected archive member: '+name)
        count+=1
    for name,member in members.items():
        if member.isdir():continue
        if any(name==p or name.startswith(p+'/') for p in m['includedPaths']) and name not in expected:
            raise RuntimeError('Selected upstream file missing from manifest: '+name)
print(json.dumps({'passed':True,'files':count,'sourceTrees':len(roots),'archiveSha256':h,'commit':m['commit']}))
`, manifestPath, sourcePath, archivePath, ...(buildPath ? [buildPath] : [])], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
}

/** Check final App bytes against the actual outputs of the unchanged source build. */
export async function checkSourceRuntime({ appRoot, sourceBuild, manifest, forbiddenRoots = [] }) {
  appRoot = await realpath(appRoot)
  sourceBuild = await realpath(sourceBuild)
  const packages = new Map(manifest.packages.map(value => [value.name, value]))
  const external = new Map((manifest.externalPublishedPackages ?? []).map(value => [value.name, value]))
  const findings = [], files = [], links = [], installed = []
  const textExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sh', '.html', '.plist', '.command'])
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = relative(appRoot, path)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isSymbolicLink()) {
        const target = await readlink(path)
        links.push({ path: name, target })
        if (isAbsolute(target)) findings.push(`Non-relocatable absolute symlink: ${name} -> ${target}`)
        try { if (!inside(appRoot, await realpath(path))) findings.push(`Symlink leaves App: ${name} -> ${target}`) }
        catch (error) { if (error.code === 'ENOENT') findings.push(`Broken symlink: ${name} -> ${target}`); else throw error }
      } else if (entry.isFile()) files.push(path)
      else findings.push(`Unsupported App entry: ${name}`)
    }
  }
  await walk(appRoot)
  for (const path of files) {
    const name = relative(appRoot, path)
    if (textExtensions.has(extname(path)) || name.startsWith(`Contents${sep}MacOS${sep}`)) {
      const body = await readFile(path)
      // Native executables are verified by the packager's signature/inventory.
      if (!body.subarray(0, 4096).includes(0)) {
        const text = body.toString('utf8')
        for (const root of forbiddenRoots) if (text.includes(root)) findings.push(`External build path in runtime file: ${name}: ${root}`)
        if (/\/Users\/[^\s"'`]+\/\.codex\/worktrees\//u.test(text)) findings.push(`Codex worktree path in runtime file: ${name}`)
        if (text.includes('/Applications/DeepSeek Harness.app')) findings.push(`Installed Harness dependency in runtime file: ${name}`)
      }
    }
    if (path.endsWith(`${sep}package.json`) && name.split(sep).includes('node_modules')) {
      const value = JSON.parse(await readFile(path, 'utf8'))
      if (typeof value.name !== 'string' || !value.name.startsWith('@deepseek-ai/')) continue
      const source = packages.get(value.name), published = external.get(value.name)
      const record = { name: value.name, version: value.version, path: relative(appRoot, dirname(path)), matchedFiles: 0 }
      installed.push(record)
      if (!source) {
        record.origin = 'external-published'
        if (!published?.artifacts.some(artifact => artifact.version === value.version)) findings.push(`No preserved source or external provenance: ${value.name}@${value.version}`)
        continue
      }
      record.origin = 'source-build'
      if (source.version !== value.version) findings.push(`Source version differs: ${value.name}: ${value.version} != ${source.version}`)
      const packageRoot = dirname(path)
      const descendants = files.filter(file => file.startsWith(`${packageRoot}${sep}`) && !relative(packageRoot, file).split(sep).includes('node_modules'))
      for (const file of descendants) {
        const local = relative(packageRoot, file)
        if (local === 'package.json') continue // Official pack rewrites workspace dependency specifications.
        const built = join(sourceBuild, source.path, local)
        try {
          if (digest(await readFile(file)) !== digest(await readFile(built))) findings.push(`Not the source-build output: ${value.name}/${local}`)
          else record.matchedFiles++
        } catch (error) {
          if (error.code === 'ENOENT') findings.push(`No source-build output: ${value.name}/${local}`)
          else throw error
        }
      }
      if (!record.matchedFiles) findings.push(`No verified source-build payload: ${value.name}`)
    }
  }
  for (const required of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host']) {
    if (!installed.some(value => value.name === required)) findings.push(`Missing Harness runtime package: ${required}`)
  }
  return { passed: findings.length === 0, appRoot, sourceBuild, files: files.length, links, packages: installed.sort((a, b) => a.name.localeCompare(b.name)), findings }
}

async function main() {
  const { values } = parseArgs({ options: {
    app: { type: 'string' }, 'source-build': { type: 'string' }, 'source-only': { type: 'boolean' }, report: { type: 'string' },
  } })
  if (!values['source-only'] && (!values.app || !values['source-build'])) throw new Error('Usage: node apps/harness/check-source-runtime.mjs --source-only | --app <YouDub.app> --source-build <official-build-directory> [--report <json>]')
  const manifestPath = join(repository, 'vendor/deepseek-harness/source-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const sources = JSON.parse(await readFile(join(repository, 'apps/harness/baselines/sources.json'), 'utf8'))
  const original = sources.sources.find(value => value.commit === manifest.commit)
  if (!original) throw new Error('Source commit is absent from the preserved official baseline')
  if (manifest.gitTree !== original.tree || manifest.archiveSha256 !== sources.artifacts.find(value => value.path === original.archive)?.sha256) throw new Error('Vendor provenance differs from the preserved official baseline')
  const source = verifySourceArchive({ manifestPath, sourcePath: join(repository, 'vendor/deepseek-harness/source'),
    archivePath: join(sources.baselineRoot, original.archive), buildPath: values['source-build'] && resolve(values['source-build']) })
  const runtime = values['source-only'] ? undefined : await checkSourceRuntime({ appRoot: resolve(values.app), sourceBuild: resolve(values['source-build']), manifest, forbiddenRoots: [repository, sources.originalSource.path] })
  const report = { passed: source.passed && (!runtime || runtime.passed), source, ...(runtime ? { runtime } : {}) }
  if (values.report) await writeFile(resolve(values.report), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
