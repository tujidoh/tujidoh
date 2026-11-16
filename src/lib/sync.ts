import type { Property } from './types'

/**
 * 2台以上の端末で物件データを同期するエンジン（画面・Supabase に依存しない純粋なロジック）。
 *
 * 方針（2人で使う前提のシンプルな方式）:
 * - ローカル優先：画面は常にブラウザ内のデータ（localStorage）で動く。オフラインでも使える。
 * - 変更は「送信待ち（outbox）」に貯めて、まとめてサーバーへ送る。失敗したら後で再送。
 * - 同じ物件を2人が編集したら、更新日時（updatedAt）が新しい方を採用（後勝ち）。
 * - 削除は「削除済み」の印（deleted）をサーバーに残し、相手の端末からも消す。
 */

export interface RemoteRow {
  id: string
  data: Property
  deleted: boolean
}

export interface RemoteStore {
  fetchAll(): Promise<RemoteRow[]>
  upsert(rows: RemoteRow[]): Promise<void>
}

export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export type SyncPhase = 'starting' | 'synced' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  phase: SyncPhase
  pending: number // 送信待ちの件数
  lastSyncedAt: string | null
  error: string | null
}

export interface SyncHooks {
  getLocal(): Property[]
  setLocal(list: Property[]): void
  onState(s: SyncState): void
  /** 初回同期時、このブラウザにだけある物件をサーバーへ追加してよいか（false ならこのブラウザから消す） */
  confirmUpload(count: number): Promise<boolean> | boolean
  now?(): string
}

export interface SyncOptions {
  flushDelayMs?: number // 変更から送信までの待ち時間（まとめ送信用）
  retryDelayMs?: number
}

const newer = (a: string | undefined, b: string | undefined) => (a ?? '') > (b ?? '')

export class SyncEngine {
  private outbox: Record<string, RemoteRow> = {}
  /** 同期済み（または送信待ちに入れた）各物件の updatedAt。ローカルの変更検出に使う */
  private base: Record<string, string> = {}
  private initialized = false
  private ready = false
  private stopped = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null
  private pulling: Promise<boolean> | null = null
  private state: SyncState = { phase: 'starting', pending: 0, lastSyncedAt: null, error: null }
  private readonly flushDelay: number
  private readonly retryDelay: number
  private readonly prefix: string

  private readonly store: RemoteStore
  private readonly kv: KV
  private readonly hooks: SyncHooks

  constructor(store: RemoteStore, kv: KV, namespace: string, hooks: SyncHooks, opts: SyncOptions = {}) {
    this.store = store
    this.kv = kv
    this.hooks = hooks
    this.prefix = `itami-rental-map:sync:${namespace}:`
    this.flushDelay = opts.flushDelayMs ?? 800
    this.retryDelay = opts.retryDelayMs ?? 15000
    try {
      this.outbox = JSON.parse(kv.get(this.prefix + 'outbox') || '{}')
      this.base = JSON.parse(kv.get(this.prefix + 'base') || '{}')
      this.initialized = kv.get(this.prefix + 'initialized') === '1'
      this.state.lastSyncedAt = kv.get(this.prefix + 'lastSyncedAt')
    } catch {
      this.outbox = {}
      this.base = {}
    }
    this.state.pending = Object.keys(this.outbox).length
  }

  get pendingCount() {
    return Object.keys(this.outbox).length
  }

  getState() {
    return this.state
  }

  /** 初回の取得・統合を行い、以後ローカル変更の検出を開始 */
  async start(): Promise<void> {
    if (this.stopped) return
    const ok = await this.pull()
    if (this.stopped) return
    if (!ok) {
      // 初回取得に失敗（オフライン等）→ 統合前にローカルを送らないよう、取得から再試行
      this.startTimer = setTimeout(() => void this.start(), this.retryDelay)
      return
    }
    this.ready = true
    this.localChanged(this.hooks.getLocal())
  }

  get isReady() {
    return this.ready
  }

  stop() {
    this.stopped = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.startTimer) clearTimeout(this.startTimer)
    this.flushTimer = null
    this.startTimer = null
  }

  /** ローカルのデータが変わったら呼ぶ（画面の保存処理の後） */
  localChanged(list: Property[]) {
    if (!this.ready || this.stopped) return
    const now = this.hooks.now?.() ?? new Date().toISOString()
    const ids = new Set<string>()
    let changed = false
    for (const p of list) {
      ids.add(p.id)
      if (this.base[p.id] !== p.updatedAt) {
        this.outbox[p.id] = { id: p.id, data: p, deleted: false }
        this.base[p.id] = p.updatedAt
        changed = true
      }
    }
    for (const id of Object.keys(this.base)) {
      if (!ids.has(id)) {
        const prev = this.outbox[id]?.data
        // 削除の印。削除時点の日時を updatedAt にして、それより古い編集で復活しないようにする
        const data = { ...(prev ?? ({ id } as Property)), updatedAt: newer(now, this.base[id]) ? now : this.base[id] }
        this.outbox[id] = { id, data, deleted: true }
        delete this.base[id]
        changed = true
      }
    }
    if (changed) {
      this.persist()
      this.scheduleFlush(this.flushDelay)
    }
  }

  /** サーバーの全データを取得してローカルと統合。成功したら true */
  pull(): Promise<boolean> {
    if (this.pulling) return this.pulling
    this.pulling = (async () => {
      this.setState({ phase: 'syncing' })
      try {
        const rows = await this.store.fetchAll()
        if (this.stopped) return false
        await this.merge(rows, true)
        this.markSynced()
        await this.flush()
        return true
      } catch (e) {
        this.fail(e, false)
        return false
      } finally {
        this.pulling = null
      }
    })()
    return this.pulling
  }

  /** リアルタイム通知などで届いた1件を反映 */
  applyRemote(row: RemoteRow) {
    if (this.stopped || !this.ready) return
    void this.merge([row], false)
  }

  /** 送信待ちをサーバーへ送る */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.flushing) return this.flushing.then(() => (this.pendingCount ? this.flush() : undefined))
    const rows = Object.values(this.outbox)
    if (rows.length === 0) {
      if (this.state.phase !== 'error' && this.state.phase !== 'offline') this.setState({ phase: 'synced' })
      return Promise.resolve()
    }
    this.flushing = (async () => {
      this.setState({ phase: 'syncing' })
      try {
        await this.store.upsert(rows)
        for (const r of rows) {
          const cur = this.outbox[r.id]
          // 送信中にさらに変更されていたら残す
          if (cur && cur.deleted === r.deleted && cur.data.updatedAt === r.data.updatedAt) delete this.outbox[r.id]
        }
        this.persist()
        this.markSynced()
      } catch (e) {
        this.fail(e, true)
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  /** ログアウト時などに、この端末の同期情報を消す */
  clearLocalState() {
    for (const k of ['outbox', 'base', 'initialized', 'lastSyncedAt']) this.kv.remove(this.prefix + k)
    this.outbox = {}
    this.base = {}
  }

  // ---------- 内部 ----------

  private async merge(rows: RemoteRow[], full: boolean) {
    const local = this.hooks.getLocal()
    const map = new Map(local.map((p) => [p.id, p]))
    let localDirty = false

    // 初回：このブラウザにだけある物件の扱いを確認
    if (full && !this.initialized) {
      const remoteIds = new Set(rows.map((r) => r.id))
      const onlyLocal = local.filter((p) => !remoteIds.has(p.id) && !this.outbox[p.id])
      if (onlyLocal.length > 0) {
        const ok = await this.hooks.confirmUpload(onlyLocal.length)
        if (!ok) {
          for (const p of onlyLocal) map.delete(p.id)
          localDirty = true
        }
      }
      this.initialized = true
      this.kv.set(this.prefix + 'initialized', '1')
    }

    for (const row of rows) {
      if (!row || !row.id || !row.data) continue
      const remoteAt = row.data.updatedAt
      const pending = this.outbox[row.id]
      if (pending) {
        if (!newer(remoteAt, pending.data.updatedAt)) continue // 自分の未送信の変更の方が新しい
        delete this.outbox[row.id] // サーバーの方が新しい → 自分の変更は破棄
      }
      const cur = map.get(row.id)
      if (row.deleted) {
        if (cur && newer(cur.updatedAt, remoteAt)) {
          // 削除より後にこちらで編集していた → 復活させて送る
          this.outbox[row.id] = { id: row.id, data: cur, deleted: false }
          this.base[row.id] = cur.updatedAt
        } else {
          if (cur) {
            map.delete(row.id)
            localDirty = true
          }
          delete this.base[row.id]
        }
        continue
      }
      if (!cur || newer(remoteAt, cur.updatedAt)) {
        map.set(row.id, { ...row.data, id: row.id })
        this.base[row.id] = remoteAt
        localDirty = true
      } else if (newer(cur.updatedAt, remoteAt)) {
        this.outbox[row.id] = { id: row.id, data: cur, deleted: false }
        this.base[row.id] = cur.updatedAt
      } else {
        this.base[row.id] = remoteAt
      }
    }

    if (full) {
      // サーバーに無いローカルの物件は送る
      const remoteIds = new Set(rows.map((r) => r.id))
      for (const p of map.values()) {
        if (!remoteIds.has(p.id) && !this.outbox[p.id]) {
          this.outbox[p.id] = { id: p.id, data: p, deleted: false }
          this.base[p.id] = p.updatedAt
        }
      }
    }

    if (localDirty) {
      // 並び順は既存の順を保ち、新しい物件は末尾へ
      const ordered = [...local.filter((p) => map.has(p.id)).map((p) => map.get(p.id)!), ...[...map.values()].filter((p) => !local.some((l) => l.id === p.id))]
      this.hooks.setLocal(ordered)
    }
    this.persist()
    if (!full && this.pendingCount) this.scheduleFlush(this.flushDelay)
  }

  private scheduleFlush(delay: number) {
    if (this.stopped) return
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delay)
  }

  private persist() {
    try {
      this.kv.set(this.prefix + 'outbox', JSON.stringify(this.outbox))
      this.kv.set(this.prefix + 'base', JSON.stringify(this.base))
    } catch {
      /* 容量不足など。次回の全件取得で回復する */
    }
    this.setState({ pending: this.pendingCount })
  }

  private markSynced() {
    const at = new Date().toISOString()
    try {
      this.kv.set(this.prefix + 'lastSyncedAt', at)
    } catch {
      /* 無視 */
    }
    this.setState({ phase: this.pendingCount ? 'syncing' : 'synced', lastSyncedAt: at, error: null })
  }

  private fail(e: unknown, retryFlush: boolean) {
    const msg = e instanceof Error ? e.message : String(e)
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    this.setState({ phase: offline || /fetch|network|Failed to fetch|Load failed/i.test(msg) ? 'offline' : 'error', error: msg })
    if (retryFlush) this.scheduleFlush(this.retryDelay)
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch, pending: patch.pending ?? this.pendingCount }
    this.hooks.onState(this.state)
  }
}
