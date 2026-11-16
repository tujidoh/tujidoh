import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import FilterPanel, { DEFAULT_FILTERS } from './components/FilterPanel'
import PropertyList from './components/PropertyList'
import PropertyDetail, { type NearStop } from './components/PropertyDetail'
import PropertyForm from './components/PropertyForm'
import CompareModal from './components/CompareModal'
import DataModal from './components/DataModal'
import LayerControl from './components/LayerControl'
import type { Filters, Property, SortKey, Status } from './lib/types'
import { loadProperties, saveProperties } from './lib/storage'
import { haversine, layoutGroup, rentPlusFee } from './lib/util'
import type { BusLayer } from './lib/busData'
import { loadBuiltinLayers, loadImportedLayers, operatorLabel, saveImportedLayers } from './lib/busData'
import { useCloudSync, type Cloud } from './useCloudSync'
import SyncBadge from './components/SyncBadge'

const UI_KEY = 'itami-rental-map:ui:v1'
function loadUi(): { filters: Filters; sort: SortKey } {
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY) || '{}')
    return { filters: { ...DEFAULT_FILTERS, ...u.filters }, sort: u.sort ?? 'createdDesc' }
  } catch {
    return { filters: DEFAULT_FILTERS, sort: 'createdDesc' }
  }
}

type Modal = { type: 'form'; editing: Property | null } | { type: 'compare' } | { type: 'data' } | null

export default function App({ cloud }: { cloud: Cloud | null }) {
  const [properties, setProperties] = useState<Property[]>(() => loadProperties())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(() => loadUi().filters)
  const [sort, setSort] = useState<SortKey>(() => loadUi().sort)
  const [filterOpen, setFilterOpen] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [panelOpen, setPanelOpen] = useState(true) // スマホ用
  const [focusTick, setFocusTick] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [busLayers, setBusLayers] = useState<BusLayer[]>([])
  const [operatorVisible, setOperatorVisible] = useState<Record<string, boolean>>({})
  const [stopsVisible, setStopsVisible] = useState(true)
  const [pick, setPick] = useState<{ cb: (lat: number, lng: number) => void; pos: { lat: number; lng: number } | null } | null>(null)
  const sync = useCloudSync(cloud, properties, setProperties)
  const firstSave = useRef(true)
  const detailRef = useRef<HTMLDivElement>(null)

  // 保存
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false
      return
    }
    setSaveError(saveProperties(properties))
  }, [properties])
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ filters, sort }))
    } catch {
      /* 無視 */
    }
  }, [filters, sort])

  // バスデータ読み込み
  useEffect(() => {
    void (async () => {
      const [b, i] = await Promise.all([loadBuiltinLayers(), loadImportedLayers()])
      setBusLayers([...b, ...i])
    })()
  }, [])
  const updateLayers = useCallback((fn: (l: BusLayer[]) => BusLayer[]) => {
    setBusLayers((prev) => {
      const next = fn(prev)
      saveImportedLayers(next).catch((e) => {
        console.error(e)
        setToast('取り込んだGeoJSONの保存に失敗しました（容量不足の可能性）')
      })
      return next
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // 絞り込み・並べ替え
  const visible = useMemo(() => {
    const f = filters
    const list = properties.filter((p) => {
      if (!f.statuses.includes(p.status)) return false
      if (f.favoriteOnly && !p.favorite) return false
      if (f.maxRent != null) {
        const v = f.rentIncludesFee ? rentPlusFee(p) : p.rent
        if (v == null || v > f.maxRent) return false
      }
      if (f.layouts.length && !f.layouts.includes(layoutGroup(p.layout))) return false
      if (f.minArea != null && (p.area == null || p.area < f.minArea)) return false
      if (f.parkingRequired && p.parking !== 'yes') return false
      if (f.maxAge != null && (p.ageYears == null || p.ageYears > f.maxAge)) return false
      return true
    })
    const nullLast = (a: number | null, b: number | null, dir: 1 | -1) => (a == null ? 1 : b == null ? -1 : (a - b) * dir)
    list.sort((a, b) => {
      switch (sort) {
        case 'rentAsc':
          return nullLast(rentPlusFee(a), rentPlusFee(b), 1)
        case 'rentDesc':
          return nullLast(rentPlusFee(a), rentPlusFee(b), -1)
        case 'areaDesc':
          return nullLast(a.area, b.area, -1)
        case 'areaAsc':
          return nullLast(a.area, b.area, 1)
        case 'createdAsc':
          return a.createdAt.localeCompare(b.createdAt)
        default:
          return b.createdAt.localeCompare(a.createdAt)
      }
    })
    return list
  }, [properties, filters, sort])

  const selected = properties.find((p) => p.id === selectedId)

  // バス停（直線距離計算用）
  const allStops = useMemo(() => {
    const out: { name: string; operator: string; lat: number; lng: number }[] = []
    for (const l of busLayers) {
      if (l.kind === 'routes') continue
      for (const f of l.data.features) {
        if (f.geometry?.type !== 'Point') continue
        const [lng, lat] = f.geometry.coordinates as [number, number]
        const pr = (f.properties ?? {}) as Record<string, unknown>
        out.push({
          name: String(pr.name ?? pr.stop_name ?? pr.P11_001 ?? '(名称なし)'),
          operator: l.builtin ? String(pr.operator ?? '').split('、').map(operatorLabel).join('、').replace('（伊丹市交通局）', '') : l.name,
          lat,
          lng,
        })
      }
    }
    return out
  }, [busLayers])

  const nearStopsOf = useCallback(
    (p: Property, n = 3, maxDist = 1000): NearStop[] => {
      if (p.lat == null || p.lng == null) return []
      const seen = new Set<string>()
      return allStops
        .map((s) => ({ name: s.name, operator: s.operator, distance: haversine(p.lat!, p.lng!, s.lat, s.lng) }))
        .filter((s) => s.distance <= maxDist)
        .sort((a, b) => a.distance - b.distance)
        .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
        .slice(0, n)
    },
    [allStops],
  )
  const nearStops = useMemo(() => (selected ? nearStopsOf(selected) : []), [selected, nearStopsOf])

  // 操作
  const select = (id: string, fly = true) => {
    setSelectedId(id)
    setPanelOpen(true)
    if (fly) setFocusTick((t) => t + 1)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const update = (id: string, patch: Partial<Property>) =>
    setProperties((list) => list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)))
  const toggleFav = (id: string) => {
    const p = properties.find((x) => x.id === id)
    if (p) update(id, { favorite: !p.favorite })
  }
  const remove = (id: string) => {
    const p = properties.find((x) => x.id === id)
    if (!p || !confirm(`「${p.name || '名称未設定'}」を削除しますか？\nこの操作は元に戻せません。`)) return
    setProperties((list) => list.filter((x) => x.id !== id))
    setSelectedId(null)
    setToast('削除しました')
  }
  const saveForm = (p: Property) => {
    setProperties((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]))
    const isNew = !properties.some((x) => x.id === p.id)
    setModal(null)
    setToast(isNew ? '物件を登録しました' : '変更を保存しました')
    // 絞り込みで新規物件が隠れないよう、ステータス条件だけは補う
    if (!filters.statuses.includes(p.status)) setFilters((f) => ({ ...f, statuses: [...f.statuses, p.status] }))
    select(p.id, true)
  }

  const formModal = modal?.type === 'form' ? modal : null

  return (
    <div className={'app' + (panelOpen ? ' panel-open' : '') + (cloud ? ' cloud' : '')}>
      <header className="topbar">
        <h1>
          <span className="logo">🏠</span> <span className="title-text">伊丹 賃貸比較マップ</span>
        </h1>
        <div className="top-actions">
          <button className="btn primary" aria-label="物件を追加" onClick={() => setModal({ type: 'form', editing: null })}>
            <span className="hide-sm">＋ 物件を追加</span>
            <span className="show-sm">＋ 追加</span>
          </button>
          <button className="btn" aria-label="比較表" onClick={() => setModal({ type: 'compare' })} disabled={properties.length === 0}>
            <span className="hide-sm">比較表</span>
            <span className="show-sm">比較</span>
          </button>
          {cloud && <SyncBadge state={sync.state} realtime={sync.realtime} onClick={() => setModal({ type: 'data' })} />}
          <button className="btn" aria-label="データ管理" onClick={() => setModal({ type: 'data' })}>
            <span className="hide-sm">データ管理</span>
            <span className="show-sm">データ</span>
          </button>
        </div>
      </header>

      {saveError && <div className="banner error">{saveError}</div>}

      <div className="main">
        <aside className="panel" aria-label="操作パネル">
          <button className="panel-handle" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
            <span className="grip" />
            {panelOpen ? '▼ 地図を広く表示' : `▲ 一覧・詳細を開く（${visible.length}件）`}
          </button>
          <div className="panel-scroll">
            <FilterPanel filters={filters} onChange={setFilters} open={filterOpen} onToggle={() => setFilterOpen(!filterOpen)} />
            <PropertyList
              items={visible}
              total={properties.length}
              selectedId={selectedId}
              onSelect={(id) => select(id)}
              onToggleFavorite={toggleFav}
              sort={sort}
              onSort={setSort}
              onAdd={() => setModal({ type: 'form', editing: null })}
            />
            <div ref={detailRef}>
              <PropertyDetail
                p={selected}
                nearStops={nearStops}
                onEdit={() => selected && setModal({ type: 'form', editing: selected })}
                onDelete={() => selected && remove(selected.id)}
                onToggleFavorite={() => selected && toggleFav(selected.id)}
                onStatus={(s: Status) => selected && update(selected.id, { status: s })}
                onLocate={() => {
                  setFocusTick((t) => t + 1)
                  if (window.innerWidth <= 800) setPanelOpen(false)
                }}
              />
            </div>
          </div>
        </aside>

        <main className="map-wrap">
          <MapView
            properties={visible}
            selectedId={selectedId}
            onSelect={(id) => select(id, window.innerWidth <= 800)}
            busLayers={busLayers}
            operatorVisible={operatorVisible}
            stopsVisible={stopsVisible}
            pickMode={!!pick}
            draftPos={pick?.pos ?? null}
            onPick={(lat, lng) => {
              pick?.cb(lat, lng)
              setPick(null)
            }}
            focusTick={focusTick}
          />
          <LayerControl
            layers={busLayers}
            operatorVisible={operatorVisible}
            onOperator={(k, v) => setOperatorVisible((o) => ({ ...o, [k]: v }))}
            stopsVisible={stopsVisible}
            onStops={setStopsVisible}
            onLayerVisible={(id, v) => updateLayers((ls) => ls.map((l) => (l.id === id ? { ...l, visible: v } : l)))}
          />
          {pick && (
            <div className="pick-banner">
              📍 物件の位置を地図上でクリック（タップ）してください
              <button className="btn small" onClick={() => setPick(null)}>
                キャンセル
              </button>
            </div>
          )}
        </main>
      </div>

      {formModal && (
        <PropertyForm
          key={formModal.editing?.id ?? 'new'}
          initial={formModal.editing}
          all={properties}
          hidden={!!pick}
          onCancel={() => {
            setPick(null)
            setModal(null)
          }}
          onSave={saveForm}
          onRequestPick={(pos, cb) => {
            setPick({ pos, cb })
            if (window.innerWidth <= 800) setPanelOpen(false)
          }}
        />
      )}
      {modal?.type === 'compare' && (
        <CompareModal
          items={visible}
          nearestStop={(p) => nearStopsOf(p, 1)[0] ?? null}
          onClose={() => setModal(null)}
          onSelect={(id) => {
            setModal(null)
            select(id)
          }}
        />
      )}
      {modal?.type === 'data' && (
        <DataModal
          properties={properties}
          busLayers={busLayers}
          onReplace={(list) => {
            setProperties(list)
            setSelectedId(null)
          }}
          onAddLayer={(l) => updateLayers((ls) => [...ls, l])}
          onRemoveLayer={(id) => updateLayers((ls) => ls.filter((l) => l.id !== id))}
          onClose={() => setModal(null)}
          account={
            cloud
              ? {
                  email: cloud.user.email ?? '',
                  state: sync.state,
                  realtime: sync.realtime,
                  onSyncNow: () => void sync.syncNow(),
                  onLogout: async () => {
                    const n = sync.pendingCount()
                    if (
                      !confirm(
                        (n > 0 ? `⚠ まだ送信されていない変更が${n}件あります。今ログアウトすると失われます。\n\n` : '') +
                          'ログアウトしますか？\n（このブラウザに保存された物件データは消去されます。共有データはサーバーに残ります）',
                      )
                    )
                      return
                    sync.clear()
                    try {
                      localStorage.removeItem('itami-rental-map:properties:v1')
                    } catch {
                      /* 無視 */
                    }
                    await cloud.client.auth.signOut()
                  },
                }
              : null
          }
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
