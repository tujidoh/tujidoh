import { useState } from 'react'
import type { BusLayer } from '../lib/busData'
import { OPERATOR_GROUPS } from '../lib/busData'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../lib/types'

interface Props {
  layers: BusLayer[]
  operatorVisible: Record<string, boolean>
  onOperator: (key: string, v: boolean) => void
  stopsVisible: boolean
  onStops: (v: boolean) => void
  onLayerVisible: (id: string, v: boolean) => void
}

export default function LayerControl(p: Props) {
  const [open, setOpen] = useState(() => window.innerWidth > 800)
  const routes = p.layers.find((l) => l.id === 'builtin-routes')
  const imported = p.layers.filter((l) => !l.builtin)
  return (
    <div className={'layer-ctl' + (open ? ' open' : '')}>
      <button className="btn layer-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        🗺 レイヤー{open ? ' ▲' : ''}
      </button>
      {open && (
        <div className="layer-body">
          <div className="legend">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <span key={s}>
                <i style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span>★お気に入り</span>
          </div>
          <hr />
          {routes ? (
            <>
              <label className="check">
                <input type="checkbox" checked={routes.visible} onChange={(e) => p.onLayerVisible(routes.id, e.target.checked)} />
                <b>バス路線</b>
              </label>
              <div className="indent">
                {OPERATOR_GROUPS.map((g) => (
                  <label key={g.key} className="check">
                    <input
                      type="checkbox"
                      disabled={!routes.visible}
                      checked={p.operatorVisible[g.key] !== false}
                      onChange={(e) => p.onOperator(g.key, e.target.checked)}
                    />
                    <i className="swatch" style={{ background: g.color }} />
                    {g.label}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">同梱のバス路線データを読み込めませんでした。</p>
          )}
          <label className="check">
            <input type="checkbox" checked={p.stopsVisible} onChange={(e) => p.onStops(e.target.checked)} />
            <b>バス停</b>
          </label>
          <p className="muted small indent">ズームすると表示され、さらに拡大すると停留所名が出ます。</p>
          {imported.length > 0 && (
            <>
              <hr />
              <b className="small">取り込んだデータ</b>
              {imported.map((l) => (
                <label key={l.id} className="check">
                  <input type="checkbox" checked={l.visible} onChange={(e) => p.onLayerVisible(l.id, e.target.checked)} />
                  <i className="swatch" style={{ background: l.color }} />
                  {l.name}
                </label>
              ))}
            </>
          )}
          <p className="data-note">
            ⚠ バス路線・バス停は <b>2022年度（令和4年度）</b>の国土数値情報です。現在の運行とは異なる場合があります。最新の時刻・路線は各事業者でご確認ください。鉄道路線・駅は背景地図に表示されています。
          </p>
        </div>
      )}
    </div>
  )
}
