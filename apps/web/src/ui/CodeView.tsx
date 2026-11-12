import { memo, useMemo } from 'react'
import s from './CodeView.module.css'

const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
const KW = /\b(import|from|export|const|let|async|await|return|function|func|package|service|rpc|returns|message|syntax|resource|module|type|input|enum|interface|if|else|for|in|new|stream|default|def|class|scalar|query|mutation|subscription|CREATE|TABLE|INDEX|UNIQUE|PRIMARY|KEY|REFERENCES|NOT|NULL|DEFAULT|CHECK|ON|DELETE|CASCADE|RESTRICT|SET|EXTENSION|IF|EXISTS|USING|FROM|RUN|COPY|WORKDIR|EXPOSE|CMD|ENTRYPOINT|AS|ENV|SELECT|WHERE|ORDER|BY|LIMIT|true|false|null)\b/g

export function highlight(code: string, lang: string): string[] {
  return code.split('\n').map((line) => {
    if (/^\s*(#|\/\/|--)/.test(line)) return `<span class="${s.cm}">${esc(line)}</span>`
    let l = esc(line)
    l = l.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g, `<span class="${s.st}">$1</span>`)
    if (lang === 'yaml' || lang === 'hcl' || lang === 'ini') l = l.replace(/^(\s*-?\s*)([\w./$-]+)(\s*[:=])(?![^<]*>)/, `$1<span class="${s.key}">$2</span>$3`)
    l = l.replace(KW, (m, _g, off: number, str: string) => (str.lastIndexOf('<', off) > str.lastIndexOf('>', off) ? m : `<span class="${s.kw}">${m}</span>`))
    l = l.replace(/(?<![\w#-])(\d+(?:\.\d+)?)(?![\w-])(?![^<]*>)/g, `<span class="${s.nu}">$1</span>`)
    return l
  })
}

export const langOf = (file: string) => (/\.ya?ml$/.test(file) ? 'yaml' : /\.tf$/.test(file) ? 'hcl' : /\.ini$/.test(file) ? 'ini' : /\.sql$/.test(file) ? 'sql' : /\.graphql$/.test(file) ? 'graphql' : /\.proto$/.test(file) ? 'proto' : /Dockerfile$/.test(file) ? 'docker' : 'ts')

export const CodeView = memo(function CodeView({ code, lang }: { code: string; lang: string }) {
  const lines = useMemo(() => highlight(code, lang), [code, lang])
  return (
    <pre className={s.pre}>
      {lines.map((l, i) => <div key={i} className={s.line}><span className={s.ln}>{i + 1}</span><span dangerouslySetInnerHTML={{ __html: l || ' ' }} /></div>)}
    </pre>
  )
})
