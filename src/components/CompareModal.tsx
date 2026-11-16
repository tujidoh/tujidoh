import { useState } from 'react'
import type { Property } from '../lib/types'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/types'
import { man, rentPlusFee, totalWithParking, yen } from '../lib/util'
import type { NearStop } from './PropertyDetail'

interface Props {
  items: Property[] // 絞り込み後の物件
  nearestStop: (p: Property) => NearStop | null
  onClose: () => void
  onSelect: (id: string) => void
}

type Row = { label: string; get: (p: Property) => string; best?: (p: Property) => number | null; better?: 'min' | 'max' }

export default function CompareModal({ items, nearestStop, onClose, onSelect }: Props) {
  const [ids, setIds] = useState<string[]>(() => items.filter((p) => p.status !== 'excluded').map((p) => p.id))
  const cols = items.filter((p) => ids.includes(p.id))

  const rows: Row[] = [
    { label: 'ステータス', get: (p) => STATUS_LABEL[p.status] + (p.favorite ? ' ★' : '') },
    { label: '家賃', get: (p) => yen(p.rent), best: (p) => p.rent, better: 'min' },
    { label: '管理費', get: (p) => yen(p.managementFee) },
    { label: '家賃＋管理費', get: (p) => man(rentPlusFee(p)), best: rentPlusFee, better: 'min' },
    { label: '駐車場', get: (p) => (p.parking === 'yes' ? `あり ${p.parkingFee != null ? yen(p.parkingFee) : '料金未入力'}` : p.parking === 'no' ? 'なし' : '不明') },
    {
      label: '月額合計（駐車場込み）',
      get: (p) => man(totalWithParking(p)) + (p.parking === 'yes' && p.parkingFee == null ? '（駐車場料金未入力）' : ''),
      best: totalWithParking,
      better: 'min',
    },
    { label: '敷金', get: (p) => yen(p.deposit) },
    { label: '礼金', get: (p) => yen(p.keyMoney) },
    {
      label: '敷金＋礼金',
      get: (p) => (p.deposit != null && p.keyMoney != null ? yen(p.deposit + p.keyMoney) : '—'),
      best: (p) => (p.deposit != null && p.keyMoney != null ? p.deposit + p.keyMoney : null),
      better: 'min',
    },
    { label: '間取り', get: (p) => p.layout || '—' },
    { label: '専有面積', get: (p) => (p.area != null ? `${p.area}㎡` : '—'), best: (p) => p.area, better: 'max' },
    {
      label: '㎡あたり家賃＋管理費',
      get: (p) => {
        const t = rentPlusFee(p)
        return t != null && p.area ? `${Math.round(t / p.area).toLocaleString()}円/㎡` : '—'
      },
      best: (p) => {
        const t = rentPlusFee(p)
        return t != null && p.area ? t / p.area : null
      },
      better: 'min',
    },
    { label: '築年数', get: (p) => (p.ageYears != null ? (p.ageYears === 0 ? '新築' : `${p.ageYears}年`) : '—'), best: (p) => p.ageYears, better: 'min' },
    { label: '住所', get: (p) => p.address || '—' },
    { label: '最寄り駅・バス停', get: (p) => p.nearest || '—' },
    {
      label: '最寄りバス停（直線距離）',
      get: (p) => {
        const s = nearestStop(p)
        return s ? `${s.name} 約${Math.round(s.distance / 10) * 10}m${p.locationApprox ? '（位置概略）' : ''}` : '—'
      },
      best: (p) => nearestStop(p)?.distance ?? null,
      better: 'min',
    },
    { label: '情報確認日', get: (p) => p.checkedDate || '—' },
    { label: 'メモ', get: (p) => p.memo || '—' },
  ]

  const bestOf = (r: Row) => {
    if (!r.best || cols.length < 2) return null
    const vals = cols.map(r.best).filter((v): v is number => v != null)
    if (vals.length < 2) return null
    return r.better === 'min' ? Math.min(...vals) : Math.max(...vals)
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="比較表">
        <header className="modal-head">
          <h2>候補の比較表</h2>
          <button className="btn icon" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <details className="picker">
            <summary>比較する物件を選ぶ（{cols.length}/{items.length}件）</summary>
            <div className="chips">
              {items.map((p) => (
                <button
                  key={p.id}
                  className={'chip' + (ids.includes(p.id) ? ' on' : '')}
                  onClick={() => setIds((x) => (x.includes(p.id) ? x.filter((i) => i !== p.id) : [...x, p.id]))}
                >
                  {p.name || '名称未設定'}
                </button>
              ))}
            </div>
          </details>
          {cols.length === 0 ? (
            <p className="empty muted">比較する物件を選んでください。（現在の絞り込み条件に合う物件が対象です）</p>
          ) : (
            <div className="table-wrap">
              <table className="compare">
                <thead>
                  <tr>
                    <th className="sticky">項目</th>
                    {cols.map((p) => (
                      <th key={p.id} style={{ borderTop: `4px solid ${STATUS_COLOR[p.status]}` }}>
                        <button className="btn link" onClick={() => onSelect(p.id)}>
                          {p.name || '名称未設定'}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const b = bestOf(r)
                    return (
                      <tr key={r.label}>
                        <th className="sticky">{r.label}</th>
                        {cols.map((p) => (
                          <td key={p.id} className={b != null && r.best!(p) === b ? 'best' : ''}>
                            {r.get(p)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">緑色のセルは、その項目で最も条件の良い物件です。距離は直線距離で、徒歩経路ではありません。</p>
        </div>
      </div>
    </div>
  )
}
