import { useMemo, useState } from 'react'
import type { Parking, Property, Status } from '../lib/types'
import { STATUS_LABEL } from '../lib/types'
import { parseListingText, FIELD_LABEL, type ParsedField } from '../lib/parser'
import { geocodeAddress } from '../lib/geocode'
import { normalizeUrl, today, uid } from '../lib/util'

interface Props {
  initial: Property | null // null = 新規
  all: Property[]
  hidden: boolean // 地図で位置指定中は隠す
  onCancel: () => void
  onSave: (p: Property) => void
  onRequestPick: (current: { lat: number; lng: number } | null, cb: (lat: number, lng: number) => void) => void
}

// 入力欄はすべて文字列で保持し、保存時に数値化する
interface Draft {
  name: string
  address: string
  rentMan: string // 万円
  fee: string // 円
  depositMan: string // 万円
  keyMoneyMan: string // 万円
  layout: string
  area: string
  ageYears: string
  builtYearMonth: string
  parking: Parking
  parkingFee: string // 円
  nearest: string
  memo: string
  suumoUrl: string
  checkedDate: string
  status: Status
  favorite: boolean
  lat: number | null
  lng: number | null
  locationApprox: boolean
}

const s = (v: number | null | undefined, div = 1) => (v == null ? '' : String(Math.round((v / div) * 10000) / 10000))

function toDraft(p: Property | null): Draft {
  return {
    name: p?.name ?? '',
    address: p?.address ?? '',
    rentMan: s(p?.rent, 10000),
    fee: s(p?.managementFee),
    depositMan: s(p?.deposit, 10000),
    keyMoneyMan: s(p?.keyMoney, 10000),
    layout: p?.layout ?? '',
    area: s(p?.area),
    ageYears: s(p?.ageYears),
    builtYearMonth: p?.builtYearMonth ?? '',
    parking: p?.parking ?? 'unknown',
    parkingFee: s(p?.parkingFee),
    nearest: p?.nearest ?? '',
    memo: p?.memo ?? '',
    suumoUrl: p?.suumoUrl ?? '',
    checkedDate: p?.checkedDate || today(),
    status: p?.status ?? 'considering',
    favorite: p?.favorite ?? false,
    lat: p?.lat ?? null,
    lng: p?.lng ?? null,
    locationApprox: p?.locationApprox ?? false,
  }
}

const toNum = (v: string, mul = 1): number | null => {
  const t = v.normalize('NFKC').replace(/[,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * mul * 100) / 100 : null
}

export default function PropertyForm({ initial, all, hidden, onCancel, onSave, onRequestPick }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial))
  const [paste, setPaste] = useState('')
  const [parseInfo, setParseInfo] = useState<{ found: ParsedField[]; missing: ParsedField[] } | null>(null)
  const [hl, setHl] = useState<Set<string>>(new Set())
  const [geoMsg, setGeoMsg] = useState<string>('')
  const [geoBusy, setGeoBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))

  const dup = useMemo(() => {
    const n = normalizeUrl(d.suumoUrl)
    if (!n) return null
    return all.find((p) => p.id !== initial?.id && normalizeUrl(p.suumoUrl) === n) ?? null
  }, [d.suumoUrl, all, initial])

  async function geocode(address: string) {
    if (!address.trim()) {
      setGeoMsg('住所を入力してください。')
      return
    }
    setGeoBusy(true)
    setGeoMsg('住所から位置を検索中…')
    try {
      const r = await geocodeAddress(address)
      if (!r) {
        setGeoMsg('住所から位置を特定できませんでした。「地図をクリックして指定」で位置を設定してください。')
      } else {
        set({ lat: r.lat, lng: r.lng, locationApprox: r.approx })
        setGeoMsg(`位置を設定しました：${r.title}${r.approx ? '（番地まで特定できないため「位置は概略」としました）' : ''}`)
      }
    } catch (e) {
      setGeoMsg(`住所検索に接続できませんでした（${e instanceof Error ? e.message : e}）。「地図をクリックして指定」で位置を設定してください。`)
    } finally {
      setGeoBusy(false)
    }
  }

  function runParse() {
    const r = parseListingText(paste)
    const v = r.values
    const patch: Partial<Draft> = {}
    if (v.name !== undefined) patch.name = v.name
    if (v.address !== undefined) patch.address = v.address
    if (v.rent !== undefined) patch.rentMan = s(v.rent, 10000)
    if (v.managementFee !== undefined) patch.fee = s(v.managementFee)
    if (v.deposit !== undefined) patch.depositMan = s(v.deposit, 10000)
    if (v.keyMoney !== undefined) patch.keyMoneyMan = s(v.keyMoney, 10000)
    if (v.layout !== undefined) patch.layout = v.layout
    if (v.area !== undefined) patch.area = s(v.area)
    if (v.ageYears !== undefined) patch.ageYears = s(v.ageYears)
    if (v.builtYearMonth !== undefined) patch.builtYearMonth = v.builtYearMonth
    if (v.parking !== undefined) patch.parking = v.parking
    if (v.parkingFee !== undefined) patch.parkingFee = s(v.parkingFee)
    if (v.nearest !== undefined) patch.nearest = v.nearest
    if (v.suumoUrl !== undefined && !d.suumoUrl) patch.suumoUrl = v.suumoUrl
    set(patch)
    const allFields = Object.keys(FIELD_LABEL) as ParsedField[]
    setParseInfo({ found: r.found, missing: allFields.filter((f) => !r.found.includes(f) && f !== 'suumoUrl' && f !== 'builtYearMonth') })
    setHl(new Set(r.found))
    // 住所が取れて、まだ位置が未設定なら自動で位置検索
    if (v.address && d.lat == null) void geocode(v.address)
  }

  function submit() {
    setError('')
    if (!d.name.trim() && !d.address.trim()) {
      setError('物件名または住所のどちらかを入力してください。')
      return
    }
    if (dup && !confirm(`同じSUUMO URLの物件「${dup.name || '名称未設定'}」が既に登録されています。\nそれでも別の物件として登録しますか？`)) return
    if (d.lat == null && !confirm('位置が設定されていないため、地図にピンが表示されません。このまま保存しますか？\n（後から「編集」で設定できます）')) return
    const now = new Date().toISOString()
    const p: Property = {
      id: initial?.id ?? uid(),
      name: d.name.trim() || d.address.trim(),
      address: d.address.trim(),
      rent: toNum(d.rentMan, 10000),
      managementFee: toNum(d.fee),
      deposit: toNum(d.depositMan, 10000),
      keyMoney: toNum(d.keyMoneyMan, 10000),
      layout: d.layout.normalize('NFKC').trim().toUpperCase().replace('ワンルーム', '1R'),
      area: toNum(d.area),
      ageYears: toNum(d.ageYears),
      builtYearMonth: d.builtYearMonth.trim(),
      parking: d.parking,
      parkingFee: d.parking === 'yes' ? toNum(d.parkingFee) : null,
      nearest: d.nearest.trim(),
      memo: d.memo,
      suumoUrl: d.suumoUrl.trim(),
      checkedDate: d.checkedDate,
      status: d.status,
      favorite: d.favorite,
      lat: d.lat,
      lng: d.lng,
      locationApprox: d.locationApprox,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    onSave(p)
  }

  const c = (k: string) => (hl.has(k) ? 'filled' : '')

  return (
    <div className="modal-back" style={hidden ? { display: 'none' } : undefined}>
      <div className="modal form-modal" role="dialog" aria-modal="true" aria-label={initial ? '物件を編集' : '物件を追加'}>
        <header className="modal-head">
          <h2>{initial ? '物件を編集' : '物件を追加'}</h2>
          <button className="btn icon" onClick={onCancel} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <fieldset>
            <legend>① SUUMOの物件URL</legend>
            <input
              type="url"
              placeholder="https://suumo.jp/chintai/jnc_..."
              value={d.suumoUrl}
              onChange={(e) => set({ suumoUrl: e.target.value })}
            />
            {dup && <p className="alert">⚠ このURLは既に「{dup.name || '名称未設定'}」として登録されています（重複登録に注意）。</p>}
            <p className="hint">URLだけでは情報を自動取得しません（SUUMOへの自動アクセスは行いません）。下の②で掲載文を貼り付けるか、③に手入力してください。</p>
          </fieldset>

          <fieldset>
            <legend>② 掲載文章を貼り付けて自動入力（任意）</legend>
            <textarea
              rows={5}
              placeholder={'SUUMOの物件ページで、物件名〜駐車場あたりまでを選択してコピーし、ここに貼り付けてください。\n例）8.5万円 管理費・共益費 5000円 敷金 8.5万円 礼金 - 間取り 2LDK 専有面積 55.2m2 …'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button className="btn primary" disabled={!paste.trim()} onClick={runParse}>
              文章から自動入力
            </button>
            {parseInfo && (
              <div className="parse-info">
                {parseInfo.found.length === 0 ? (
                  <p className="alert">項目を抽出できませんでした。③に手入力してください。</p>
                ) : (
                  <p>
                    ✅ 抽出できた項目（<span className="filled-sample">黄色</span>の欄）：{parseInfo.found.map((f) => FIELD_LABEL[f]).join('、')}
                  </p>
                )}
                {parseInfo.missing.length > 0 && <p className="muted">未抽出（空欄のまま）：{parseInfo.missing.map((f) => FIELD_LABEL[f]).join('、')}</p>}
                <p className="muted">※自動抽出の結果は必ず確認・修正してください。</p>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>③ 物件情報（確認・手入力）</legend>
            <div className="grid">
              <label className="full">
                物件名
                <input className={c('name')} value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="full">
                住所
                <input className={c('address')} value={d.address} onChange={(e) => set({ address: e.target.value })} placeholder="兵庫県伊丹市…" />
              </label>
              <label>
                家賃（万円）
                <input className={c('rent')} inputMode="decimal" value={d.rentMan} onChange={(e) => set({ rentMan: e.target.value })} placeholder="8.5" />
              </label>
              <label>
                管理費（円）
                <input className={c('managementFee')} inputMode="numeric" value={d.fee} onChange={(e) => set({ fee: e.target.value })} placeholder="5000" />
              </label>
              <label>
                敷金（万円）
                <input className={c('deposit')} inputMode="decimal" value={d.depositMan} onChange={(e) => set({ depositMan: e.target.value })} placeholder="なしは0" />
              </label>
              <label>
                礼金（万円）
                <input className={c('keyMoney')} inputMode="decimal" value={d.keyMoneyMan} onChange={(e) => set({ keyMoneyMan: e.target.value })} placeholder="なしは0" />
              </label>
              <label>
                間取り
                <input className={c('layout')} value={d.layout} onChange={(e) => set({ layout: e.target.value })} placeholder="2LDK" list="layout-list" />
                <datalist id="layout-list">
                  {['1LDK', '2K', '2DK', '2LDK', '3DK', '3LDK', '4LDK'].map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <label>
                専有面積（㎡）
                <input className={c('area')} inputMode="decimal" value={d.area} onChange={(e) => set({ area: e.target.value })} placeholder="55.2" />
              </label>
              <label>
                築年数（年・新築は0）
                <input className={c('ageYears')} inputMode="numeric" value={d.ageYears} onChange={(e) => set({ ageYears: e.target.value })} />
              </label>
              <label>
                築年月（任意）
                <input className={c('builtYearMonth')} value={d.builtYearMonth} onChange={(e) => set({ builtYearMonth: e.target.value })} placeholder="2013年3月" />
              </label>
              <label>
                駐車場
                <select className={c('parking')} value={d.parking} onChange={(e) => set({ parking: e.target.value as Parking })}>
                  <option value="unknown">不明</option>
                  <option value="yes">あり</option>
                  <option value="no">なし</option>
                </select>
              </label>
              <label>
                駐車場料金（円/月）
                <input
                  className={c('parkingFee')}
                  inputMode="numeric"
                  disabled={d.parking !== 'yes'}
                  value={d.parkingFee}
                  onChange={(e) => set({ parkingFee: e.target.value })}
                />
              </label>
              <label className="full">
                最寄り駅・バス停
                <textarea className={c('nearest')} rows={2} value={d.nearest} onChange={(e) => set({ nearest: e.target.value })} placeholder="JR福知山線/伊丹駅 歩10分" />
              </label>
              <label className="full">
                メモ
                <textarea rows={3} value={d.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="内見日、気になった点など" />
              </label>
              <label>
                情報確認日
                <input type="date" value={d.checkedDate} onChange={(e) => set({ checkedDate: e.target.value })} />
              </label>
              <label>
                検討ステータス
                <select value={d.status} onChange={(e) => set({ status: e.target.value as Status })}>
                  {(Object.keys(STATUS_LABEL) as Status[]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check full">
                <input type="checkbox" checked={d.favorite} onChange={(e) => set({ favorite: e.target.checked })} />
                お気に入り
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>④ 地図上の位置</legend>
            <div className="loc-buttons">
              <button className="btn" disabled={geoBusy} onClick={() => geocode(d.address)}>
                住所から位置を検索
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  onRequestPick(d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null, (lat, lng) => {
                    set({ lat, lng })
                    setGeoMsg('地図で指定した位置を設定しました。')
                  })
                }
              >
                📍 地図をクリックして指定
              </button>
            </div>
            {geoMsg && <p className="hint">{geoMsg}</p>}
            <p>
              {d.lat != null && d.lng != null ? (
                <>
                  緯度 {d.lat.toFixed(5)} / 経度 {d.lng.toFixed(5)}{' '}
                  <button className="btn link inline" onClick={() => set({ lat: null, lng: null })}>
                    位置をクリア
                  </button>
                </>
              ) : (
                <span className="warn">位置未設定（地図に表示されません）</span>
              )}
            </p>
            <label className="check">
              <input type="checkbox" checked={d.locationApprox} onChange={(e) => set({ locationApprox: e.target.checked })} />
              位置は概略（丁目までの住所など、正確な場所が不明）
            </label>
            <p className="hint">住所検索：国土地理院 地名検索API を使用</p>
          </fieldset>
          {error && <p className="alert">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={onCancel}>
            キャンセル
          </button>
          <button className="btn primary" onClick={submit}>
            {initial ? '変更を保存' : '登録する'}
          </button>
        </footer>
      </div>
    </div>
  )
}
