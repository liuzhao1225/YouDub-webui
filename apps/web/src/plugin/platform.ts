export const PLATFORM_VERSION = '1'
export const PLATFORM_SPECIFIERS = {
  react: 'react', 'react-dom': 'react-dom', 'react-dom/client': 'react-dom-client',
  'react/jsx-runtime': 'jsx-runtime', 'react/jsx-dev-runtime': 'jsx-dev-runtime',
  cordis: 'cordis', '@youdub/sdk/client': 'sdk',
} as const
export const IMPORT_MAP = { imports: Object.fromEntries(Object.entries(PLATFORM_SPECIFIERS).map(([specifier, asset]) => [specifier, `/plugin-platform/${PLATFORM_VERSION}/${asset}.mjs`])) }
