import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import s from './UpdatesView.module.css'

/** GitHub writes pull requests and comparisons as full URLs; `#128` and `v0.1.0...v0.2.0` read better. */
function shortUrl(url: string): string {
  const pr = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(url)
  if (pr) return `#${pr[1]}`
  const compare = /^https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/(.+)$/.exec(url)
  return compare ? compare[1] : url
}

const components: Components = {
  // Release notes start at level 2; inside a release card every heading is a small subheading.
  h1: ({ children }) => <h4>{children}</h4>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => {
    const bare = typeof children === 'string' && children === href
    return <a href={href} target="_blank" rel="noreferrer">{bare && href ? shortUrl(href) : children}</a>
  },
  // Images in notes would load from anywhere; show their description and a link instead.
  img: ({ src, alt }) => (typeof src === 'string' ? <a href={src} target="_blank" rel="noreferrer">{alt || 'image'}</a> : null),
  table: ({ children }) => <div className={s.tableWrap}><table>{children}</table></div>,
}

/** Renders a release's notes as GitHub-flavoured Markdown: headings, lists, tables, task lists, code and links. Raw
 * HTML in the notes is shown as text, never run. */
export function ReleaseNotes({ text }: { text: string }) {
  if (!text.trim()) return <p className={s.quiet}>No notes for this release.</p>
  return (
    <div className={s.notes}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{text}</Markdown>
    </div>
  )
}
