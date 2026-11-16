import { useRef, useState } from 'react'
import type { Property } from '../lib/types'
import { downloadText, makeBackup, parseBackup } from '../lib/storage'
import type { BusLayer } from '../lib/busData'
import { parseGeoJson, hashColor } from '../lib/busData'
import { normalizeUrl, uid } from '../lib/util'
import type { SyncState } from '../lib/sync'
import { syncLabel } from './SyncBadge'

export interface AccountInfo {
  email: string
  state: SyncState | null
  realtime: boolean
  onSyncNow: () => void
  onLogout: () => void
}

interface Props {
  properties: Property[]
  busLayers: BusLayer[]
  onReplace: (list: Property[]) => void
  onAddLayer: (l: BusLayer) => void
  onRemoveLayer: (id: string) => void
  onClose: () => void
  account: AccountInfo | null
}

/** インポート：同じID、または同じSUUMO URLの物件は更新日時が新しい方を残す */
export function mergeProperties(current: Property[], incoming: Property[]) {
  const out = [...current]
  let added = 0
  let updated = 0
  let skipped = 0
  for (const p of incoming) {
    const n = normalizeUrl(p.suumoUrl)
    const idx = out.findIndex((x) => x.id === p.id || (n && normalizeUrl(x.suumoUrl) === n))
    if (idx < 0) {
      out.push(p)
      added++
    } else if ((p.updatedAt || '') > (out[idx].updatedAt || '')) {
      out[idx] = { ...p, id: out[idx].id }
      updated++
    } else skipped++
  }
  return { list: out, added, updated, skipped }
}

export default function DataModal({ properties, busLayers, onReplace, onAddLayer, onRemoveLayer, onClose, account }: Props) {
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const jsonRef = useRef<HTMLInputElement>(null)
  const geoRef = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    downloadText(`itami-rental-backup-${stamp}.json`, JSON.stringify(makeBackup(properties), null, 2))
    setErr('')
    setMsg(`${properties.length}件の物件をJSONファイルに書き出しました。`)
  }

  const importJson = async (file: File) => {
    setMsg('')
    setErr('')
    try {
      const incoming = parseBackup(await file.text())
      if (mode === 'replace') {
        if (
          !confirm(
            `現在の${properties.length}件をすべて削除し、ファイルの${incoming.length}件に置き換えます。よろしいですか？` +
              (account ? '\n\n⚠ 共有モードのため、パートナーの端末からも削除・置き換えされます。' : ''),
          )
        )
          return
        onReplace(incoming)
        setMsg(`${incoming.length}件を復元しました（置き換え）。`)
      } else {
        const r = mergeProperties(properties, incoming)
        onReplace(r.list)
        setMsg(`復元しました：追加 ${r.added}件 / 更新 ${r.updated}件 / 変更なし ${r.skipped}件`)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const importGeo = async (files: FileList) => {
    setMsg('')
    setErr('')
    const done: string[] = []
    for (const file of Array.from(files)) {
      try {
        const { data, kind } = parseGeoJson(await file.text())
        const name = file.name.replace(/\.(geo)?json$/i, '')
        onAddLayer({
          id: 'imp-' + uid(),
          name,
          kind,
          source: `取り込みファイル: ${file.name}（${new Date().toLocaleDateString('ja-JP')} 取り込み）`,
          builtin: false,
          visible: true,
          data,
          color: hashColor(name),
        })
        done.push(`${file.name}（${data.features.length}件）`)
      } catch (e) {
        setErr(`${file.name}: ${e instanceof Error ? e.message : e}`)
      }
    }
    if (done.length) setMsg(`取り込みました：${done.join('、')}。地図右上の「レイヤー」から表示を切り替えられます。`)
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="データ管理">
        <header className="modal-head">
          <h2>データ管理</h2>
          <button className="btn icon" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {msg && <p className="ok">{msg}</p>}
          {err && <p className="alert">{err}</p>}

          {account && (
            <fieldset>
              <legend>共有（2人で同期）</legend>
              <p>
                ログイン中：<b>{account.email}</b>
              </p>
              <p>
                同期状態：<b>{syncLabel(account.state)}</b>
                {account.state?.lastSyncedAt && (
                  <small className="muted">（最終同期 {new Date(account.state.lastSyncedAt).toLocaleString('ja-JP')}）</small>
                )}
                <br />
                <small className="muted">
                  {account.realtime ? '● リアルタイム接続中：相手の変更がすぐ反映されます' : '○ リアルタイム未接続：画面を開き直したとき・2分ごとに反映されます'}
                </small>
              </p>
              {account.state?.error && <p className="alert">{account.state.error}</p>}
              <div className="loc-buttons">
                <button className="btn" onClick={account.onSyncNow}>
                  ⟳ 今すぐ同期
                </button>
                <button className="btn danger" onClick={account.onLogout}>
                  ログアウト
                </button>
              </div>
              <p className="hint">物件データはサーバー（Supabase）に保存され、2人の全端末で共有されます。取り込んだGeoJSONと絞り込み条件は端末ごとの設定です。</p>
            </fieldset>
          )}

          <fieldset>
            <legend>物件データのバックアップ</legend>
            <p className="hint">
              {account
                ? '共有データはサーバーにも保存されていますが、念のため月1回程度JSONでバックアップしておくと安心です。'
                : '物件データはこのブラウザ内（localStorage）だけに保存されています。ブラウザのデータ削除や端末変更に備えて、定期的にバックアップしてください。'}
            </p>
            <button className="btn primary" onClick={exportJson} disabled={properties.length === 0}>
              ⬇ JSONでエクスポート（{properties.length}件）
            </button>
          </fieldset>

          <fieldset>
            <legend>バックアップから復元（インポート）</legend>
            <label className="check">
              <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              追加・更新（同じ物件は更新日時が新しい方を残す）
            </label>
            <label className="check">
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              すべて置き換え
            </label>
            <input
              ref={jsonRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importJson(f)
                e.target.value = ''
              }}
            />
            <button className="btn" onClick={() => jsonRef.current?.click()}>
              ⬆ JSONファイルを選択
            </button>
          </fieldset>

          <fieldset>
            <legend>バス路線・バス停 GeoJSON の取り込み</legend>
            <p className="hint">
              LineString（路線）または Point（バス停）を含む GeoJSON（経緯度・WGS84/JGD2011）を読み込めます。取り込んだデータはこのブラウザ内（IndexedDB）に保存されます。
            </p>
            <input
              ref={geoRef}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void importGeo(e.target.files)
                e.target.value = ''
              }}
            />
            <button className="btn" onClick={() => geoRef.current?.click()}>
              ⬆ GeoJSONファイルを選択
            </button>
            <ul className="layers">
              {busLayers.map((l) => (
                <li key={l.id}>
                  <div>
                    <b>{l.name}</b> <small className="muted">（{l.data.features.length}件）</small>
                    <br />
                    <small className="muted">{l.source}</small>
                  </div>
                  {!l.builtin && (
                    <button className="btn danger small" onClick={() => confirm(`「${l.name}」を削除しますか？`) && onRemoveLayer(l.id)}>
                      削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend>データの出典</legend>
            <ul className="credits">
              <li>
                背景地図：©{' '}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
                  OpenStreetMap
                </a>{' '}
                contributors（ODbL）
              </li>
              <li>
                バス路線・バス停：国土交通省「
                <a href="https://nlftp.mlit.go.jp/ksj/" target="_blank" rel="noopener noreferrer">
                  国土数値情報
                </a>
                」バスルート（N07）・バス停留所（P11）2022年度（令和4年度）データを加工して作成（CC BY 4.0）。
                <b>2022年度時点の情報のため、現在の路線・停留所とは異なる場合があります。</b>
              </li>
              <li>住所検索：国土地理院 地名検索API</li>
            </ul>
          </fieldset>
        </div>
      </div>
    </div>
  )
}
