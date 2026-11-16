import type { Property } from './types'

/**
 * SUUMO 等の掲載文章（コピー＆ペーストしたテキスト）から物件情報を抽出する。
 * - 一般的な日本の賃貸表記（賃料 8.5万円 / 管理費 5,000円 / 2LDK / 55.2m² / 築12年 など）に対応
 * - 見つからなかった項目は返さない（推測で埋めない）
 */
export type ParsedField =
  | 'name' | 'address' | 'rent' | 'managementFee' | 'deposit' | 'keyMoney' | 'layout' | 'area'
  | 'ageYears' | 'builtYearMonth' | 'parking' | 'parkingFee' | 'nearest' | 'suumoUrl'

export const FIELD_LABEL: Record<ParsedField, string> = {
  name: '物件名', address: '住所', rent: '家賃', managementFee: '管理費', deposit: '敷金', keyMoney: '礼金',
  layout: '間取り', area: '専有面積', ageYears: '築年数', builtYearMonth: '築年月', parking: '駐車場の有無',
  parkingFee: '駐車場料金', nearest: '最寄り駅・バス停', suumoUrl: 'SUUMO URL',
}

export interface ParseResult {
  values: Partial<Property>
  found: ParsedField[]
}

const SEP = '[\\s:]*'

/** 「8.5万円」「85,000円」「-」などを円に変換。読めなければ undefined */
export function parseYen(s: string | undefined): number | undefined {
  if (s == null) return undefined
  const t = s.replace(/[,\s]/g, '')
  if (/^(-|－|ー|―|なし|無し?|0円?)$/.test(t)) return 0
  let m = t.match(/^(\d+(?:\.\d+)?)万(\d+)?円?/)
  if (m) return Math.round(Number(m[1]) * 10000 + (m[2] ? Number(m[2]) : 0))
  m = t.match(/^(\d+)円/)
  if (m) return Number(m[1])
  return undefined
}

const MONEY = '(\\d+(?:\\.\\d+)?万\\d*円|\\d[\\d,]*円|-|－|ー|―|なし|無し?)'

function firstMatch(text: string, res: RegExp[]) {
  for (const re of res) {
    const m = text.match(re)
    if (m) return m
  }
  return null
}

/** 敷金・礼金: 金額 or ヶ月表記 */
function parseDepositLike(raw: string | undefined, rent: number | undefined): number | undefined {
  if (raw == null) return undefined
  const y = parseYen(raw)
  if (y !== undefined) return y
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(?:ヶ月|か月|ヵ月|カ月|ケ月)/)
  if (m && rent != null) return Math.round(Number(m[1]) * rent) // 家賃×月数（家賃が判明している場合のみ）
  return undefined
}

export function parseListingText(input: string): ParseResult {
  const text = input.normalize('NFKC').replace(/\r/g, '').replace(/[ \t　]+/g, ' ')
  const flat = text.replace(/\n+/g, ' ')
  const v: Partial<Property> = {}
  const found: ParsedField[] = []
  const set = <K extends ParsedField>(k: K, val: Property[K] | undefined) => {
    if (val === undefined || val === '' || (typeof val === 'number' && !Number.isFinite(val))) return
    ;(v as Record<string, unknown>)[k] = val
    found.push(k)
  }

  // URL
  const url = flat.match(/https?:\/\/(?:www\.)?suumo\.jp\/[^\s"'<>]+/)
  set('suumoUrl', url?.[0])

  // 家賃
  const rentM = firstMatch(flat, [
    new RegExp(`(?:賃料|家賃)${SEP}(\\d+(?:\\.\\d+)?万\\d*円|\\d[\\d,]*円)`),
    /(\d+(?:\.\d+)?万円)\s*(?:\/\s*)?(?:管理費|共益費)/, // 「8.5万円 管理費・共益費 5000円」形式
  ])
  const rent = parseYen(rentM?.[1])
  set('rent', rent)

  // 管理費
  const feeM = flat.match(new RegExp(`(?:管理費・共益費|管理費等?|共益費)${SEP}${MONEY}`))
  set('managementFee', parseYen(feeM?.[1]))

  // 敷金・礼金
  const DEP = '(\\d+(?:\\.\\d+)?万\\d*円|\\d[\\d,]*円|\\d+(?:\\.\\d+)?\\s*(?:ヶ月|か月|ヵ月|カ月|ケ月)|-|－|ー|―|なし|無し?)'
  const pair = flat.match(new RegExp(`敷金\\s*/\\s*礼金${SEP}${DEP}\\s*/\\s*${DEP}`))
  if (pair) {
    set('deposit', parseDepositLike(pair[1], rent))
    set('keyMoney', parseDepositLike(pair[2], rent))
  } else {
    const d = flat.match(new RegExp(`敷金?${SEP}${DEP}`))
    const k = flat.match(new RegExp(`礼金?${SEP}${DEP}`))
    set('deposit', parseDepositLike(d?.[1], rent))
    set('keyMoney', parseDepositLike(k?.[1], rent))
  }

  // 間取り
  const lay = firstMatch(flat, [
    /間取り?(?!詳細)[\s:]*(\d\s*S?\s*(?:LDK|DK|SK|K|R)|ワンルーム)/i,
    /(?:^|[^\dA-Za-z])([1-9]S?(?:LDK|DK|SK|K))(?![A-Za-z])/,
    /(ワンルーム)/,
  ])
  if (lay) set('layout', lay[1].replace(/\s/g, '').toUpperCase().replace('ワンルーム', '1R'))

  // 専有面積
  const areaM = firstMatch(flat, [
    /専有面積[\s:]*(\d+(?:\.\d+)?)\s*(?:m2|m²|平米|平方メートル)/,
    /(\d+(?:\.\d+)?)\s*(?:m2|m²|平米)/,
  ])
  set('area', areaM ? Number(areaM[1]) : undefined)

  // 築年月・築年数
  const by = flat.match(/築年月[\s:]*(\d{4})年\s*(\d{1,2})月/)
  if (by) set('builtYearMonth', `${by[1]}年${Number(by[2])}月`)
  const age = flat.match(/築\s*(\d{1,3})\s*年/)
  if (age) set('ageYears', Number(age[1]))
  else if (/新築/.test(flat)) set('ageYears', 0)
  else if (by) {
    // 築年月から築年数を計算（掲載情報に基づく計算値）
    const now = new Date()
    const months = (now.getFullYear() - Number(by[1])) * 12 + (now.getMonth() + 1 - Number(by[2]))
    if (months >= 0) set('ageYears', Math.floor(months / 12))
  }

  // 住所
  const addrLine = firstMatch(text, [
    /(?:所在地|住所)[\s:]*([^\n]+)/,
    /((?:兵庫県|大阪府)[^\s\n]{2,40})/,
  ])
  if (addrLine) {
    const a = addrLine[1].replace(/(地図を見る|周辺環境|地図).*$/, '').trim().split(' ')[0]
    set('address', a)
  }

  // 駐車場
  const pk = text.match(/駐車場[\s:]*([^\n]{0,40})/)
  if (pk) {
    const s = pk[1]
    if (/(無|なし|不可|空無)/.test(s) && !/空有/.test(s)) set('parking', 'no')
    else if (/(有|あり|空有|近隣|敷地内)/.test(s)) set('parking', 'yes')
    const fee = s.match(/(\d+(?:\.\d+)?万\d*円|\d[\d,]*円)/)
    if (fee) set('parkingFee', parseYen(fee[1]))
  }

  // 最寄り駅・バス停
  const access = [
    ...flat.matchAll(/([^\s/]{1,25}\/[^\s/]{1,20}(?:駅|停)(?:\s*バス\s*\d+\s*分\s*(?:\(バス停\)\s*)?[^\s]{1,20}?)?\s*(?:歩|徒歩)\s*\d+\s*分)/g),
  ].map((m) => m[1])
  if (access.length) set('nearest', [...new Set(access)].slice(0, 4).join('\n'))

  // 物件名
  const nm = firstMatch(text, [
    /物件名[\s:]*([^\n]+)/,
    /^\s*(.+?)\s*\d*階?の賃貸(?:マンション|アパート|一戸建て|テラス・タウンハウス|その他)/m,
  ])
  if (nm) set('name', nm[1].trim())

  return { values: v, found }
}
