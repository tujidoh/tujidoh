import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Property } from './lib/types'
import { SyncEngine, type SyncState } from './lib/sync'
import { SupabaseStore } from './lib/cloud'

export interface Cloud {
  client: SupabaseClient
  user: User
}

const kv = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => localStorage.setItem(k, v),
  remove: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* 無視 */
    }
  },
}

/** ログイン中は物件データを Supabase と同期する */
export function useCloudSync(cloud: Cloud | null, properties: Property[], setProperties: (l: Property[]) => void) {
  const [state, setState] = useState<SyncState | null>(null)
  const [realtime, setRealtime] = useState(false)
  const engineRef = useRef<SyncEngine | null>(null)
  const propsRef = useRef(properties)
  propsRef.current = properties
  const setRef = useRef(setProperties)
  setRef.current = setProperties

  const userId = cloud?.user.id
  useEffect(() => {
    if (!cloud) return
    const store = new SupabaseStore(cloud.client)
    const engine = new SyncEngine(store, kv, cloud.user.id, {
      getLocal: () => propsRef.current,
      setLocal: (l) => {
        propsRef.current = l
        setRef.current(l)
      },
      onState: setState,
      confirmUpload: (n) =>
        confirm(
          `このブラウザには、共有データにまだ無い物件が${n}件あります。\n\n` +
            `［OK］共有データに追加する（パートナーにも表示されます）\n［キャンセル］追加しない（このブラウザから削除します）`,
        ),
    })
    engineRef.current = engine
    void engine.start()

    const unsub = store.subscribe(
      (row) => engine.applyRemote(row),
      (ok) => {
        setRealtime(ok)
        if (ok && engine.isReady) void engine.pull() // 再接続時に取りこぼしを回収
      },
    )
    const refresh = () => {
      if (document.visibilityState === 'visible' && engine.isReady) void engine.pull()
    }
    const online = () => {
      if (engine.isReady) void engine.pull()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', online)
    const iv = setInterval(refresh, 2 * 60 * 1000) // 念のため2分ごとにも確認
    return () => {
      engine.stop()
      unsub()
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', online)
      clearInterval(iv)
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    engineRef.current?.localChanged(properties)
  }, [properties])

  return {
    state,
    realtime,
    syncNow: () => engineRef.current?.flush().then(() => engineRef.current?.pull()),
    pendingCount: () => engineRef.current?.pendingCount ?? 0,
    clear: () => engineRef.current?.clearLocalState(),
  }
}
