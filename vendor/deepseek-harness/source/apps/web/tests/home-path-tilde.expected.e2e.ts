// @vitest-environment jsdom
// Assembled POSIX home-path display: the fixture Host home is `/home/fixture`
// and a second Workspace lives under it. The sidebar hover card must show
// `~/Documents/project` while copy still writes the full path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/expected/home-path-tilde/workspace-hover.expected.txt')

installAssembledBootEnv()

describe('assembled POSIX home-path display', () => {
  it('shows the home-descendant Workspace path as ~ and copies the full path', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    const group = (await within(tree).findAllByText('project'))
      .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
      .find(el => el?.getAttribute('aria-expanded') !== null)
    if (group == null) throw new Error('home-descendant Workspace group missing')

    fireEvent.pointerEnter(group.parentElement as HTMLElement)
    const hoverPath = await waitFor(() => {
      const found = screen.getByText('~/Documents/project')
      expect(found).toBeTruthy()
      return found
    }, { timeout: 2_000 })
    expect(screen.queryByText('/home/fixture/Documents/project')).toBeNull()
    const copy = screen.getByRole('button', { name: 'Copy: /home/fixture/Documents/project' })

    const shape = [
      `hover=${hoverPath.textContent}`,
      `copy=${copy.getAttribute('aria-label')}`,
    ].join('\n') + '\n'
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
    act(() => { fireEvent.pointerLeave(group.parentElement as HTMLElement) })
  })
})
