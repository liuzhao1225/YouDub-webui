import { NativeSelect } from '@/components/ui/native-select'
/* Adapted from DeepSeek Harness @99f6f02 (MIT). See SOURCE.md and LICENSE. */
/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from './types'
import { Button, Modal } from './primitives'
import type { SnapshotSelectorHook } from './snapshot'
import { CustomProviderCard } from './CustomProviderCard'
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor'
import type { en } from './locales'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  onDirtyChange?: (dirty: boolean) => void
  onBusyChange?: (busy: boolean) => void
  controller: ModelsSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'api' | 't' | 'readOnly' | 'onClose' | 'onDirtyChange' | 'onBusyChange'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, api, t, onDirtyChange: props.onDirtyChange, onBusyChange: props.onBusyChange }} />
}

function Loaded({ injected }: { injected: ModelsSectionInjected }): ReactNode {
  const { controller, api, t, onDirtyChange, onBusyChange } = injected
  const [editorBusy, setEditorBusy] = useState(false)
  const reportBusy = useCallback((value: boolean) => { setEditorBusy(value) }, [])
  const [dirty, setDirty] = useState(false)
  const reportDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange?.(value) }, [onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(true)
  const [composerRevision, setComposerRevision] = useState(0)
  const composerId = useId()
  const deleteOpener = useRef<HTMLElement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { onBusyChange?.(editorBusy || deleting) }, [editorBusy, deleting, onBusyChange])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(true)
    setDeclaring(false)
    setComposerRevision(value => value + 1)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        if (editing?.provider === deleteTarget.provider) { setEditing(undefined); setAdding(true) }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
  const addTarget = adding && !declaring ? editing ?? (addable[0] ? targetOf(addable[0]) : undefined) : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'))

  return (
    <div className={styles['section']}>
      <h1 className={styles['title']}>{t('title')}</h1>
      {state.credentialError ? <p className={styles['error']} role="alert">{state.credentialError}</p> : null}
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      <ul className={styles['rows']}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            return (
              <li key={row.entry.provider} className={styles['setupCard']}>
                {renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onDirtyChange: reportDirty,
                  onBusyChange: reportBusy,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          const open = !adding && editing?.provider === row.entry.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          return (
            <li key={row.entry.provider} className={styles['rowCard']}>
              <div className={styles['rowHead']}>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{row.entry.displayName}</span>
                  {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}
                  {credentialConfigured
                    ? (
                      <span
                        className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                        role="img"
                        aria-label={t('credentialConfigured')}
                        title={t('credentialConfigured')}
                      />
                    )
                    : credentialMissing
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                          role="img"
                          aria-label={t('credentialMissing')}
                          title={t('credentialMissing')}
                        />
                      )
                      : null}
                </span>
                <span className={styles['rowActions']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    aria-label={providerCopy(t('editProvider'), target)}
                    disabled={dirty || editorBusy}
                    onClick={() => {
                      setSavedTarget(undefined)
                      // One card at a time: leaving `declaring` set would show
                      // the create card beside this editor, and closing either
                      // one discards the other's draft.
                      setDeclaring(false)
                      setAdding(open)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    {t('edit')}
                  </button>
                  {row.removable
                    ? (
                      <button
                        type="button"
                        className={styles['dangerButton']}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        disabled={!state.writable || dirty || editorBusy}
                        onClick={event => {
                          deleteOpener.current = event.currentTarget
                          setSavedTarget(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        {t('remove')}
                      </button>
                    )
                    : null}
                </span>
              </div>
              {!row.entry.active && row.entry.unavailableReason ? <p className={styles['error']} role="alert">{row.entry.unavailableReason}</p> : null}
              {open
                ? renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onDirtyChange: reportDirty,
                  onBusyChange: reportBusy,
                  onClose: (changed) => { closeEditor(changed, target) },
                })
                : null}
            </li>
          )
        })}
      </ul>
      {(!editing || adding || declaring) && <div className={styles['addCard']}>
        <div role="tablist" aria-label={t('provider')} className={styles['composerTabs']}>
          <button type="button" role="tab" id={composerId + '-preset'} aria-controls={composerId + '-panel'} aria-selected={!declaring} disabled={dirty || editorBusy} className={styles['composerTab']} onClick={() => { setAdding(true); setDeclaring(false); setEditing(undefined); setComposerRevision(value => value + 1) }}>{t('presetTab')}</button>
          <button type="button" role="tab" id={composerId + '-custom'} aria-controls={composerId + '-panel'} aria-selected={declaring} disabled={dirty || editorBusy} className={styles['composerTab']} onClick={() => { setAdding(false); setDeclaring(true); setEditing(undefined); setComposerRevision(value => value + 1) }}>{t('customTab')}</button>
        </div>
        <div role="tabpanel" id={composerId + '-panel'} aria-labelledby={composerId + (declaring ? '-custom' : '-preset')}>
          {declaring ? <CustomProviderCard
            key={composerRevision}
            hideTitle
            taken={state.rows.map(row => row.entry.provider)}
            protocols={protocols}
            revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
            api={api} t={t} readOnly={!state.writable}
            onDirtyChange={reportDirty} onBusyChange={reportBusy}
            onClose={(changed) => { setDeclaring(false); setAdding(true); setEditing(undefined); setComposerRevision(value => value + 1); if (changed) void controller.load() }}
          /> : addTarget && addNamespace ? <>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('provider')}</span>
              <NativeSelect className="max-w-60" value={addTarget.provider} aria-label={t('provider')} disabled={dirty || editorBusy} onChange={event => { const row = addable.find(candidate => candidate.entry.provider === event.target.value); if (row) setEditing(targetOf(row)) }}>
                {addable.map(row => <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>)}
              </NativeSelect>
            </div>
            <ProviderEditor key={addTarget.provider + ':' + composerRevision}
              provider={addTarget.provider} displayName={addTarget.displayName} hideTitle namespace={addNamespace}
              settingsPath={addTarget.settingsPath} api={api} t={t} readOnly={!state.writable}
              onDirtyChange={reportDirty} onBusyChange={reportBusy}
              onClose={changed => closeEditor(changed, addTarget)}
            />
          </> : <p className={styles['advancedHint']}>{state.status === 'ready' ? t('allConfigured') : t('loading')}</p>}
        </div>
      </div>}
      <Modal
        open={deleteTarget !== undefined}
        finalFocus={() => deleteOpener.current?.isConnected ? deleteOpener.current : document.getElementById(composerId + '-preset')}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
