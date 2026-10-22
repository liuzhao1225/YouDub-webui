/** Analyze the retained framework slot contracts for source validation. */

import ts from 'typescript'
import {
  declaredTypes,
  indexExportedTypes,
  referencedTypeNames,
  scanSlotFiles,
  slotDeclarations,
  slotRegistrations,
  standardKitMembers,
} from './slot-walk.ts'
import type { ScannedFile, SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/** Source globs: every workspace package's sources, `.tsx` included (a contract may live in one). */
const SOURCE_GLOBS = ['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx']

/** Slot cardinalities the contract allows. */
const KINDS = ['single', 'list', 'keyed', 'chain'] as const
/** Slot data scopes the contract allows. */
const SCOPES = ['root', 'session', 'session-maybe'] as const

/** Declarations longer than this render truncated; the full shape stays in source. */
const MAX_DECL_CHARS = 1200

/**
 * Line budget for ONE slot's expanded report. The whole point of narrowing to a
 * single slot is to spend less context, so a report a model cannot finish
 * reading is a defect rather than a detail. The budget leaves room to document
 * a slot properly while catching the two ways a report runs away: an owner
 * share that hands down a subsystem instead of a share, and prose that grew
 * into a manual. Every report also lists one line per standard prop seat of its
 * scope, so the widest Session-scope slot (`tool.call.toolview`, with the
 * global and Session access seats) sets the current 122.
 */
const MAX_ENTRY_LINES = 122

/** One register-call option as the catalog teaches it. */
interface OptionDoc {
  readonly name: string
  readonly requirement: 'required' | 'optional'
  readonly type: string
  readonly doc: string
}

/**
 * Register options per cardinality, curated from `KindOptions` in
 * `packages/client/ui-slots/src/index.ts` — the authority for what a register
 * call may pass. Curated rather than projected because the authority is a
 * conditional type keyed on the slot's kind: it has no per-kind declaration a
 * lexical scan could read, and its own JSDoc addresses the compiler, not a
 * registrant. The slot contract tests pin the authority's text so a change
 * there forces this table to be revisited.
 */
const REGISTER_OPTIONS: Readonly<Record<(typeof KINDS)[number], readonly OptionDoc[]>> = {
  single: [],
  list: [
    { name: 'id', requirement: 'required', type: 'string', doc: 'Your cell key. Use an id of your own: a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it. Owners that filter by id address you by it.' },
    { name: 'order', requirement: 'optional', type: 'number', doc: 'Position among the entries, ascending (default 0).' },
    { name: 'label', requirement: 'optional', type: 'string | (() => string)', doc: 'Display text where the owner projects one (nav rows, tabs). A thunk is re-read on every projection, so localized text follows the active locale without re-registering.' },
  ],
  keyed: [
    { name: 'key', requirement: 'required', type: 'string', doc: 'Your cell key: the entry renders where the owner dispatches this exact key. Registering an already-occupied key replaces that occupant.' },
  ],
  chain: [
    { name: 'select', requirement: 'required', type: '(owner) => unknown | null', doc: 'Pure routing selector. Entries are tried in ascending order; the first non-null result wins and arrives as the component\'s `matched` prop. All-null falls through to the owner\'s fallback.' },
  ],
}

/** The one register option a dynamic package must NOT pass, and why. */
const PRIORITY_NOTE = 'Do NOT pass `priority`: the browser-half facade assigns one automatically, and it is LOWER than every shipped entry — in a single or keyed cell that means your entry is the one that renders.'

/** Standard-kit interface that applies to each scope, beyond the global one. */
const SCOPE_KIT: Readonly<Record<(typeof SCOPES)[number], string | undefined>> = {
  'root': undefined,
  'session': 'SessionStandardProps',
  'session-maybe': 'SessionMaybeStandardProps',
}

/** One resolved catalog entry, ready to render. */
export interface SlotEntry {
  readonly key: string
  readonly kind: string
  readonly scope: string
  readonly summary: string
  readonly doc: string
  readonly registerOptions: readonly OptionDoc[]
  readonly ownerProps: readonly string[]
  readonly ownerPropsReferences: readonly string[]
  readonly standardProps: readonly string[]
  readonly keyDomain: string
  readonly hookContext: string
  readonly slotInject: string
  readonly declaredBy: string
  readonly occupants: readonly string[]
  readonly replaceRisk: string
  readonly example: string
  readonly source: string
}

/**
 * Read the workspace and resolve every catalog entry, failing loud on a
 * contract the catalog cannot teach.
 * @param scanRoot - repository root to scan.
 * @returns the entries, sorted by key.
 * @throws when any declared slot is unteachable or the scan contradicts itself.
 */
export function collectSlotEntries(scanRoot: string): SlotEntry[] {
  const files = scanSlotFiles(scanRoot, SOURCE_GLOBS)
  const declarations = files.flatMap(file => slotDeclarations(file))
  const registrations = files.flatMap(file => slotRegistrations(file))
  const types = indexExportedTypes(scanRoot, SOURCE_GLOBS)
  const problems = validateSlotContracts(declarations, registrations, types)
  if (problems.length > 0) {
    throw new Error(`gen-client-catalog: ${String(problems.length)} contract violation(s):\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  const entries = resolveSlotEntries(declarations, registrations, types, standardKits(files))
  const oversized = oversizedSlotReports(entries)
  if (oversized.length > 0) {
    throw new Error(`gen-client-catalog: ${String(oversized.length)} slot(s) exceed the per-slot report budget `
      + `of ${String(MAX_ENTRY_LINES)} lines:\n${oversized.map(problem => `  ${problem}`).join('\n')}`)
  }
  return entries
}

/**
 * Slots whose expanded report exceeds {@link MAX_ENTRY_LINES}. Separated from
 * the scan so the budget is provable on one hand-built entry.
 * @param entries - resolved catalog entries.
 * @returns one message per over-budget slot, empty when every report is readable.
 */
export function oversizedSlotReports(entries: readonly SlotEntry[]): string[] {
  return entries
    .filter(entry => entryLines(entry) > MAX_ENTRY_LINES)
    .map(entry => `slot '${entry.key}' (${entry.source}) reports ${String(entryLines(entry))} lines. `
      + 'Narrow the owner share it passes down (a slot hands a registrant a share, not a subsystem) or tighten '
      + 'its prose, so asking about one slot stays cheaper than asking about all of them.')
}

/** Line count of one entry's variable-length content, the proxy for its rendered report. */
function entryLines(entry: SlotEntry): number {
  const blocks = [entry.doc, entry.example, ...entry.ownerProps, ...entry.registerOptions.map(option => option.doc)]
  return blocks.reduce((total, block) => total + block.split('\n').length, 0)
    + entry.standardProps.length + entry.ownerPropsReferences.length + entry.occupants.length
}

/**
 * Fail-closed contract checks: an unteachable slot must break the gate rather
 * than ship an entry a model cannot act on. Pure, so every rejection is
 * provable without scanning the workspace.
 * @param declarations - every declared slot.
 * @param registrations - every registration call site.
 * @param types - exported type index the owner-props reference resolves against.
 * @returns one message per violation, empty when the surface is teachable.
 */
export function validateSlotContracts(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
): string[] {
  const problems: string[] = []
  const byKey = new Map<string, SlotDeclaration>()
  for (const declaration of declarations) {
    const where = `slot '${declaration.key}' (${declaration.source})`
    const previous = byKey.get(declaration.key)
    if (previous !== undefined) {
      problems.push(`${where} is also declared at ${previous.source}; SlotMap merges duplicates silently, so the catalog cannot tell which documentation wins.`)
      continue
    }
    byKey.set(declaration.key, declaration)
    if (!(KINDS as readonly string[]).includes(declaration.kind)) {
      problems.push(`${where} has no literal 'kind'; the catalog derives the register options from it, so it must be one of ${KINDS.join('/')}.`)
    }
    if (!(SCOPES as readonly string[]).includes(declaration.scope)) {
      problems.push(`${where} has no literal 'scope'; the catalog derives the framework props from it, so it must be one of ${SCOPES.join('/')}.`)
    }
    if (docProse(declaration.jsDoc) === '') {
      problems.push(`${where} has no JSDoc prose. Write it from the REGISTRANT's side: what to pass, what the component receives, whom a registration replaces, and what absence looks like (packages/client/ui-settings/src/client/contract/slots.ts is the template).`)
    }
    if (declaration.ownerType !== undefined
      && /^[A-Za-z_$][\w$]*$/.test(declaration.ownerType)
      && !types.has(declaration.ownerType)) {
      problems.push(`${where} names owner props '${declaration.ownerType}' that no exported declaration provides; export the interface so the catalog can show what the component receives.`)
    }
  }
  for (const registration of registrations) {
    if (registration.factory !== true && !byKey.has(registration.key)) {
      problems.push(`registration into '${registration.key}' (${registration.source}) targets a slot no SlotMap merge declares; either the scan has a blind spot or the registration is dead.`)
    }
    for (const child of registration.children) {
      if (!byKey.has(child)) {
        problems.push(`registration at ${registration.source} declares child slot '${child}' that no SlotMap merge types.`)
      }
    }
  }
  return problems
}

/**
 * Project validated declarations into catalog entries: cardinality decides the
 * register options, scope decides the framework props, and the registration
 * call sites decide who already sits in the seat and which owner's mount makes
 * it exist. Pure, so the projection facts are provable without a workspace.
 * @param declarations - validated slot declarations.
 * @param registrations - every registration call site.
 * @param types - exported type index for owner-props expansion.
 * @param kits - framework prop seats per scope.
 * @returns the entries, sorted by key.
 */
export function resolveSlotEntries(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry[] {
  const declaredBy = new Map<string, SlotRegistration>()
  for (const registration of registrations) {
    for (const child of registration.children) {
      if (!declaredBy.has(child)) declaredBy.set(child, registration)
    }
  }
  return declarations
    .map(declaration => entryOf(declaration, registrations, declaredBy.get(declaration.key), types, kits))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/** The framework prop seats per scope, read from the merged standard-kit interfaces. */
function standardKits(files: readonly ScannedFile[]): ReadonlyMap<string, readonly string[]> {
  const global = standardKitMembers(files, 'GlobalStandardProps')
  const kits = new Map<string, readonly string[]>()
  for (const scope of SCOPES) {
    const extra = SCOPE_KIT[scope]
    // A scope-kit member replaces the global member of the same name, so each seat is listed once.
    kits.set(scope, [...new Set([...global, ...extra === undefined ? [] : standardKitMembers(files, extra)])])
  }
  return kits
}

/** Resolve one declaration into its catalog entry. */
function entryOf(
  declaration: SlotDeclaration,
  registrations: readonly SlotRegistration[],
  declaredBy: SlotRegistration | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry {
  const occupants = registrations.filter(registration =>
    registration.factory !== true && registration.key === declaration.key)
  const cellOccupied = occupants.some(occupant =>
    declaration.kind === 'single' || occupant.entryKey !== undefined)
  const doc = docProse(declaration.jsDoc)
  const owner = ownerShapes(declaration.ownerType, types)
  return {
    key: declaration.key,
    kind: declaration.kind,
    scope: declaration.scope,
    summary: firstSentence(doc),
    doc,
    registerOptions: REGISTER_OPTIONS[declaration.kind as (typeof KINDS)[number]],
    ownerProps: owner.declarations.map(type => truncate(type.text)),
    ownerPropsReferences: owner.references,
    standardProps: kits.get(declaration.scope) ?? [],
    keyDomain: keyDomainOf(declaration, occupants),
    hookContext: declaration.hookContext ?? '',
    slotInject: declaration.injectType ?? '',
    declaredBy: declaredBy === undefined
      ? 'the runtime itself (built in; always present)'
      : declaredBy.factory === true
        ? `factory '${declaredBy.key}' (${shortPackage(declaredBy.package)}), so it exists while that definition is registered`
        : `an entry in '${declaredBy.key}' (${shortPackage(declaredBy.package)}), so it exists while that entry is mounted`,
    occupants: occupants.map(occupant => [
      shortPackage(occupant.package),
      occupant.component,
      ...occupant.id === undefined ? [] : [`id '${occupant.id}'`],
      ...occupant.entryKey === undefined ? [] : [`key '${occupant.entryKey}'`],
    ].join(' ')),
    replaceRisk: cellOccupied && (declaration.kind === 'single' || declaration.kind === 'keyed')
      ? 'shadows-shipped-ui'
      : 'none',
    example: exampleOf(declaration),
    source: declaration.source,
  }
}

/**
 * Owner declarations include the aliases that compose their top-level fields.
 * Field value types remain references so one slot does not expand the Session graph.
 */
function ownerShapes(
  ownerType: string | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
): { declarations: TypeDeclaration[]; references: string[] } {
  if (ownerType === undefined) return { declarations: [], references: [] }
  const own = new Map(declaredTypes(referencedTypeNames([ownerType], types), types)
    .map(declaration => [declaration.name, declaration]))
  for (const declaration of own.values()) {
    const source = ts.createSourceFile(declaration.source, declaration.text, ts.ScriptTarget.Latest, true)
    const alias = source.statements.find(ts.isTypeAliasDeclaration)
    if (alias === undefined) continue
    for (const composed of declaredTypes(ownerCompositionNames(alias.type), types)) {
      own.set(composed.name, composed)
    }
  }
  const declarations = [...own.values()].sort((left, right) => left.name.localeCompare(right.name))
  const references = referencedTypeNames(declarations.map(declaration => declaration.text), types)
    .filter(name => !own.has(name))
  return { declarations, references }
}

/** Top-level composition excludes nested field values and generic arguments. */
function ownerCompositionNames(type: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.flatMap(ownerCompositionNames)
  if (ts.isParenthesizedTypeNode(type)) return ownerCompositionNames(type.type)
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeArguments === undefined) {
    return [type.typeName.text]
  }
  return []
}

/** How a keyed slot's key domain is constrained, '' for the other kinds. */
function keyDomainOf(declaration: SlotDeclaration, occupants: readonly SlotRegistration[]): string {
  if (declaration.kind !== 'keyed') return ''
  const taken = [...new Set(occupants.flatMap(occupant => occupant.entryKey === undefined ? [] : [occupant.entryKey]))].sort()
  const shipped = taken.length === 0 ? 'none are taken yet' : `already taken: ${taken.join(', ')}`
  return declaration.keyProps === undefined
    ? `open: any string the owner dispatches (no compile-time key set), ${shipped}`
    : `fixed by the owner's key table ${declaration.keyProps}, ${shipped}`
}

/** A runnable minimal registration for one slot, per cardinality. */
function exampleOf(declaration: SlotDeclaration): string {
  const authored = blockTag(declaration.jsDoc, 'example')
  if (authored !== undefined) return authored
  const options = [`name: '${declaration.key}'`, ...KIND_EXAMPLE[declaration.kind] ?? []].join(', ')
  return [
    'return {',
    "  inject: ['slots'],",
    '  apply(ctx) {',
    `    ctx.slots.inject('${declaration.key}', () => ctx.slots.register(`,
    `      { ${options} },`,
    "      () => React.createElement('div', null, 'hello'),",
    '    ))',
    '  },',
    '}',
  ].join('\n')
}

/** One multiline JSDoc block tag, without comment decoration. */
function blockTag(jsDoc: string, name: string): string | undefined {
  const lines = jsDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const start = lines.findIndex(line => line === `@${name}` || line.startsWith(`@${name} `))
  if (start < 0) return undefined
  const body = [lines[start]?.slice(name.length + 1).trimStart() ?? '']
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('@')) break
    body.push(line)
  }
  const value = body.join('\n').trim()
  return value === '' ? undefined : value
}

/** Extra example options per cardinality. */
const KIND_EXAMPLE: Readonly<Record<string, readonly string[]>> = {
  single: [],
  list: ["id: 'my-entry'", 'order: 100', "label: 'My entry'"],
  keyed: ["key: '<one key the owner dispatches>'"],
  chain: ['select: owner => null'],
}

/** Drop the `@deepseek-ai/dsh-` prefix so rows stay readable. */
function shortPackage(name: string): string {
  return name.replace('@deepseek-ai/dsh-', '')
}

/** Truncate an over-long declaration, naming the truncation. */
function truncate(text: string): string {
  return text.length > MAX_DECL_CHARS
    ? `${text.slice(0, MAX_DECL_CHARS)} /* …truncated — full shape in source */`
    : text
}

/** JSDoc prose: comment markers and block tags removed, paragraphs kept. */
function docProse(jsDoc: string): string {
  const lines = jsDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const kept: string[] = []
  for (const line of lines) {
    if (line.trimStart().startsWith('@')) break
    kept.push(line)
  }
  return kept.join('\n').replace(/\{@link\s+([^}]+)\}/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

/** First sentence of a prose block, for the compact listing. */
function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, ' ').trim()
  const match = /^(.*?[.!?])(?:\s|$)/.exec(flat)
  return (match?.[1] ?? flat).trim()
}
