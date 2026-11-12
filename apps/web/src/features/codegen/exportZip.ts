import type { ProjectDoc } from '@tessery/core/domain/types'
import { generateAll } from '.'

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zip(files: Record<string, string>, root: string): Blob {
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: BlobPart[] = []
  let offset = 0, count = 0
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(`${root}/${name}`), db = enc.encode(text), crc = crc32(db)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true)
    h.setUint32(14, crc, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true)
    parts.push(h, nb, db)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true)
    c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, offset, true)
    central.push(c, nb)
    offset += 30 + nb.length + db.length; count++
  }
  const size = central.reduce<number>((a, p) => a + (p as ArrayBufferView).byteLength, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, offset, true)
  return new Blob([...parts, ...central, e], { type: 'application/zip' })
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const downloadText = (name: string, text: string) => download(name, new Blob([text], { type: 'text/plain' }))

export function exportProjectZip(doc: ProjectDoc): number {
  const files = generateAll(doc)
  download(`${doc.name}.zip`, zip(files, doc.name))
  return Object.keys(files).length
}
