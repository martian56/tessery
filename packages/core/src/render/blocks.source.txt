// Page blocks shared by the Tessery editor preview and every generated web app, so both render the same markup.
// Plain components without hooks: they run as React Server Components in Next.js and inside the editor.
// Styles live in styles.css next to this file and are scoped under the .tsp class.
/* eslint-disable @typescript-eslint/no-explicit-any */
type P = Record<string, any>

const list = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const pairs = (v: unknown) => list(v).map((x) => { const i = x.indexOf(':'); return i < 0 ? [x, ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()] })
const key = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && ISO.test(v) ? new Date(v).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : String(v))
const rows = (data: unknown): P[] => (Array.isArray(data) ? data : Array.isArray((data as P)?.items) ? (data as P).items : [])
const SWATCH = ['#d9d2c5', '#b9c4bd', '#c9c2d6', '#e0d4bf', '#bcc8d8', '#d6c3bd', '#c6d2c2', '#d8cfd9']
const isUrl = (v: unknown) => typeof v === 'string' && /^(https?:\/\/|\/)/.test(v)
const href = (link: unknown, r: P) => String(link).replace(/\{(\w+)\}/g, (_: string, k: string) => encodeURIComponent(String(r[k] ?? '')))
/** Column counts for wide, medium and small containers, read by the container queries in styles.css. */
const cols = (n: number, small = 2) => ({ ['--tsp-cols' as string]: n, ['--tsp-cols-md' as string]: Math.min(n, 3), ['--tsp-cols-sm' as string]: Math.min(n, small) })
const ctaHref = (cta: unknown) => (/(sign|log) ?out/i.test(String(cta)) ? '/logout' : /sign|log/i.test(String(cta)) ? '/login' : '#')

/** An image prop is either a URL or a color used for a placeholder. */
const Picture = ({ src, alt, className, i = 0 }: { src: unknown; alt?: string; className: string; i?: number }) =>
  isUrl(src)
    ? <img className={className} src={String(src)} alt={alt ?? ''} />
    : <div className={className} role="presentation" style={{ background: `linear-gradient(135deg, ${typeof src === 'string' && src ? src : SWATCH[i % SWATCH.length]}, #9e968a)` }} />

export const Navbar = ({ brand, links, cta }: P) => (
  <nav className="tsp-nav">
    <b>{brand}</b>
    <span className="tsp-links">{list(links).map((l) => <a key={l} href="#">{l}</a>)}</span>
    {cta && <a className="tsp-nav-cta" href={ctaHref(cta)}>{cta}</a>}
    <span className="tsp-burger" aria-hidden>☰</span>
  </nav>
)

export const Banner = ({ text, bg }: P) => <div className="tsp-banner" style={{ background: bg }}>{text}</div>

export const Hero = ({ headline, sub, cta, image }: P) => (
  <section className="tsp-hero">
    <div><h1>{headline}</h1><p>{sub}</p>{cta && <a className="tsp-cta" href={ctaHref(cta)}>{cta}</a>}</div>
    <Picture className="tsp-img" src={image} />
  </section>
)

export const Features = ({ title, items }: P) => (
  <section className="tsp-sec"><h2>{title}</h2>
    <div className="tsp-grid" style={cols(3)}>{pairs(items).map(([t, x]) => <div key={t} className="tsp-feature"><b>{t}</b><span>{x}</span></div>)}</div>
  </section>
)

export const Stats = ({ items, data }: P) => {
  const entries = data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data as P) : pairs(items)
  return (
    <section className="tsp-sec"><div className="tsp-grid tsp-cols-auto">{entries.map(([k, v]) => <div key={k} className="tsp-stat"><span>{k}</span><b>{show(v)}</b></div>)}</div></section>
  )
}

export const Grid = ({ title, data, limit, columns }: P) => {
  const items: P[] = data === undefined ? Array.from({ length: Math.max(1, Number(limit) || 8) }, (_, i) => ({ name: `Item ${i + 1}`, description: 'Short description' })) : rows(data).slice(0, Number(limit) || 8)
  return (
    <section className="tsp-sec">{title && <h2>{title}</h2>}
      <div className="tsp-grid" style={cols(Number(columns) || 4)}>
        {items.length ? items.map((r, i) => (
          <div key={r.id ?? i} className="tsp-card"><Picture className="tsp-card-img" src={r.image ?? r.imageUrl} i={i} /><b>{show(r.name ?? r.title ?? `Item ${i + 1}`)}</b>{(r.description ?? r.summary) && <span>{show(r.description ?? r.summary)}</span>}</div>
        )) : <p className="tsp-empty">Nothing here yet.</p>}
      </div>
    </section>
  )
}

export const Table = ({ title, columns, data, link, rows: count }: P) => {
  const heads = list(columns)
  const items: P[] = data === undefined ? Array.from({ length: Number(count) || 5 }, (_, i) => Object.fromEntries(heads.map((c, j) => [key(c), j === 0 ? `Record ${i + 1}` : j === 1 ? ['Active', 'Pending', 'Done'][i % 3] : j === 2 ? ['Ada', 'Lin', 'Omar', 'Sofia'][i % 4] : `${i + 1}h ago`]))) : rows(data)
  return (
    <section className="tsp-sec">{title && <h2>{title}</h2>}
      <div className="tsp-table-wrap"><table className="tsp-table"><thead><tr>{heads.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{items.map((r, i) => <tr key={r.id ?? i}>{heads.map((c, j) => <td key={c}>{j === 0 && link ? <a href={href(link, r)}>{show(r[key(c)])}</a> : show(r[key(c)])}</td>)}</tr>)}</tbody>
      </table></div>
      {data !== undefined && !items.length && <p className="tsp-empty">Nothing here yet.</p>}
    </section>
  )
}

export const Kanban = ({ columns, data }: P) => {
  const lanes = list(columns)
  const items: P[] = data === undefined ? lanes.flatMap((c, i) => Array.from({ length: 3 - (i % 2) }, (_, j) => ({ status: c, title: `Task ${i * 3 + j + 1}` }))) : rows(data)
  return (
    <section className="tsp-sec"><div className="tsp-grid" style={cols(lanes.length || 1, 1)}>
      {lanes.map((c) => <div key={c} className="tsp-lane"><b>{c}</b>{items.filter((r) => r.status === c).map((r, i) => <div key={r.id ?? i} className="tsp-ticket">{show(r.title ?? r.name)}</div>)}</div>)}
    </div></section>
  )
}

export const Detail = ({ title, cta, live, data, image }: P) => {
  const d = (data && typeof data === 'object' ? data : {}) as P
  return (
    <section className="tsp-hero">
      <Picture className="tsp-img tsp-img-tall" src={d.image ?? image} i={2} />
      <div><h1>{show(d.name ?? d.title ?? title)}</h1><p>{show(d.description ?? d.summary ?? (data === undefined ? 'Descriptive text pulled from the bound data source.' : ''))}</p>
        {live && <span className="tsp-live">● live</span>}{cta && <a className="tsp-cta" href="#">{cta}</a>}</div>
    </section>
  )
}

export const Cart = ({ cta, data }: P) => {
  const lines: P[] = data === undefined ? [{ name: 'Line item 1', price: 49 }, { name: 'Line item 2', price: 98 }] : rows(data)
  const total = lines.reduce((sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0)
  return (
    <section className="tsp-sec">
      {lines.map((l, i) => <div key={l.id ?? i} className="tsp-line"><Picture className="tsp-thumb" src={l.image} i={i} /><b>{show(l.name ?? l.title)}</b><span>${show(l.price)}</span></div>)}
      <div className="tsp-right"><a className="tsp-cta" href="#">{cta} · ${total}</a></div>
    </section>
  )
}

/** The form markup. Generated apps wrap it in a client component that submits it. */
export const FormView = ({ title, fields, submit, busy, error, onSubmit }: P) => (
  <form className="tsp-sec tsp-form" onSubmit={onSubmit}>
    {title && <h2>{title}</h2>}
    {list(fields).map((f) => <label key={f}>{f}<input name={key(f)} type={/mail/i.test(f) ? 'email' : /password/i.test(f) ? 'password' : 'text'} /></label>)}
    {error && <p className="tsp-error" role="alert">{error}</p>}
    <button className="tsp-cta" disabled={busy}>{busy ? 'Saving…' : submit || 'Save'}</button>
  </form>
)

export const Upload = ({ label }: P) => <section className="tsp-sec"><label className="tsp-drop">{label}<input type="file" hidden /></label></section>

export const Chat = ({ title, data }: P) => {
  const messages: P[] = data === undefined ? [{ text: 'How do I rotate my API key?' }, { text: 'Settings, API keys, Rotate. The old key stays valid for 24h.', mine: true }] : rows(data)
  return (
    <section className="tsp-sec"><h2>{title}</h2><div className="tsp-chat">
      {messages.map((m, i) => <div key={m.id ?? i} className={m.mine ? 'tsp-bubble tsp-me' : 'tsp-bubble'}>{show(m.text ?? m.content)}</div>)}
      <div className="tsp-chat-input">Type a message…</div>
    </div></section>
  )
}

export const Pricing = ({ tiers }: P) => (
  <section className="tsp-sec"><div className="tsp-grid tsp-cols-auto">
    {pairs(tiers).map(([n, v], i) => <div key={n} className={i === 1 ? 'tsp-tier tsp-tier-hl' : 'tsp-tier'}><span>{n}</span><b>{v}</b><a className="tsp-cta" href="#">Choose</a></div>)}
  </div></section>
)

export const Testimonial = ({ quote, author }: P) => (
  <section className="tsp-sec"><blockquote className="tsp-quote">“{quote}”<cite>{author}</cite></blockquote></section>
)

export const Faq = ({ title, items }: P) => (
  <section className="tsp-sec"><h2>{title || 'Questions'}</h2>
    {pairs(items).map(([q, a]) => <details key={q} className="tsp-faq"><summary>{q}</summary><p>{a}</p></details>)}
  </section>
)

export const Text = ({ heading, body }: P) => <section className="tsp-sec"><h2>{heading}</h2><p className="tsp-body">{body}</p></section>

export const Footer = ({ text }: P) => <footer className="tsp-footer">{text}</footer>
