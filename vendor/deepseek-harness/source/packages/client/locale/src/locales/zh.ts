/** zh base dictionary for the common namespace: cross-feature standard words. */
export const zh = {
  'cancel': '取消',
  'close': '关闭',
  'retry': '重试',
  'loading': '加载中…',
  'edit': '编辑',
  'brand.localBuild': 'YouDub 本地构建',
} satisfies Record<string, string>

/** The common vocabulary key union (zh is the key-set source of truth). */
export type CommonKey = keyof typeof zh
