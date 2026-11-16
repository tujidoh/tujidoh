import type { BackupFile, Property, Status, Parking } from './types'
import { uid } from './util'

const KEY = 'itami-rental-map:properties:v1'

export function loadProperties(): Property[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(sanitize).filter((p): p is Property => p !== null) : []
  } catch (e) {
    console.error('物件データの読み込みに失敗しました', e)
    return []
  }
}

export function saveProperties(list: Property[]): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return null
  } catch (e) {
    console.error(e)
    return '保存に失敗しました（ブラウザの保存容量不足、またはプライベートモードの可能性があります）。JSONバックアップを取ってください。'
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const STATUSES: Status[] = ['main', 'considering', 'excluded']
const PARKINGS: Parking[] = ['yes', 'no', 'unknown']

/** 不正・欠損データを補正した Property を返す（物件として扱えないものは null） */
export function sanitize(o: unknown): Property | null {
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  const now = new Date().toISOString()
  const lat = num(r.lat)
  const lng = num(r.lng)
  const validPos = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  return {
    id: str(r.id) || uid(),
    name: str(r.name),
    address: str(r.address),
    rent: num(r.rent),
    managementFee: num(r.managementFee),
    deposit: num(r.deposit),
    keyMoney: num(r.keyMoney),
    layout: str(r.layout),
    area: num(r.area),
    ageYears: num(r.ageYears),
    builtYearMonth: str(r.builtYearMonth),
    parking: PARKINGS.includes(r.parking as Parking) ? (r.parking as Parking) : 'unknown',
    parkingFee: num(r.parkingFee),
    nearest: str(r.nearest),
    memo: str(r.memo),
    suumoUrl: str(r.suumoUrl),
    checkedDate: str(r.checkedDate),
    status: STATUSES.includes(r.status as Status) ? (r.status as Status) : 'considering',
    favorite: Boolean(r.favorite),
    lat: validPos ? lat : null,
    lng: validPos ? lng : null,
    locationApprox: Boolean(r.locationApprox),
    createdAt: str(r.createdAt) || now,
    updatedAt: str(r.updatedAt) || now,
  }
}

export function makeBackup(list: Property[]): BackupFile {
  return { app: 'itami-rental-map', version: 1, exportedAt: new Date().toISOString(), properties: list }
}

/** バックアップJSONを解析。配列そのもの、または BackupFile 形式に対応 */
export function parseBackup(text: string): Property[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('JSONとして読み込めませんでした。ファイルが壊れていないか確認してください。')
  }
  const arr = Array.isArray(data) ? data : (data as BackupFile)?.properties
  if (!Array.isArray(arr)) throw new Error('物件データ（properties）が見つかりません。このアプリでエクスポートしたJSONを選んでください。')
  return arr.map(sanitize).filter((p): p is Property => p !== null)
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
