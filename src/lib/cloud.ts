import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RemoteRow, RemoteStore } from './sync'
import { sanitize } from './storage'

/**
 * Supabase 接続設定。
 * .env.local（ローカル）または Cloudflare Pages の環境変数で設定する。
 * 未設定の場合は従来どおり「この端末だけ」で動く（ログインなし）。
 *
 * 公開キー（publishable / anon key）はブラウザに埋め込む前提のキー。
 * データの保護はデータベース側の RLS（supabase/schema.sql）で行う。
 */
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined)?.trim()

export const cloudConfigured = Boolean(URL_ && KEY)

let client: SupabaseClient | null = null
export function getClient(): SupabaseClient {
  if (!cloudConfigured) throw new Error('Supabase が設定されていません')
  if (!client) {
    client = createClient(URL_!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'itami-rental-map:auth' },
    })
  }
  return client
}

const PAGE = 1000

export class SupabaseStore implements RemoteStore {
  private sb: SupabaseClient
  constructor(sb: SupabaseClient) {
    this.sb = sb
  }

  async fetchAll(): Promise<RemoteRow[]> {
    const out: RemoteRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from('properties').select('id,data,deleted').order('id').range(from, from + PAGE - 1)
      if (error) throw new Error(explain(error.message, error.code))
      for (const r of data ?? []) {
        const row = toRow(r)
        if (row) out.push(row)
      }
      if (!data || data.length < PAGE) break
    }
    return out
  }

  async upsert(rows: RemoteRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({ id: r.id, data: r.data, deleted: r.deleted }))
      const { error } = await this.sb.from('properties').upsert(chunk, { onConflict: 'id' })
      if (error) throw new Error(explain(error.message, error.code))
    }
  }

  /** 相手の変更をリアルタイムで受け取る。戻り値で購読解除 */
  subscribe(onRow: (r: RemoteRow) => void, onStatus: (connected: boolean) => void): () => void {
    const ch = this.sb
      .channel('properties-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, (payload) => {
        const row = toRow(payload.new)
        if (row) onRow(row)
      })
      .subscribe((status) => onStatus(status === 'SUBSCRIBED'))
    return () => {
      void this.sb.removeChannel(ch)
    }
  }
}

function toRow(r: unknown): RemoteRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as { id?: unknown; data?: unknown; deleted?: unknown }
  if (typeof o.id !== 'string' || !o.data) return null
  const data = sanitize({ ...(o.data as object), id: o.id })
  return data ? { id: o.id, data, deleted: Boolean(o.deleted) } : null
}

function explain(msg: string, code?: string) {
  if (code === '42501' || /row-level security|permission denied/i.test(msg))
    return 'このアカウントには共有データへのアクセス権がありません（Supabase の app_members に登録されているか確認してください）'
  if (code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg))
    return 'データベースの表がありません（supabase/schema.sql を SQL Editor で実行してください）'
  return msg
}

export function authErrorMessage(msg: string) {
  if (/Invalid login credentials/i.test(msg)) return 'メールアドレスまたはパスワードが違います。'
  if (/Email not confirmed/i.test(msg)) return 'メールアドレスが未確認です（Supabase でユーザー作成時に「Auto Confirm User」をオンにしてください）。'
  if (/fetch|network/i.test(msg)) return 'サーバーに接続できません。通信状態を確認してください。'
  return msg
}
