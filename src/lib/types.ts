/** 検討ステータス */
export type Status = 'main' | 'considering' | 'excluded'

export const STATUS_LABEL: Record<Status, string> = {
  main: '本命',
  considering: '検討中',
  excluded: '除外',
}

export const STATUS_COLOR: Record<Status, string> = {
  main: '#e53935',
  considering: '#1e6fd9',
  excluded: '#8a8f98',
}

export type Parking = 'yes' | 'no' | 'unknown'

/**
 * 物件データ。将来 Google Drive 等へ同期しやすいよう、フラットでシンプルな構造にしています。
 * 金額はすべて「円」。不明な値は null（推測で埋めない）。
 */
export interface Property {
  id: string
  name: string
  address: string
  rent: number | null // 家賃（円）
  managementFee: number | null // 管理費・共益費（円）
  deposit: number | null // 敷金（円）
  keyMoney: number | null // 礼金（円）
  layout: string // 間取り（例: 2LDK）
  area: number | null // 専有面積（㎡）
  ageYears: number | null // 築年数（情報確認時点、新築=0）
  builtYearMonth: string // 築年月（例: 2013年3月）任意
  parking: Parking
  parkingFee: number | null // 駐車場料金（円/月）
  nearest: string // 最寄り駅・バス停（掲載文のまま）
  memo: string
  suumoUrl: string
  checkedDate: string // 情報確認日 YYYY-MM-DD
  status: Status
  favorite: boolean
  lat: number | null
  lng: number | null
  locationApprox: boolean // 位置は概略
  createdAt: string // ISO 日時
  updatedAt: string
}

export interface BackupFile {
  app: 'itami-rental-map'
  version: 1
  exportedAt: string
  properties: Property[]
}

export interface Filters {
  maxRent: number | null // 円
  rentIncludesFee: boolean
  layouts: string[]
  minArea: number | null
  parkingRequired: boolean
  maxAge: number | null
  statuses: Status[]
  favoriteOnly: boolean
}

export type SortKey = 'rentAsc' | 'rentDesc' | 'areaDesc' | 'areaAsc' | 'createdDesc' | 'createdAsc'

export const LAYOUT_OPTIONS = ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '3LDK', '4LDK以上', 'その他']
