// @vitest-environment jsdom
/** Desktop directory flow through its explicit framework dependency closure and production client boot. */
import { afterEach, expect, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createClientTest } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

import { packageRoster } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/package-roster.ts'

const test = createClientTest({ roster: packageRoster(['@deepseek-ai/dsh-client-ui-directory-picker-native']) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('the composed native flow cancels through Desktop without invoking the Host chooser', async ({ start, remote }) => {
  const pick = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick })
  const client = await start()
  const entry = client.ctx.slots.entries('sidebar.workspaces.directoryFlow')[0]!
  const injected = (entry.inject as () => { pick: () => Promise<string | null> })()
  const Component = entry.component as ComponentType<DirectoryFlowOwnerProps & typeof injected>
  const onCancel = vi.fn()
  render(<Component {...injected} open busy={false} onCancel={onCancel} onPicked={vi.fn()} onError={vi.fn()} />)
  await waitFor(() => { expect(onCancel).toHaveBeenCalledOnce() })
  expect(pick).toHaveBeenCalledOnce()
  expect(remote.directoryPicker.pick).not.toHaveBeenCalled()
}, 60_000)
