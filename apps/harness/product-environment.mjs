/** YouDub translates its own paths to framework internals; another product's overrides never enter it. */
export function youdubEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !name.toUpperCase().startsWith('DSH_')));
}
