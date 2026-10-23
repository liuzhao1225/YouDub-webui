import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
export async function copyText(text:string) { if (!await writeClipboard(text)) throw new Error('无法写入剪贴板') }
