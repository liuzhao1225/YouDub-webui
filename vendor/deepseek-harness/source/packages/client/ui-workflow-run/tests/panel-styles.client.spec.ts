/**
 * WorkflowRunPanel's font-size-axis adoption as CSS text. jsdom has no
 * layout, so these read the declarations that make the run/phase headers and
 * the expanded member rows follow the Settings font-size preference: member
 * labels at the body size (--dsh-content-font-size / --dsh-content-font-delta),
 * the chrome around them on the secondary tier
 * (--dsh-content-font-size-secondary / --dsh-content-font-delta-secondary).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/WorkflowRunPanel.module.css', import.meta.url)),
  'utf8',
)
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\,\s]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`WorkflowRunPanel.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('WorkflowRunPanel.module.css font-size axis', () => {
  it('member labels ride the axis at the body size with matching row geometry', () => {
    expect(declarations('.memberLabel')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size, 14px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
    expect(declarations('.memberLabelWrap')).toEqual(expect.arrayContaining([
      'height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  it('member status and the empty placeholder read the secondary tier', () => {
    for (const selector of ['.memberStatus', '.empty']) {
      expect(declarations(selector)).toEqual(expect.arrayContaining([
        'font-size: var(--dsh-content-font-size-secondary, 13px)',
        'line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      ]))
    }
  })

  it('the phase status column widens with the text so larger sizes do not truncate', () => {
    expect(declarations('.phaseStatus')).toEqual(expect.arrayContaining([
      'width: calc(132px + var(--dsh-content-font-delta-secondary, 0px) * 10)',
    ]))
  })
})
