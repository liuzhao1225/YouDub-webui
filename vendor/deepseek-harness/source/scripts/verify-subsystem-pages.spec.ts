/** Regression coverage for package-group subsystem-page ownership. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { auditSubsystemPages } from './verify-subsystem-pages.ts'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-subsystem-pages-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function write(root: string, path: string, source: string): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}

describe('package-group subsystem pages', () => {
  it('accepts a direct page link and a justified no-page group', () => {
    const root = fixture()
    write(root, 'packages/alpha/README.md', '[types](../../docs/subsystems/alpha.md#contract)\n')
    write(root, 'packages/alpha/alpha/package.json', '{}\n')
    write(root, 'docs/subsystems/alpha.md', '# Alpha\n')
    write(root, 'packages/adapter/README.md', '# Adapter\n')

    expect(auditSubsystemPages(root, { adapter: 'Adapter over an existing subsystem.' })).toEqual({
      groups: 2,
      linked: 1,
      exempt: 1,
      violations: [],
    })
  })

  it('rejects a new group whose README never declares subsystem ownership', () => {
    const root = fixture()
    write(root, 'packages/schedule/README.md', '# Schedule\n')
    write(root, 'packages/schedule/tool-schedule/package.json', '{}\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/schedule/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('does not treat the subsystem index or a Chinese counterpart as an owning page', () => {
    const root = fixture()
    write(
      root,
      'packages/wrong/README.md',
      '[index](../../docs/subsystems/README.md) [Chinese](../../docs/subsystems/wrong.zh.md)\n',
    )
    write(root, 'docs/subsystems/README.md', '# Subsystems\n')
    write(root, 'docs/subsystems/wrong.zh.md', '# Wrong\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/wrong/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('does not count links hidden in code, comments, or image syntax', () => {
    const root = fixture()
    write(
      root,
      'packages/hidden/README.md',
      [
        '`[inline](../../docs/subsystems/hidden.md)`',
        '```md',
        '[fenced](../../docs/subsystems/hidden.md)',
        '```',
        '<!-- [comment](../../docs/subsystems/hidden.md) -->',
        '![image](../../docs/subsystems/hidden.md)',
        '',
      ].join('\n'),
    )
    write(root, 'docs/subsystems/hidden.md', '# Hidden\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/hidden/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('rejects a link that escapes the subsystem directory', () => {
    const root = fixture()
    write(root, 'packages/escape/README.md', '[escape](../../docs/subsystems/../architecture.md)\n')
    write(root, 'docs/architecture.md', '# Architecture\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/escape/README.md: no reader-visible direct docs/subsystems/*.md link; add the owning page and link, or add a justified GROUPS_WITHOUT_SUBSYSTEM_PAGE entry',
    ])
  })

  it('rejects missing group READMEs and missing linked pages', () => {
    const root = fixture()
    write(root, 'packages/no-readme/pkg/package.json', '{}\n')
    write(root, 'packages/broken/README.md', '[missing](../../docs/subsystems/missing.md)\n')

    expect(auditSubsystemPages(root, {}).violations).toEqual([
      'packages/broken/README.md: linked subsystem page does not exist: docs/subsystems/missing.md',
      'packages/no-readme/README.md: package group has no group README declaring subsystem ownership',
    ])
  })

  it('rejects blank, orphaned, and stale exemptions', () => {
    const root = fixture()
    write(root, 'packages/linked/README.md', '[types](../../docs/subsystems/linked.md)\n')
    write(root, 'docs/subsystems/linked.md', '# Linked\n')
    write(root, 'packages/blank/README.md', '# Blank\n')

    expect(auditSubsystemPages(root, {
      blank: ' ',
      linked: 'No page.',
      orphan: 'Removed group.',
    }).violations).toEqual([
      'exemption blank: missing justification for omitting a subsystem page',
      'exemption orphan: no matching package group; remove the stale entry',
      'packages/linked/README.md: links a subsystem page but remains exempt; remove the stale exemption',
    ])
  })
})
