import { get, set, del } from 'idb-keyval'
import type { FeatureCollection } from 'geojson'

/**
 * バス路線レイヤー。
 * - builtin: アプリ同梱データ（国土数値情報 2022年度、public/data/ 以下）
 * - imported: ユーザーが取り込んだ GeoJSON（IndexedDB に保存。サイズが大きくても localStorage の容量制限を受けない）
 */
export interface BusLayer {
  id: string
  name: string
  kind: 'routes' | 'stops' | 'mixed'
  source: string // 出典・年度
  builtin: boolean
  visible: boolean
  data: FeatureCollection
  color?: string // 取り込みデータの基本色
}

export const BUILTIN = [
  {
    id: 'builtin-routes',
    file: 'data/bus_routes_n07_2022.geojson',
    name: 'バス路線（国土数値情報 N07）',
    kind: 'routes' as const,
    source: '国土交通省 国土数値情報「バスルート」2022年度（令和4年度）データ / CC BY 4.0',
  },
  {
    id: 'builtin-stops',
    file: 'data/bus_stops_p11_2022.geojson',
    name: 'バス停（国土数値情報 P11）',
    kind: 'stops' as const,
    source: '国土交通省 国土数値情報「バス停留所」2022年度（令和4年度）データ / CC BY 4.0',
  },
]

export async function loadBuiltinLayers(): Promise<BusLayer[]> {
  const out: BusLayer[] = []
  for (const b of BUILTIN) {
    try {
      const res = await fetch(import.meta.env.BASE_URL + b.file)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as FeatureCollection
      out.push({ id: b.id, name: b.name, kind: b.kind, source: b.source, builtin: true, visible: true, data })
    } catch (e) {
      console.warn('同梱バスデータの読み込みに失敗', b.file, e)
    }
  }
  return out
}

const IDB_KEY = 'itami-rental-map:bus-layers:v1'

type StoredLayer = Omit<BusLayer, 'builtin'>

export async function loadImportedLayers(): Promise<BusLayer[]> {
  try {
    const arr = ((await get(IDB_KEY)) as StoredLayer[] | undefined) ?? []
    return arr.map((l) => ({ ...l, builtin: false }))
  } catch (e) {
    console.warn('取り込み済みGeoJSONの読み込みに失敗', e)
    return []
  }
}

export async function saveImportedLayers(layers: BusLayer[]) {
  const arr: StoredLayer[] = layers.filter((l) => !l.builtin).map(({ builtin: _b, ...rest }) => rest)
  if (arr.length === 0) await del(IDB_KEY)
  else await set(IDB_KEY, arr)
}

/** GeoJSON テキストを検証して FeatureCollection にする */
export function parseGeoJson(text: string): { data: FeatureCollection; kind: BusLayer['kind'] } {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error('JSONとして読み込めません。GeoJSON（.geojson / .json）ファイルを選んでください。')
  }
  const o = obj as { type?: string; features?: unknown[]; geometry?: unknown }
  let fc: FeatureCollection
  if (o?.type === 'FeatureCollection' && Array.isArray(o.features)) fc = obj as FeatureCollection
  else if (o?.type === 'Feature') fc = { type: 'FeatureCollection', features: [obj as FeatureCollection['features'][number]] }
  else throw new Error('GeoJSON の FeatureCollection / Feature ではありません。')
  const feats = fc.features.filter((f) => f && f.geometry && typeof f.geometry === 'object')
  if (feats.length === 0) throw new Error('位置情報（geometry）を持つ地物が含まれていません。')
  const types = new Set(feats.map((f) => f.geometry.type))
  const hasLine = [...types].some((t) => t.includes('LineString'))
  const hasPoint = [...types].some((t) => t.includes('Point'))
  // 座標がおおよそ日本付近か簡易チェック（緯度経度の入れ違い等を検出）
  const sample = firstCoord(feats[0].geometry as unknown as { coordinates: unknown })
  if (sample && !(sample[0] > 120 && sample[0] < 155 && sample[1] > 20 && sample[1] < 50)) {
    throw new Error(
      `座標が日本付近になっていません（例: ${sample.join(', ')}）。座標系が WGS84 / JGD2011 の経緯度（[経度, 緯度]）か確認してください。`,
    )
  }
  return { data: { type: 'FeatureCollection', features: feats }, kind: hasLine && hasPoint ? 'mixed' : hasLine ? 'routes' : 'stops' }
}

function firstCoord(g: { coordinates: unknown }): [number, number] | null {
  let c: unknown = g?.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return Array.isArray(c) && typeof c[0] === 'number' ? [c[0] as number, c[1] as number] : null
}

/** 事業者名から路線色を決める（同梱データ用） */
export function operatorColor(op: string): string {
  if (op.startsWith('伊丹市')) return '#1b9e4b' // 伊丹市営バス
  if (/阪急バス|阪急観光/.test(op)) return '#ef7d00' // 阪急バス
  if (/阪神バス|尼崎交通/.test(op)) return '#8e44ad' // 阪神バス
  if (/大阪シティ/.test(op)) return '#0097a7'
  if (/箕面/.test(op)) return '#c2185b'
  if (/宝塚|生瀬|西宮/.test(op)) return '#6d4c41'
  return '#455a64'
}

export function operatorLabel(op: string): string {
  return op === '伊丹市' ? '伊丹市営バス（伊丹市交通局）' : op
}

export const OPERATOR_GROUPS = [
  { key: 'itami', label: '伊丹市営バス', color: '#1b9e4b', test: (op: string) => op.startsWith('伊丹市') },
  { key: 'hankyu', label: '阪急バス', color: '#ef7d00', test: (op: string) => /阪急バス|阪急観光/.test(op) },
  { key: 'hanshin', label: '阪神バス', color: '#8e44ad', test: (op: string) => /阪神バス|尼崎交通/.test(op) },
  { key: 'other', label: 'その他（大阪シティバス・箕面市 等）', color: '#455a64', test: () => true },
]

export function operatorGroup(op: string) {
  return OPERATOR_GROUPS.find((g) => g.test(op))!.key
}

/** 取り込みデータ用: 文字列から安定した色を作る */
export function hashColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 70% 40%)`
}

/** 取り込みデータの路線名に使えそうなプロパティ */
export function featureTitle(props: Record<string, unknown> | null | undefined): string {
  if (!props) return ''
  const keys = ['route_long_name', 'route_short_name', 'route_name', 'line', 'name', 'N07_003', 'title', 'operator', 'boc', 'N07_002', 'stop_name', 'P11_001']
  for (const k of keys) {
    const v = props[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}
