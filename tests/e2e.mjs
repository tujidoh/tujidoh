// E2E 動作確認スクリプト（Playwright）
// 使い方: npm run build && npx vite preview --port 4173 & node tests/e2e.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // 事前に npm i -D playwright か、グローバルの playwright を NODE_PATH で指定
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE = process.env.BASE_URL || 'http://localhost:4173/'
const OUT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'itami-e2e')
fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.waitForSelector('.leaflet-container')
check('アプリが起動する', await page.locator('h1', { hasText: '伊丹 賃貸比較マップ' }).isVisible())
await page.waitForTimeout(2500)
const tiles = await page.locator('.leaflet-tile-loaded').count()
check('地図タイルが表示される', tiles > 0, `${tiles}枚`)
check('バス路線データを読み込む', await page.locator('.layer-body', { hasText: 'バス路線' }).isVisible())
await page.screenshot({ path: path.join(OUT, '01_initial.png') })

// 物件追加（掲載文貼り付け）
await page.getByRole('button', { name: /物件を追加/ }).first().click()
await page.getByPlaceholder('https://suumo.jp/chintai/jnc_...').fill('https://suumo.jp/chintai/jnc_000011112222/?bc=100000')
await page.locator('textarea').first().fill(`テストハイツ伊丹 2階の賃貸アパート
8.2万円 管理費・共益費 4,000円
敷金 8.2万円 礼金 8.2万円
所在地 兵庫県伊丹市中央3 地図を見る
駅徒歩 JR福知山線/伊丹駅 歩10分
間取り 2LDK 専有面積 52.5m2 築年数 築15年
駐車場 敷地内有 7,000円/月`)
await page.getByRole('button', { name: '文章から自動入力' }).click()
await page.waitForTimeout(2500) // 住所検索
const nameVal = await page.locator('.grid label', { hasText: '物件名' }).locator('input').inputValue()
const rentVal = await page.locator('.grid label', { hasText: '家賃（万円）' }).locator('input').inputValue()
check('掲載文から自動抽出（物件名・家賃）', nameVal === 'テストハイツ伊丹' && rentVal === '8.2', `${nameVal} / ${rentVal}`)
const geoText = await page.locator('fieldset', { hasText: '④' }).innerText()
const geocoded = /緯度/.test(geoText)
check('住所から位置を自動検索', geocoded, geoText.split('\n').slice(1, 3).join(' '))
if (!geocoded) {
  // 住所検索が使えない環境では地図クリックで位置指定
  await page.getByRole('button', { name: /地図をクリックして指定/ }).click()
  await page.mouse.click(900, 450)
}
await page.screenshot({ path: path.join(OUT, '02_form.png') })
await page.getByRole('button', { name: '登録する' }).click()
await page.waitForTimeout(1000)
check('物件を新規登録できる（一覧に表示）', await page.locator('.plist .pname', { hasText: 'テストハイツ伊丹' }).isVisible())
check('登録物件のピンが地図に表示', (await page.locator('.leaflet-marker-icon.prop-pin').count()) === 1)

// 地図クリックで位置指定する2件目
await page.getByRole('button', { name: /物件を追加/ }).first().click()
await page.locator('.grid label', { hasText: '物件名' }).locator('input').fill('地図指定マンション')
await page.locator('.grid label', { hasText: '家賃（万円）' }).locator('input').fill('9.5')
await page.locator('.grid label', { hasText: '間取り' }).first().locator('input').fill('3LDK')
await page.locator('.grid label', { hasText: '専有面積' }).locator('input').fill('65')
await page.getByRole('button', { name: /地図をクリックして指定/ }).click()
check('位置指定モードでフォームが隠れる', await page.locator('.pick-banner').isVisible())
await page.mouse.click(700, 300)
await page.waitForTimeout(300)
const g2 = await page.locator('fieldset', { hasText: '④' }).innerText()
check('地図クリックで位置を設定', /緯度/.test(g2))
await page.locator('.grid label', { hasText: '検討ステータス' }).locator('select').selectOption('main')
await page.getByRole('button', { name: '登録する' }).click()
await page.waitForTimeout(800)
check('2件目のピン', (await page.locator('.leaflet-marker-icon.prop-pin').count()) === 2)

// 重複URL警告
await page.getByRole('button', { name: /物件を追加/ }).first().click()
await page.getByPlaceholder('https://suumo.jp/chintai/jnc_...').fill('https://suumo.jp/chintai/jnc_000011112222/')
check('同じSUUMO URLで重複警告', await page.locator('.alert', { hasText: '既に「テストハイツ伊丹」' }).isVisible())
await page.getByRole('button', { name: 'キャンセル' }).click()

// ピンクリック → 詳細
await page.locator('.plist .pname', { hasText: 'テストハイツ伊丹' }).click() // まず地図をそこへ移動
await page.waitForTimeout(900)
await page.locator('.detail h2').waitFor()
await page.mouse.click(700, 700) // 何もない所
await page.locator('.leaflet-marker-icon[title^="地図指定マンション"]').click()
await page.waitForTimeout(400)
check('ピンをクリックすると詳細が表示', (await page.locator('.detail h2').innerText()) === '地図指定マンション')
await page.locator('.leaflet-marker-icon[title^="テストハイツ伊丹"]').click()
await page.waitForTimeout(400)
const detail = await page.locator('.detail').innerText()
check('合計金額（家賃+管理費+駐車場）', detail.includes('8.6万円') && detail.includes('9.3万円'))
check('近くのバス停（直線距離）を表示', /約\d+m/.test(detail) && detail.includes('直線距離'))
const href = await page.locator('.detail a', { hasText: 'SUUMOで開く' }).getAttribute('href')
const target = await page.locator('.detail a', { hasText: 'SUUMOで開く' }).getAttribute('target')
check('SUUMOリンクを開ける（別タブ）', href === 'https://suumo.jp/chintai/jnc_000011112222/?bc=100000' && target === '_blank')
await page.screenshot({ path: path.join(OUT, '03_detail.png') })

// 編集
await page.getByRole('button', { name: '✎ 編集' }).click()
await page.locator('.grid label', { hasText: 'メモ' }).locator('textarea').fill('日当たり良好。内見予定。')
await page.getByRole('button', { name: '変更を保存' }).click()
await page.waitForTimeout(400)
check('物件情報を編集できる', (await page.locator('.detail').innerText()).includes('日当たり良好'))

// お気に入り・ステータス
await page.locator('.detail .seg button', { hasText: '本命' }).click()
await page.locator('.detail .fav.big').click()
check('ステータス変更・お気に入り', (await page.locator('.plist li.sel .fav.on').count()) === 1)

// 絞り込み
await page.getByRole('button', { name: /A. 絞り込み/ }).click()
await page.locator('.filters .chip', { hasText: '3LDK' }).click()
check('間取りで絞り込み', (await page.locator('.plist li').count()) === 1)
await page.getByRole('button', { name: '条件をリセット' }).click()
await page.locator('.filters input[placeholder="例 9"]').fill('9')
check('家賃上限で絞り込み', (await page.locator('.plist li').count()) === 1)
await page.getByRole('button', { name: '条件をリセット' }).click()
await page.locator('.section-head select').selectOption('areaDesc')
check('広い順で並べ替え', (await page.locator('.plist .pname').first().innerText()).includes('地図指定'))

// 比較表
await page.getByRole('button', { name: '比較表' }).click()
check('比較表を表示', (await page.locator('table.compare thead th').count()) === 3)
await page.screenshot({ path: path.join(OUT, '04_compare.png') })
await page.getByRole('button', { name: '閉じる' }).click()

// 再読み込み後も残る
await page.reload()
await page.waitForSelector('.plist')
check('画面更新後もデータが残る', (await page.locator('.plist li').count()) === 2)

// JSONバックアップ
await page.getByRole('button', { name: 'データ管理' }).click()
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /JSONでエクスポート/ }).click()])
const backupPath = path.join(OUT, 'backup.json')
await dl.saveAs(backupPath)
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
check('JSONエクスポート', backup.properties.length === 2)
await page.getByRole('button', { name: '閉じる' }).click()

// 削除
await page.locator('.plist .pname', { hasText: 'テストハイツ伊丹' }).click()
await page.getByRole('button', { name: '🗑 削除' }).click()
await page.waitForTimeout(300)
check('物件を削除できる', (await page.locator('.plist li').count()) === 1)

// 復元
await page.getByRole('button', { name: 'データ管理' }).click()
await page.locator('input[type=file][accept^=".json"]').setInputFiles(backupPath)
await page.waitForTimeout(400)
check('JSONから復元できる', (await page.locator('.ok').innerText()).includes('追加 1件'))

// GeoJSON 取り込み
const gj = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { route_name: 'テスト取り込み線' }, geometry: { type: 'LineString', coordinates: [[135.39, 34.77], [135.41, 34.79], [135.43, 34.78]] } },
    { type: 'Feature', properties: { stop_name: 'テスト停留所' }, geometry: { type: 'Point', coordinates: [135.41, 34.79] } },
  ],
}
const gjPath = path.join(OUT, 'test_route.geojson')
fs.writeFileSync(gjPath, JSON.stringify(gj))
await page.locator('input[type=file][accept^=".geojson"]').setInputFiles(gjPath)
await page.waitForTimeout(400)
check('バス路線GeoJSONを読み込める', (await page.locator('.ok').innerText()).includes('test_route.geojson（2件）'))
const bad = path.join(OUT, 'bad.geojson')
fs.writeFileSync(bad, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [34.79, 135.41] } }] }))
await page.locator('input[type=file][accept^=".geojson"]').setInputFiles(bad)
await page.waitForTimeout(300)
check('不正な座標のGeoJSONはエラー表示', (await page.locator('.alert').innerText()).includes('日本付近'))
await page.getByRole('button', { name: '閉じる' }).click()
await page.reload()
await page.waitForTimeout(1500)
check('取り込んだGeoJSONが更新後も残る', await page.locator('.layer-body', { hasText: 'test_route' }).isVisible())

// バス停表示（ズームイン）
await page.locator('.plist .pname', { hasText: 'テストハイツ伊丹' }).click()
await page.waitForTimeout(1200)
for (let i = 0; i < 2; i++) {
  await page.locator('.leaflet-control-zoom-in').click()
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1200)
check('バス停名ラベル表示（拡大時）', (await page.locator('.stop-label').count()) > 0)
await page.screenshot({ path: path.join(OUT, '05_zoom_stops.png') })
// 路線の非表示
await page.locator('.layer-body label', { hasText: '阪急バス' }).locator('input').uncheck()
await page.locator('.layer-body label', { hasText: 'バス停' }).first().locator('input').uncheck()
await page.waitForTimeout(500)
check('バス停の非表示', (await page.locator('.stop-label').count()) === 0)
await page.screenshot({ path: path.join(OUT, '06_toggle.png') })

// スマホ幅
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const mp = await m.newPage()
mp.on('pageerror', (e) => errors.push('mobile: ' + e.message))
mp.on('dialog', (d) => d.accept())
await mp.goto(BASE)
await mp.waitForTimeout(2000)
await mp.screenshot({ path: path.join(OUT, '07_mobile_panel.png') })
await mp.locator('.panel-handle').tap()
await mp.waitForTimeout(500)
const ph = await mp.locator('.panel').boundingBox()
check('スマホ：パネルを閉じて地図を広く表示', ph.height < 80, `panel h=${ph.height}`)
await mp.screenshot({ path: path.join(OUT, '08_mobile_map.png') })
await mp.getByRole('button', { name: '物件を追加', exact: true }).tap()
await mp.locator('.grid label', { hasText: '物件名' }).locator('input').fill('スマホ登録物件')
await mp.getByRole('button', { name: /地図をクリックして指定/ }).tap()
await mp.waitForTimeout(300)
await mp.mouse.click(200, 400)
await mp.waitForTimeout(300)
await mp.screenshot({ path: path.join(OUT, '09_mobile_form.png') })
await mp.getByRole('button', { name: '登録する' }).tap()
await mp.waitForTimeout(800)
check('スマホ：物件登録とピン表示', (await mp.locator('.leaflet-marker-icon.prop-pin').count()) === 1)
const mm = await mp.locator('.leaflet-marker-icon.prop-pin').first()
await mp.locator('.panel-handle').tap()
await mp.waitForTimeout(400)
await mm.tap()
await mp.waitForTimeout(800)
check('スマホ：ピンをタップして詳細', (await mp.locator('.detail h2').innerText()) === 'スマホ登録物件')
await mp.screenshot({ path: path.join(OUT, '10_mobile_detail.png') })
const sw = await mp.evaluate(() => document.documentElement.scrollWidth)
check('スマホ：横スクロールが発生しない', sw <= 390, `scrollWidth=${sw}`)

check('JavaScriptエラーなし', errors.length === 0, errors.join(' | '))
await browser.close()
const ng = results.filter((r) => !r.ok)
console.log(`\n${results.length - ng.length}/${results.length} 件OK  スクリーンショット: ${OUT}`)
process.exit(ng.length ? 1 : 0)
