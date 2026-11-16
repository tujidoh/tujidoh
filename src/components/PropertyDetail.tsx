import type { Property, Status } from '../lib/types'
import { STATUS_COLOR, STATUS_LABEL } from '../lib/types'
import { isSafeHttpUrl, man, rentPlusFee, totalWithParking, yen } from '../lib/util'

export interface NearStop {
  name: string
  operator: string
  distance: number // 直線距離 m
}

interface Props {
  p: Property | undefined
  nearStops: NearStop[]
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onStatus: (s: Status) => void
  onLocate: () => void
}

const parkingText = (p: Property) =>
  p.parking === 'yes' ? (p.parkingFee != null ? `あり ${yen(p.parkingFee)}/月` : 'あり（料金未入力）') : p.parking === 'no' ? 'なし' : '不明'

export default function PropertyDetail({ p, nearStops, onEdit, onDelete, onToggleFavorite, onStatus, onLocate }: Props) {
  if (!p) {
    return (
      <section className="card" id="detail">
        <div className="section-head static">C. 選択物件の詳細</div>
        <p className="empty muted">一覧または地図のピンを選ぶと詳細が表示されます。</p>
      </section>
    )
  }
  const rf = rentPlusFee(p)
  const tot = totalWithParking(p)
  const urlOk = isSafeHttpUrl(p.suumoUrl)
  return (
    <section className="card detail" id="detail">
      <div className="section-head static">C. 選択物件の詳細</div>
      <div className="detail-title">
        <h2>{p.name || '（名称未設定）'}</h2>
        <button className={'fav big' + (p.favorite ? ' on' : '')} onClick={onToggleFavorite} title="お気に入り">
          {p.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="seg" role="group" aria-label="検討ステータス">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <button
            key={s}
            className={p.status === s ? 'on' : ''}
            style={p.status === s ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] } : undefined}
            onClick={() => onStatus(s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="money">
        <div>
          <small>家賃＋管理費</small>
          <b>{rf != null ? man(rf) : '—'}</b>
        </div>
        <div>
          <small>駐車場込み合計</small>
          <b>{tot != null ? man(tot) : '—'}</b>
          {p.parking === 'yes' && p.parkingFee == null && <small className="warn">駐車場料金未入力</small>}
        </div>
      </div>

      <dl className="kv">
        <dt>住所</dt>
        <dd>
          {p.address || '—'}
          {p.lat == null ? <span className="tag warn">位置未設定</span> : p.locationApprox && <span className="tag">位置は概略</span>}
          {p.lat != null && (
            <button className="btn link inline" onClick={onLocate}>
              地図で表示
            </button>
          )}
        </dd>
        <dt>家賃</dt>
        <dd>{yen(p.rent)}</dd>
        <dt>管理費</dt>
        <dd>{yen(p.managementFee)}</dd>
        <dt>敷金 / 礼金</dt>
        <dd>
          {yen(p.deposit)} / {yen(p.keyMoney)}
        </dd>
        <dt>間取り</dt>
        <dd>{p.layout || '—'}</dd>
        <dt>専有面積</dt>
        <dd>{p.area != null ? `${p.area}㎡` : '—'}</dd>
        <dt>築年数</dt>
        <dd>
          {p.ageYears != null ? (p.ageYears === 0 ? '新築' : `築${p.ageYears}年`) : '—'}
          {p.builtYearMonth && <small className="muted">（{p.builtYearMonth}築）</small>}
        </dd>
        <dt>駐車場</dt>
        <dd>{parkingText(p)}</dd>
        <dt>最寄り駅・バス停</dt>
        <dd className="pre">{p.nearest || '—'}</dd>
        <dt>近くのバス停</dt>
        <dd>
          {p.lat == null ? (
            '—'
          ) : nearStops.length === 0 ? (
            <span className="muted">半径1km以内に同梱データのバス停なし</span>
          ) : (
            <>
              <ul className="near">
                {nearStops.map((s, i) => (
                  <li key={i}>
                    {s.name} <small className="muted">{s.operator}</small> <b>約{Math.round(s.distance / 10) * 10}m</b>
                  </li>
                ))}
              </ul>
              <small className="muted">※地図上の直線距離です（実際の徒歩経路・時間ではありません）。{p.locationApprox && '物件位置が概略のため誤差があります。'}</small>
            </>
          )}
        </dd>
        <dt>メモ</dt>
        <dd className="pre">{p.memo || '—'}</dd>
        <dt>掲載URL</dt>
        <dd className="url">{p.suumoUrl ? <span title={p.suumoUrl}>{p.suumoUrl}</span> : '—'}</dd>
        <dt>情報確認日</dt>
        <dd>{p.checkedDate || '—'}</dd>
      </dl>

      <div className="actions">
        <button className="btn" onClick={onEdit}>
          ✎ 編集
        </button>
        <button className="btn danger" onClick={onDelete}>
          🗑 削除
        </button>
        <button className={'btn' + (p.favorite ? ' fav-on' : '')} onClick={onToggleFavorite}>
          {p.favorite ? '★ お気に入り解除' : '☆ お気に入り'}
        </button>
        {urlOk ? (
          <a className="btn primary" href={p.suumoUrl} target="_blank" rel="noopener noreferrer">
            SUUMOで開く ↗
          </a>
        ) : (
          <button className="btn primary" disabled title="URLが登録されていません">
            SUUMOで開く
          </button>
        )}
      </div>
    </section>
  )
}
