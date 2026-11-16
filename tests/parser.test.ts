// 実行: node tests/parser.test.ts
import { parseListingText } from '../src/lib/parser.ts'
import assert from 'node:assert/strict'

const detail = `サンハイツ伊丹 3階の賃貸マンション
8.5万円 管理費・共益費 5,000円
敷金 8.5万円 礼金 -
所在地 兵庫県伊丹市中央３ 地図を見る
駅徒歩 JR福知山線/伊丹駅 歩10分
阪急伊丹線/伊丹駅 歩8分
JR福知山線/猪名寺駅 バス10分 (バス停)稲野 歩3分
間取り 2LDK
専有面積 55.2m2
築年数 築12年
築年月 2013年3月
駐車場 敷地内有 8,000円/月
`
const r = parseListingText(detail)
assert.equal(r.values.name, 'サンハイツ伊丹')
assert.equal(r.values.rent, 85000)
assert.equal(r.values.managementFee, 5000)
assert.equal(r.values.deposit, 85000)
assert.equal(r.values.keyMoney, 0)
assert.equal(r.values.address, '兵庫県伊丹市中央3')
assert.equal(r.values.layout, '2LDK')
assert.equal(r.values.area, 55.2)
assert.equal(r.values.ageYears, 12)
assert.equal(r.values.builtYearMonth, '2013年3月')
assert.equal(r.values.parking, 'yes')
assert.equal(r.values.parkingFee, 8000)
assert.ok(r.values.nearest?.includes('JR福知山線/伊丹駅 歩10分'))
assert.ok(r.values.nearest?.includes('バス停'))

const table = `賃料：７．２万円
管理費・共益費：－
敷金/礼金 1ヶ月/1ヶ月
所在地：兵庫県尼崎市塚口本町１
間取り：３ＤＫ　専有面積：６０．５㎡
新築
駐車場：無
https://suumo.jp/chintai/jnc_000099999999/?bc=100`
const t = parseListingText(table)
assert.equal(t.values.rent, 72000)
assert.equal(t.values.managementFee, 0)
assert.equal(t.values.deposit, 72000)
assert.equal(t.values.keyMoney, 72000)
assert.equal(t.values.layout, '3DK')
assert.equal(t.values.area, 60.5)
assert.equal(t.values.ageYears, 0)
assert.equal(t.values.parking, 'no')
assert.equal(t.values.address, '兵庫県尼崎市塚口本町1')
assert.equal(t.values.suumoUrl, 'https://suumo.jp/chintai/jnc_000099999999/?bc=100')

// 何も情報がない文章 → 何も埋めない
const empty = parseListingText('素敵なお部屋です。お問い合わせください。')
assert.deepEqual(empty.found, [])
console.log('parser tests: OK')
