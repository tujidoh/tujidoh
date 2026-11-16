import type { Property } from './types'

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))

export const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 円 → 表示（例: 85,000円 / 8.5万円） */
export const yen = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('ja-JP')}円`)
export const man = (v: number | null | undefined) => {
  if (v == null) return '—'
  const m = v / 10000
  return `${Number.isInteger(m) ? m : m.toFixed(m * 10 === Math.round(m * 10) ? 1 : 2)}万円`
}

/** 家賃＋管理費（どちらかが不明なら分かる分だけ合計し、partial=true） */
export function rentPlusFee(p: Property) {
  if (p.rent == null) return null
  return p.rent + (p.managementFee ?? 0)
}

/** 家賃＋管理費＋駐車場 */
export function totalWithParking(p: Property) {
  const base = rentPlusFee(p)
  if (base == null) return null
  return base + (p.parking === 'yes' ? (p.parkingFee ?? 0) : 0)
}

/** SUUMO URL の正規化（重複判定用）: クエリ・ハッシュ・末尾スラッシュを除去 */
export function normalizeUrl(u: string) {
  const s = u.trim()
  if (!s) return ''
  try {
    const url = new URL(s)
    return (url.host.replace(/^www\./, '') + url.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return s.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
  }
}

/** 2点間の直線距離（m） */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export const layoutGroup = (layout: string) => {
  const l = layout.toUpperCase().replace(/\s/g, '').replace('Ｌ', 'L').replace('Ｄ', 'D').replace('Ｋ', 'K')
  const m = l.match(/^(\d)(SLDK|LDK|SDK|DK|SK|K|R)/)
  if (!m) return 'その他'
  const n = Number(m[1])
  if (n >= 4) return '4LDK以上'
  const t = m[2].replace('S', '') // 2SLDK → 2LDK 扱い
  const key = `${n}${t === 'R' ? 'K' : t}`
  return ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '3LDK'].includes(key) ? key : 'その他'
}

export function isSafeHttpUrl(u: string) {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
