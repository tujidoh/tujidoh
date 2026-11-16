import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, Marker, Circle, useMap, useMapEvents, ScaleControl } from 'react-leaflet'
import L from 'leaflet'
import type { Feature } from 'geojson'
import type { Property } from '../lib/types'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/types'
import type { BusLayer } from '../lib/busData'
import { featureTitle, hashColor, operatorColor, operatorGroup, operatorLabel } from '../lib/busData'
import { man, rentPlusFee } from '../lib/util'

export const INITIAL_CENTER: [number, number] = [34.784, 135.405] // 伊丹市中心部付近
export const INITIAL_ZOOM = 13
// 対象エリア（伊丹市・尼崎市北部・宝塚市南部・川西市南部・豊中市周辺）よりやや広め
const MAX_BOUNDS = L.latLngBounds([34.55, 135.15], [35.05, 135.7])

interface Props {
  properties: Property[]
  selectedId: string | null
  onSelect: (id: string) => void
  busLayers: BusLayer[]
  operatorVisible: Record<string, boolean>
  stopsVisible: boolean
  pickMode: boolean
  draftPos: { lat: number; lng: number } | null
  onPick: (lat: number, lng: number) => void
  focusTick: number
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function pinIcon(color: string, selected: boolean, favorite: boolean, approx: boolean) {
  const s = selected ? 44 : 32
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24">
    <path d="M12 1.5C7.3 1.5 3.6 5.2 3.6 9.8c0 6.1 7.4 12.2 7.7 12.5.4.3.9.3 1.3 0 .3-.3 7.7-6.4 7.7-12.5 0-4.6-3.7-8.3-8.3-8.3z"
      fill="${color}" stroke="${selected ? '#111' : '#fff'}" stroke-width="${selected ? 1.8 : 1.4}" ${approx ? 'stroke-dasharray="2 1.5"' : ''}/>
    ${favorite ? '<path d="M12 5.2l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z" fill="#ffd54f"/>' : '<circle cx="12" cy="9.6" r="3" fill="#fff"/>'}
  </svg>`
  return L.divIcon({
    html: svg,
    className: 'prop-pin' + (selected ? ' selected' : ''),
    iconSize: [s, s],
    iconAnchor: [s / 2, s - 1],
  })
}

const draftIcon = L.divIcon({
  html: '<div class="draft-pin">＋</div>',
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

function MapEvents({ pickMode, onPick, onZoom }: { pickMode: boolean; onPick: Props['onPick']; onZoom: (z: number) => void }) {
  const map = useMapEvents({
    click(e) {
      if (pickMode) onPick(e.latlng.lat, e.latlng.lng)
    },
    zoomend() {
      onZoom(map.getZoom())
    },
  })
  useEffect(() => {
    map.getContainer().style.cursor = pickMode ? 'crosshair' : ''
  }, [pickMode, map])
  return null
}

function FlyToSelected({ target, tick }: { target: Property | undefined; tick: number }) {
  const map = useMap()
  useEffect(() => {
    if (target?.lat != null && target.lng != null) {
      const zoom = Math.max(map.getZoom(), 15)
      // スマホでは下からパネルが出るので、ピンが画面上部に来るよう中心をずらす
      const offsetY = window.innerWidth <= 800 ? map.getSize().y * 0.3 : 0
      const pt = map.project([target.lat, target.lng], zoom).add([0, offsetY])
      map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.6 })
    }
    // tick が変わったとき（一覧から選択したとき）だけ移動する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  return null
}

/** コンテナのサイズ変化（スマホのパネル開閉・画面回転など）に追従 */
function AutoResize() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

export default function MapView(p: Props) {
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const selected = p.properties.find((x) => x.id === p.selectedId)
  const renderer = useMemo(() => L.canvas({ padding: 0.5, tolerance: 6 }), [])

  const opKey = Object.entries(p.operatorVisible)
    .map(([k, v]) => `${k}${v ? 1 : 0}`)
    .join('')
  const showStopLabels = zoom >= 16

  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      minZoom={11}
      maxZoom={19}
      maxBounds={MAX_BOUNDS}
      className="map"
      preferCanvas
    >
      <TileLayer
        // OSM 標準タイル。タイル利用ポリシー: https://operations.osmfoundation.org/policies/tiles/
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors | バス: <a href="https://nlftp.mlit.go.jp/ksj/" target="_blank" rel="noopener">国土数値情報</a>（国土交通省）2022年度を加工'
        maxZoom={19}
      />
      <ScaleControl imperial={false} position="bottomleft" />
      <AutoResize />
      <MapEvents pickMode={p.pickMode} onPick={p.onPick} onZoom={setZoom} />
      <FlyToSelected target={selected} tick={p.focusTick} />

      {p.busLayers
        .filter((l) => l.visible && l.kind !== 'stops')
        .map((l) => (
          <GeoJSON
            key={l.id + (l.builtin ? opKey : '')}
            data={l.data}
            filter={(f: Feature) =>
              f.geometry.type.includes('LineString') &&
              (!l.builtin || p.operatorVisible[operatorGroup(String(f.properties?.operator ?? ''))] !== false)
            }
            style={(f) => {
              const op = String(f?.properties?.operator ?? '')
              const color = l.builtin ? operatorColor(op) : l.color || hashColor(featureTitle(f?.properties) || l.name)
              return { color, weight: 4, opacity: 0.75, renderer } as L.PathOptions
            }}
            onEachFeature={(f, layer) => {
              const pr = (f.properties ?? {}) as Record<string, unknown>
              const html = l.builtin
                ? `<b>${esc(operatorLabel(String(pr.operator ?? '')))}</b><br><small>${esc(l.source)}<br>※系統名はこのデータに含まれていません。周辺のバス停をクリックすると系統名を確認できます。</small>`
                : `<b>${esc(featureTitle(pr) || l.name)}</b><br>${propTable(pr)}<small>${esc(l.name)}</small>`
              layer.bindPopup(html, { maxWidth: 280 })
              layer.bindTooltip(esc(l.builtin ? operatorLabel(String(pr.operator ?? '')) : featureTitle(pr) || l.name), { sticky: true })
            }}
          />
        ))}

      {p.stopsVisible &&
        zoom >= 13 &&
        p.busLayers
          .filter((l) => l.visible && l.kind !== 'routes')
          .map((l) => (
            <GeoJSON
              key={l.id + (showStopLabels ? '-label' : '')}
              data={l.data}
              filter={(f: Feature) => f.geometry.type === 'Point'}
              pointToLayer={(_f, latlng) =>
                L.circleMarker(latlng, {
                  radius: zoom >= 15 ? 5 : 3.5,
                  color: '#fff',
                  weight: 1.5,
                  fillColor: l.builtin ? '#0d47a1' : l.color || '#00695c',
                  fillOpacity: 1,
                  renderer,
                })
              }
              onEachFeature={(f, layer) => {
                const pr = (f.properties ?? {}) as Record<string, unknown>
                const name = String(pr.name ?? pr.stop_name ?? pr.P11_001 ?? featureTitle(pr) ?? '')
                const html = l.builtin
                  ? `<b>🚏 ${esc(name)}</b><br>事業者: ${esc(String(pr.operator ?? '').replace(/^伊丹市(?=$|、)/, '伊丹市営バス'))}<br>系統: ${esc(pr.lines)}<br><small>${esc(l.source)}</small>`
                  : `<b>🚏 ${esc(name)}</b><br>${propTable(pr)}<small>${esc(l.name)}</small>`
                layer.bindPopup(html, { maxWidth: 300 })
                layer.bindTooltip(esc(name), showStopLabels ? { permanent: true, direction: 'right', className: 'stop-label', offset: [6, 0] } : { direction: 'top' })
              }}
            />
          ))}

      {selected?.lat != null && selected.lng != null && selected.locationApprox && (
        <Circle center={[selected.lat, selected.lng]} radius={150} pathOptions={{ color: '#111', weight: 1.5, dashArray: '4 4', fillOpacity: 0.05 }} />
      )}

      {p.properties
        .filter((x) => x.lat != null && x.lng != null)
        .map((x) => {
          const sel = x.id === p.selectedId
          const t = rentPlusFee(x)
          return (
            <Marker
              key={x.id + (sel ? '-s' : '') + (x.favorite ? 'f' : '') + x.status + (x.locationApprox ? 'a' : '')}
              position={[x.lat!, x.lng!]}
              icon={pinIcon(STATUS_COLOR[x.status], sel, x.favorite, x.locationApprox)}
              zIndexOffset={sel ? 1000 : x.status === 'main' ? 500 : x.status === 'excluded' ? -500 : 0}
              title={`${x.name}（${STATUS_LABEL[x.status]}）${t != null ? ' ' + man(t) : ''}`}
              eventHandlers={{ click: () => !p.pickMode && p.onSelect(x.id) }}
            />
          )
        })}

      {p.pickMode && p.draftPos && <Marker position={[p.draftPos.lat, p.draftPos.lng]} icon={draftIcon} interactive={false} />}
    </MapContainer>
  )
}

function propTable(pr: Record<string, unknown>) {
  const rows = Object.entries(pr)
    .filter(([, v]) => v != null && typeof v !== 'object' && String(v).length < 120)
    .slice(0, 8)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')
  return rows ? `<table class="popup-table">${rows}</table>` : ''
}
