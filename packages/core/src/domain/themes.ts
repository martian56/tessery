import type { Theme } from './types'

/** Starting points for a web app's theme. Each has its own dark palette, not an inversion of the light one. */
export const THEME_PRESETS: Record<string, { label: string; note: string; theme: Theme }> = {
  paper: {
    label: 'Paper',
    note: 'Quiet neutrals with a cobalt accent, for tools and dashboards.',
    theme: {
      colors: { bg: '#F6F6F3', surface: '#FFFFFF', text: '#17181A', muted: '#5F6368', primary: '#2F5BEA', onPrimary: '#FFFFFF', border: '#E2E2DD' },
      dark: { bg: '#111214', surface: '#1A1B1E', text: '#ECECEA', muted: '#9A9DA3', primary: '#7B9CFF', onPrimary: '#0B1022', border: '#2A2C30' },
      fonts: { heading: 'Geist', body: 'Geist', mono: 'Geist Mono' },
      radius: 8,
    },
  },
  ledger: {
    label: 'Ledger',
    note: 'Serif headings and a deep green, for finance, legal and reading.',
    theme: {
      colors: { bg: '#FBFAF7', surface: '#FFFFFF', text: '#1C1B19', muted: '#66625B', primary: '#0F6E5A', onPrimary: '#F4FBF8', border: '#E4E0D8' },
      dark: { bg: '#141412', surface: '#1D1C1A', text: '#EDEAE3', muted: '#A39E94', primary: '#4FC2A2', onPrimary: '#06201A', border: '#302E2A' },
      fonts: { heading: 'Newsreader', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
      radius: 4,
    },
  },
  signal: {
    label: 'Signal',
    note: 'Dense and dark first, for developer tools and status pages.',
    theme: {
      colors: { bg: '#FFFFFF', surface: '#F6F8FA', text: '#1F2328', muted: '#59636E', primary: '#0969DA', onPrimary: '#FFFFFF', border: '#D1D9E0' },
      dark: { bg: '#0E1116', surface: '#161B22', text: '#E6EDF3', muted: '#8B949E', primary: '#4493F8', onPrimary: '#04101F', border: '#2A313C' },
      fonts: { heading: 'Space Grotesk', body: 'IBM Plex Sans', mono: 'JetBrains Mono' },
      radius: 6,
    },
  },
  orchard: {
    label: 'Orchard',
    note: 'Lichen paper, moss ink and beet red, for community and craft.',
    theme: {
      colors: { bg: '#ECEFE6', surface: '#F8F9F4', text: '#1E2A1E', muted: '#566253', primary: '#A3214E', onPrimary: '#FFF7F9', border: '#D3D9C9' },
      dark: { bg: '#121812', surface: '#1A221A', text: '#E3E9DC', muted: '#97A393', primary: '#E46A8E', onPrimary: '#22070F', border: '#2B352A' },
      fonts: { heading: 'Bricolage Grotesque', body: 'Atkinson Hyperlegible', mono: 'IBM Plex Mono' },
      radius: 10,
    },
  },
  atelier: {
    label: 'Atelier',
    note: 'Porcelain and plum with a soft serif, for studios and shops.',
    theme: {
      colors: { bg: '#EEF1F4', surface: '#FFFFFF', text: '#1B2330', muted: '#5A6474', primary: '#6B2E83', onPrimary: '#FBF5FD', border: '#D9DEE5' },
      dark: { bg: '#13161C', surface: '#1B1F27', text: '#E8EBF0', muted: '#9AA3B2', primary: '#C58BDD', onPrimary: '#1E0A27', border: '#2C323D' },
      fonts: { heading: 'Fraunces', body: 'Manrope', mono: 'JetBrains Mono' },
      radius: 14,
    },
  },
}
