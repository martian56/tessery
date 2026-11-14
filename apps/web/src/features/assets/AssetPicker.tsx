import { useRef, useState } from 'react'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { assetsApi, uploadAsset, useAssetsQuery, useDeleteAssetMutation, type Asset } from '@/api/endpoints/assets'
import { errorMessage } from '@/api/types'
import { useAppDispatch } from '@/store'
import { Button, Dialog, toast } from '@/ui'
import s from './AssetPicker.module.css'

const size = (b: number) => (b > 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** The project's uploaded images, videos and fonts. Picking one returns its `asset:` reference. */
export function AssetPicker({ pid, open, onClose, onPick, accept = 'image' }: { pid: string; open: boolean; onClose: () => void; onPick: (a: Asset) => void; accept?: 'image' | 'video' | 'font' | 'any' }) {
  const dispatch = useAppDispatch()
  const { data, error, isLoading } = useAssetsQuery(pid, { skip: !open })
  const [remove] = useDeleteAssetMutation()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const fits = (a: Asset) => accept === 'any' || a.contentType.startsWith(accept === 'font' ? 'font/' : `${accept}/`)
  const list = (data ?? []).filter(fits)

  const upload = async (picked: FileList | null) => {
    const files = Array.from(picked ?? [])
    if (!files.length) return
    setBusy(true)
    let last: Asset | null = null
    for (const f of files) {
      try { last = await uploadAsset(pid, f) } catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'err') }
    }
    setBusy(false)
    dispatch(assetsApi.util.invalidateTags(['Assets']))
    if (last && files.length === 1 && fits(last)) { onPick(last); onClose() }
  }
  const del = async (a: Asset) => {
    const r = await remove({ pid, id: a.id })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Assets" width={720}
      description="Images, videos and fonts for this project's pages. Deployed apps ship their own copies."
      footer={<><input ref={input} type="file" multiple hidden accept={accept === 'image' ? 'image/*' : accept === 'video' ? 'video/mp4' : accept === 'font' ? '.woff,.woff2' : undefined} onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
        <Button icon={<Upload />} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</Button><Button onClick={onClose}>Close</Button></>}>
      <div className={s.drop} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files) }}>
        {isLoading && <p className={s.hint}>Loading…</p>}
        {error && <p className={s.hint}>{errorMessage(error)}</p>}
        {data && !list.length && <div className={s.empty}><ImagePlus size={20} /><span>Drop files here or press Upload.</span></div>}
        <div className={s.grid}>
          {list.map((a) => (
            <div key={a.id} className={s.item}>
              <button className={s.thumb} onClick={() => { onPick(a); onClose() }} aria-label={`Use ${a.name}`}>
                {a.contentType.startsWith('image/') ? <img src={a.url} alt="" loading="lazy" /> : a.contentType.startsWith('video/') ? <video src={a.url} muted /> : <span className={s.kind}>{a.contentType.split('/')[1]}</span>}
              </button>
              <div className={s.meta}><span title={a.name}>{a.name}</span><small>{a.width && a.height ? `${a.width}×${a.height} · ` : ''}{size(a.sizeBytes)}</small></div>
              <Button size="xs" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${a.name}`} onClick={() => del(a)} />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
