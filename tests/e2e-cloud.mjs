// 共有モード（Supabase 同期）の E2E テスト。
// 本物の Supabase の代わりに、テスト内の偽サーバー（認証・REST・リアルタイム）へ通信を差し替えて、
// 「PC（自分）」と「スマホ（パートナー）」の2台の同期を確認する。
//
// 使い方:
//   VITE_SUPABASE_URL=https://e2e-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e \
//     npx vite build --outDir dist-e2e
//   npx vite preview --outDir dist-e2e --port 4174 &
//   node tests/e2e-cloud.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const { chromium } = createRequire(import.meta.url)('playwright')

const BASE = process.env.BASE_URL || 'http://localhost:4174/'
const SB = 'https://e2e-test.supabase.co'
const OUT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'itami-e2e-cloud')
fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if (await fn()) return true
    } catch {
      /* retry */
    }
    await sleep(150)
  }
  return false
}

// ---------------- 偽 Supabase ----------------
const USERS = {
  'you@example.com': { id: '11111111-1111-4111-8111-111111111111', password: 'pass-you-1' },
  'partner@example.com': { id: '22222222-2222-4222-8222-222222222222', password: 'pass-partner-1' },
  'stranger@example.com': { id: '33333333-3333-4333-8333-333333333333', password: 'pass-stranger-1' }, // ログインはできるがメンバーではない
}
const MEMBERS = new Set(['you@example.com', 'partner@example.com'])
const db = new Map() // id -> {id,data,deleted,updated_at}
const sockets = new Set()
const mock = { offline: false }

const userOf = (req) => {
  const m = (req.headers()['authorization'] || '').match(/Bearer tok-(.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}
const userJson = (email) => ({
  id: USERS[email].id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})
const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) })

function broadcast(row, type) {
  const record = { ...row }
  for (const ws of sockets) {
    if (!ws.joined || !MEMBERS.has(ws.email)) continue // RLS はリアルタイムにも効く
    ws.send(JSON.stringify([ws.joinRef, null, ws.topic, 'postgres_changes', {
      ids: [ws.bindId],
      data: {
        type, schema: 'public', table: 'properties', commit_timestamp: new Date().toISOString(), errors: null, record,
        columns: [{ name: 'id', type: 'text' }, { name: 'data', type: 'jsonb' }, { name: 'deleted', type: 'bool' }, { name: 'updated_at', type: 'timestamptz' }],
      },
    }]))
  }
}

async function handle(route) {
  const req = route.request()
  const url = new URL(req.url())
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (mock.offline) return route.abort('internetdisconnected')
  const p = url.pathname
  if (p === '/auth/v1/token') {
    const body = req.postDataJSON()
    const u = USERS[body.email]
    if (!u || u.password !== body.password) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    const t = 'tok-' + encodeURIComponent(body.email)
    return json(route, 200, { access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + t, user: userJson(body.email) })
  }
  if (p === '/auth/v1/user') {
    const e = userOf(req)
    return e ? json(route, 200, userJson(e)) : json(route, 401, { msg: 'invalid' })
  }
  if (p === '/auth/v1/logout') return json(route, 204)
  if (p === '/rest/v1/properties') {
    const e = userOf(req)
    if (!e) return json(route, 401, { message: 'JWT required' })
    const member = MEMBERS.has(e)
    if (req.method() === 'GET') {
      const rows = member ? [...db.values()].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, data, deleted }) => ({ id, data, deleted })) : []
      const off = Number(url.searchParams.get('offset') || 0)
      const lim = Number(url.searchParams.get('limit') || 1000)
      return json(route, 200, rows.slice(off, off + lim))
    }
    if (req.method() === 'POST') {
      if (!member) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "properties"' })
      for (const r of req.postDataJSON()) {
        const old = db.get(r.id)
        if (old && (r.data.updatedAt ?? '') < (old.data.updatedAt ?? '')) continue // schema.sql のトリガーと同じ
        const row = { id: r.id, data: r.data, deleted: !!r.deleted, updated_at: new Date().toISOString() }
        db.set(r.id, row)
        broadcast(row, old ? 'UPDATE' : 'INSERT')
      }
      return json(route, 201)
    }
  }
  return json(route, 404, { message: 'not mocked: ' + p })
}

async function setupContext(ctx) {
  await ctx.route(SB + '/**', handle)
  await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const state = { send: (m) => ws.send(m), joined: false }
    sockets.add(state)
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      if (event === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]))
      if (event === 'phx_join') {
        const tok = payload.access_token || ''
        state.email = decodeURIComponent((tok.match(/^tok-(.+)$/) || [])[1] || '')
        state.joined = true
        state.joinRef = joinRef
        state.topic = topic
        state.bindId = 42
        const pc = (payload.config?.postgres_changes || []).map((f) => ({ ...f, id: 42 }))
        return ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pc } }]))
      }
      if (event === 'access_token') {
        state.email = decodeURIComponent(((payload.access_token || '').match(/^tok-(.+)$/) || [])[1] || '')
        return
      }
      if (event === 'phx_leave') {
        state.joined = false
        return ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
    ws.onClose(() => sockets.delete(state))
  })
}

// ---------------- テスト ----------------
const browser = await chromium.launch()
const errors = []
const pcCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await setupContext(pcCtx)
const pc = await pcCtx.newPage()
pc.on('pageerror', (e) => errors.push('pc: ' + e.message))
const dialogs = []
pc.on('dialog', (d) => {
  dialogs.push(d.message())
  d.accept()
})

// 既存のローカルデータ（共有化前に使っていた想定）を仕込む
await pc.goto(BASE)
await pc.evaluate(() => {
  const now = new Date().toISOString()
  localStorage.setItem('itami-rental-map:properties:v1', JSON.stringify([{ id: 'old-1', name: '以前登録した物件', rent: 75000, layout: '2DK', lat: 34.78, lng: 135.41, status: 'considering', createdAt: now, updatedAt: now }]))
})
await pc.reload()
check('共有モード：ログイン画面が表示される', await pc.getByRole('button', { name: 'ログイン' }).isVisible())
await pc.screenshot({ path: path.join(OUT, 'c01_login.png') })

await pc.getByLabel('メールアドレス').fill('you@example.com')
await pc.getByLabel('パスワード').fill('wrong')
await pc.getByRole('button', { name: 'ログイン' }).click()
check('パスワード違いはエラー表示', await waitFor(() => pc.locator('.alert', { hasText: 'メールアドレスまたはパスワードが違います' }).isVisible()))

await pc.getByLabel('パスワード').fill('pass-you-1')
await pc.getByRole('button', { name: 'ログイン' }).click()
await pc.waitForSelector('.leaflet-container')
check('ログインすると地図アプリが表示', await pc.locator('h1', { hasText: '伊丹 賃貸比較マップ' }).isVisible())
check('既存ローカルデータのアップロード確認が出る', await waitFor(() => dialogs.some((m) => m.includes('共有データにまだ無い物件が1件'))))
check('既存データがサーバーに保存される', await waitFor(() => db.get('old-1')?.data.name === '以前登録した物件'))
check('同期状態バッジ「同期済み」', await waitFor(() => pc.locator('.sync-badge.synced').isVisible()))

// PC で新規登録
await pc.getByRole('button', { name: '物件を追加', exact: true }).click()
await pc.locator('.grid label', { hasText: '物件名' }).locator('input').fill('共有テスト荘')
await pc.locator('.grid label', { hasText: '家賃（万円）' }).locator('input').fill('8.8')
await pc.getByRole('button', { name: /地図をクリックして指定/ }).click()
await pc.mouse.click(800, 450)
await pc.getByRole('button', { name: '登録する' }).click()
check('PCで登録した物件がサーバーへ送信', await waitFor(() => [...db.values()].some((r) => r.data.name === '共有テスト荘')))
const sharedId = [...db.values()].find((r) => r.data.name === '共有テスト荘')?.id

// スマホ（パートナー）
const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await setupContext(phCtx)
const ph = await phCtx.newPage()
ph.on('pageerror', (e) => errors.push('phone: ' + e.message))
const phDialogs = []
ph.on('dialog', (d) => {
  phDialogs.push(d.message())
  d.accept()
})
await ph.goto(BASE)
await ph.getByLabel('メールアドレス').fill('partner@example.com')
await ph.getByLabel('パスワード').fill('pass-partner-1')
await ph.getByRole('button', { name: 'ログイン' }).tap()
check('スマホ：パートナーに2件同期される', await waitFor(() => ph.locator('.plist li').count().then((n) => n === 2)))
check('スマホ：初回確認は出ない（ローカルデータなし）', phDialogs.length === 0)
check('スマホ：地図にピン表示', await waitFor(() => ph.locator('.leaflet-marker-icon.prop-pin').count().then((n) => n === 2)))
await ph.screenshot({ path: path.join(OUT, 'c02_phone_synced.png') })

// リアルタイム：スマホで本命・お気に入り → PC に即反映
await ph.locator('.plist .pname', { hasText: '共有テスト荘' }).tap()
await ph.locator('.detail .seg button', { hasText: '本命' }).tap()
await ph.locator('.detail .fav.big').tap()
check('スマホの変更がサーバーへ', await waitFor(() => db.get(sharedId)?.data.status === 'main' && db.get(sharedId)?.data.favorite === true))
check('リアルタイム接続（2台とも購読中）', [...sockets].filter((x) => x.joined).length >= 2)
check('PCにリアルタイム反映（再読み込みなし）', await waitFor(() => pc.locator('.plist li', { hasText: '共有テスト荘' }).locator('.fav.on').isVisible()))
await pc.screenshot({ path: path.join(OUT, 'c03_pc_realtime.png') })

// PC で削除 → スマホから消える
await pc.locator('.plist .pname', { hasText: '以前登録した物件' }).click()
await pc.getByRole('button', { name: '🗑 削除' }).click()
check('削除はサーバーに削除印として保存', await waitFor(() => db.get('old-1')?.deleted === true))
check('スマホからも削除される', await waitFor(() => ph.locator('.plist li').count().then((n) => n === 1)))

// オフライン → 回復
mock.offline = true
await ph.locator('.plist .pname', { hasText: '共有テスト荘' }).tap()
await ph.getByRole('button', { name: '✎ 編集' }).tap()
await ph.locator('.grid label', { hasText: 'メモ' }).locator('textarea').fill('オフライン中に書いたメモ')
await ph.getByRole('button', { name: '変更を保存' }).tap()
check('オフライン時は未送信として表示', await waitFor(() => ph.locator('.sync-badge.offline, .sync-badge.error').isVisible()))
check('オフライン中も画面では変更済み', (await ph.locator('.detail').innerText()).includes('オフライン中に書いたメモ'))
mock.offline = false
await ph.evaluate(() => window.dispatchEvent(new Event('online')))
check('回線回復で自動送信', await waitFor(() => db.get(sharedId)?.data.memo === 'オフライン中に書いたメモ', 8000))
check('PCにも反映', await waitFor(() => pc.locator('.detail, .plist').first().isVisible().then(async () => {
  await pc.locator('.plist .pname', { hasText: '共有テスト荘' }).click()
  return (await pc.locator('.detail').innerText()).includes('オフライン中に書いたメモ')
})))

// 再読み込み後もログイン状態とデータを保持
await pc.reload()
check('再読み込み後もログイン維持', await waitFor(() => pc.locator('.plist li').count().then((n) => n === 1)))

// スマホ幅の表示崩れなし
const sw = await ph.evaluate(() => document.documentElement.scrollWidth)
check('スマホ：横スクロールなし（同期バッジ表示時）', sw <= 390, `scrollWidth=${sw}`)

// メンバー以外はデータを見られない
const stCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
await setupContext(stCtx)
const st = await stCtx.newPage()
st.on('dialog', (d) => d.accept())
await st.goto(BASE)
await st.getByLabel('メールアドレス').fill('stranger@example.com')
await st.getByLabel('パスワード').fill('pass-stranger-1')
await st.getByRole('button', { name: 'ログイン' }).click()
await st.waitForSelector('.leaflet-container')
await sleep(1000)
check('メンバー以外：共有データは見えない', (await st.locator('.plist li').count()) === 0)
await st.getByRole('button', { name: '物件を追加', exact: true }).click()
await st.locator('.grid label', { hasText: '物件名' }).locator('input').fill('部外者の物件')
await st.getByRole('button', { name: /地図をクリックして指定/ }).click()
await st.mouse.click(700, 400)
await st.getByRole('button', { name: '登録する' }).click()
check('メンバー以外：書き込みは拒否されエラー表示', await waitFor(() => st.locator('.sync-badge.error').isVisible(), 8000))
check('メンバー以外：サーバーは汚れない', ![...db.values()].some((r) => r.data.name === '部外者の物件'))
await st.getByRole('button', { name: 'データ管理' }).click()
check('エラー理由（メンバー未登録）を表示', await st.locator('.alert', { hasText: 'app_members' }).isVisible())
await st.screenshot({ path: path.join(OUT, 'c04_stranger.png') })

// ログアウト
await pc.getByRole('button', { name: 'データ管理' }).click()
check('データ管理に共有状態を表示', await pc.locator('fieldset', { hasText: '共有（2人で同期）' }).isVisible())
await pc.screenshot({ path: path.join(OUT, 'c05_account.png') })
await pc.getByRole('button', { name: 'ログアウト' }).click()
check('ログアウトでログイン画面へ', await waitFor(() => pc.getByRole('button', { name: 'ログイン' }).isVisible()))
check('ログアウトでこのブラウザの物件データを消去', (await pc.evaluate(() => localStorage.getItem('itami-rental-map:properties:v1'))) === null)

check('JavaScriptエラーなし', errors.length === 0, errors.join(' | '))
await browser.close()
const ng = results.filter((r) => !r.ok)
console.log(`\n${results.length - ng.length}/${results.length} 件OK  スクリーンショット: ${OUT}`)
process.exit(ng.length ? 1 : 0)
