import type { Property, SortKey } from '../lib/types'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/types'
import { man, rentPlusFee } from '../lib/util'
import { SORT_LABEL } from './FilterPanel'

interface Props {
  items: Property[]
  total: number
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  onAdd: () => void
}

export default function PropertyList({ items, total, selectedId, onSelect, onToggleFavorite, sort, onSort, onAdd }: Props) {
  return (
    <section className="card">
      <div className="section-head static">
        <span>
          B. 候補物件一覧 <small className="muted">{items.length}/{total}件</small>
        </span>
        <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} aria-label="並べ替え">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {total === 0 ? (
        <div className="empty">
          <p>まだ物件が登録されていません。</p>
          <button className="btn primary" onClick={onAdd}>
            ＋ 最初の物件を追加
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="empty muted">条件に合う物件がありません。</p>
      ) : (
        <ul className="plist">
          {items.map((p) => {
            const t = rentPlusFee(p)
            return (
              <li key={p.id} className={p.id === selectedId ? 'sel' : ''}>
                <button className="pitem" onClick={() => onSelect(p.id)}>
                  <span className="dot" style={{ background: STATUS_COLOR[p.status] }} title={STATUS_LABEL[p.status]} />
                  <span className="pname">
                    {p.name || '（名称未設定）'}
                    {p.lat == null && <small className="warn"> 位置未設定</small>}
                  </span>
                  <span className="pmeta">
                    <b>{t != null ? man(t) : '家賃未入力'}</b>
                    <small>{p.layout || '—'}{p.area != null ? ` / ${p.area}㎡` : ''}</small>
                  </span>
                </button>
                <button
                  className={'fav' + (p.favorite ? ' on' : '')}
                  onClick={() => onToggleFavorite(p.id)}
                  aria-label={p.favorite ? 'お気に入り解除' : 'お気に入り登録'}
                  title={p.favorite ? 'お気に入り解除' : 'お気に入り登録'}
                >
                  {p.favorite ? '★' : '☆'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
