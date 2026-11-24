import { Fragment, type ReactNode } from 'react'
import s from './UpdatesView.module.css'

/** Renders the small part of Markdown that GitHub release notes use: headings, lists, links, bold and code. It builds
 * elements rather than HTML, so nothing in the notes can run in the page. */
export function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list}</ul>)
    list = []
  }
  text.replace(/\r\n/g, '\n').split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (item) return void list.push(<li key={i}>{inline(item[1])}</li>)
    flush()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) blocks.push(<h4 key={i}>{inline(heading[1])}</h4>)
    else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>)
  })
  flush()
  return blocks.length ? <div className={s.notes}>{blocks}</div> : <p className={s.quiet}>No notes for this release.</p>
}

const TOKEN = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*|`[^`]+`)/g

function inline(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noreferrer">{shortUrl(part)}</a>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** GitHub writes pull requests and comparisons as full URLs; `#128` and `v0.1.0...v0.2.0` read better. */
function shortUrl(url: string): string {
  const pr = /\/pull\/(\d+)$/.exec(url)
  if (pr) return `#${pr[1]}`
  const compare = /\/compare\/(.+)$/.exec(url)
  return compare ? compare[1] : url
}
