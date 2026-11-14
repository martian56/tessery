// Tests exercise the shared renderers' pure helpers (CSS generation and sanitizing) and never render, so the JSX
// runtime they import only has to exist.
const element = (type: unknown, props: unknown) => ({ type, props })
export const jsx = element
export const jsxs = element
export const Fragment = 'fragment'
