import { writeClipboard } from '../components/ui/harness-primitives'
export async function copyText(text:string) { if (!await writeClipboard(text)) throw new Error('无法写入剪贴板') }
