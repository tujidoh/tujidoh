import type { Filters, SortKey, Status } from '../lib/types'
import { LAYOUT_OPTIONS, STATUS_COLOR, STATUS_LABEL } from '../lib/types'

export const DEFAULT_FILTERS: Filters = {
  maxRent: null,
  rentIncludesFee: true,
  layouts: [],
  minArea: null,
  parkingRequired: false,
  maxAge: null,
  statuses: ['main', 'considering', 'excluded'],
  favoriteOnly: false,
}

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  open: boolean
  onToggle: () => void
}

const numOrNull = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))

export default function FilterPanel({ filters: f, onChange, open, onToggle }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch })
  const active =
    f.maxRent != null || f.layouts.length > 0 || f.minArea != null || f.parkingRequired || f.maxAge != null || f.statuses.length < 3 || f.favoriteOnly
  const toggleStatus = (s: Status) =>
    set({ statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })
  const toggleLayout = (l: string) =>
    set({ layouts: f.layouts.includes(l) ? f.layouts.filter((x) => x !== l) : [...f.layouts, l] })

  return (
    <section className="card">
      <button className="section-head" onClick={onToggle} aria-expanded={open}>
        <span>A. 絞り込み{active && <span className="badge">適用中</span>}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="filters">
          <label className="row">
            <span className="lbl">家賃の上限</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              placeholder="例 9"
              value={f.maxRent == null ? '' : f.maxRent / 10000}
              onChange={(e) => {
                const v = numOrNull(e.target.value)
                set({ maxRent: v == null ? null : Math.round(v * 10000) })
              }}
            />
            <span>万円</span>
          </label>
          <label className="row small">
            <input type="checkbox" checked={f.rentIncludesFee} onChange={(e) => set({ rentIncludesFee: e.target.checked })} />
            管理費込みで判定
          </label>
          <div className="row wrap">
            <span className="lbl">間取り</span>
            <div className="chips">
              {LAYOUT_OPTIONS.map((l) => (
                <button key={l} className={'chip' + (f.layouts.includes(l) ? ' on' : '')} onClick={() => toggleLayout(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="row">
            <span className="lbl">専有面積</span>
            <input type="number" inputMode="decimal" min="0" placeholder="例 45" value={f.minArea ?? ''} onChange={(e) => set({ minArea: numOrNull(e.target.value) })} />
            <span>㎡以上</span>
          </label>
          <label className="row">
            <span className="lbl">築年数</span>
            <input type="number" inputMode="numeric" min="0" placeholder="例 20" value={f.maxAge ?? ''} onChange={(e) => set({ maxAge: numOrNull(e.target.value) })} />
            <span>年以内</span>
          </label>
          <label className="row small">
            <input type="checkbox" checked={f.parkingRequired} onChange={(e) => set({ parkingRequired: e.target.checked })} />
            駐車場ありのみ
          </label>
          <div className="row wrap">
            <span className="lbl">ステータス</span>
            <div className="chips">
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <button
                  key={s}
                  className={'chip' + (f.statuses.includes(s) ? ' on' : '')}
                  style={f.statuses.includes(s) ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] } : undefined}
                  onClick={() => toggleStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
              <button className={'chip' + (f.favoriteOnly ? ' on fav' : '')} onClick={() => set({ favoriteOnly: !f.favoriteOnly })}>
                ★お気に入り
              </button>
            </div>
          </div>
          {active && (
            <button className="btn link" onClick={() => onChange(DEFAULT_FILTERS)}>
              条件をリセット
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export const SORT_LABEL: Record<SortKey, string> = {
  rentAsc: '家賃が安い順',
  rentDesc: '家賃が高い順',
  areaDesc: '広い順',
  areaAsc: '狭い順',
  createdDesc: '登録が新しい順',
  createdAsc: '登録が古い順',
}
