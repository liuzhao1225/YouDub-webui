import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { fieldOptions, fieldType, fieldValue } from '@/runtime/schema-fields'
import { ConfigEditor } from './builtin/schema-form'
import type { Bindings, JsonSchema } from './sdk'

afterEach(cleanup)
it('preserves nullable primitive types and distinguishes unknown from empty model support', () => {
  const number: JsonSchema = { type: ['integer', 'null'] }
  expect(fieldType(number)).toBe('integer')
  expect(fieldValue(number, '2')).toBe(2)
  expect(fieldValue(number, '')).toBeUndefined()
  const language: JsonSchema = { type: 'string', 'x-optionsFrom': 'languages', 'x-options': [{ value: 'zh', label: '中文' }] }
  expect(fieldOptions(language, {}).options).toEqual([{ value: 'zh', label: '中文' }])
  expect(fieldOptions(language, { languages: [] })).toEqual({ options: [], constrained: true })
})
it('applies shared options and numeric parsing in the full node form', async () => {
  const changed = vi.fn(), user = userEvent.setup()
  render(<LanguageProvider><ConfigEditor ownerId="test" readOnly={false} useSlot={(() => []) as Bindings<'useSlot'>['useSlot']} diagnostics={[]} value={{ count: 1, language: 'zh' }} model={{ languages: ['en'] }} schema={{ properties: {
    count: { type: ['integer', 'null'], title: '次数', enum: [1, 2] },
    amount: { type: ['number', 'null'], title: '数值' },
    language: { type: 'string', title: '语言', 'x-optionsFrom': 'languages', 'x-options': [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }] },
  } }} onChange={changed} /></LanguageProvider>)
  await user.click(screen.getByLabelText('次数'))
  await user.click(screen.getByRole('menuitem', { name: '2' }))
  expect(changed.mock.calls.at(-1)![0].count).toBe(2)
  await user.type(screen.getByRole('spinbutton', { name: '数值' }), '7')
  expect(changed.mock.calls.at(-1)![0].amount).toBe(7)
  await user.click(screen.getByLabelText('语言'))
  expect(screen.getByRole('menuitem', { name: 'zh · 不可用' })).toBeDisabled()
  await user.click(screen.getByRole('menuitem', { name: 'English' }))
  expect(changed.mock.calls.at(-1)![0].language).toBe('en')
})
