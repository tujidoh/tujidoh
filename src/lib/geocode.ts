/**
 * 国土地理院「地名検索API（住所検索）」で住所から座標を取得する。
 * 無料・APIキー不要。個人利用の少量アクセスを想定（連続アクセスはしない）。
 * https://msearch.gsi.go.jp/address-search/AddressSearch?q=...
 */
export interface GeocodeResult {
  lat: number
  lng: number
  title: string
  approx: boolean // 番地まで特定できていない＝概略位置
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address.normalize('NFKC').trim()
  if (!q) return null
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`住所検索に失敗しました（HTTP ${res.status}）`)
  const data = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[]
  if (!Array.isArray(data) || data.length === 0) return null
  const f = data[0]
  const [lng, lat] = f.geometry.coordinates
  const title = f.properties.title ?? ''
  // 番地・号まで含まれていなければ概略位置とみなす
  const precise = /\d+\s*[-ー‐−の]\s*\d+|番|号/.test(q) && /(番|号)/.test(title)
  return { lat, lng, title, approx: !precise }
}
