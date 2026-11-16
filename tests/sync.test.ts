// 同期エンジンの単体テスト。実行: node tests/sync.test.ts
// 2台の端末（A=自分のスマホ、B=パートナーのPC）と、Supabase と同じ更新ルールの偽サーバーで検証する。
import assert from 'node:assert/strict'
import { SyncEngine, type KV, type RemoteRow, type RemoteStore, type SyncState } from '../src/lib/sync.ts'
import type { Property } from '../src/lib/types.ts'

class FakeServer {
  rows = new Map<string, RemoteRow>()
  offline = false
  calls = 0
  store(): RemoteStore {
    return {
      fetchAll: async () => {
        if (this.offline) throw new Error('Failed to fetch')
        return [...this.rows.values()].map((r) => structuredClone(r))
      },
      upsert: async (rows) => {
        this.calls++
        if (this.offline) throw new Error('Failed to fetch')
        for (const r of rows) {
          const old = this.rows.get(r.id)
          // schema.sql のトリガーと同じ：古い更新は無視
          if (old && r.data.updatedAt < old.data.updatedAt) continue
          this.rows.set(r.id, structuredClone(r))
        }
      },
    }
  }
}

class MemKV implements KV {
  m = new Map<string, string>()
  get(k: string) {
    return this.m.get(k) ?? null
  }
  set(k: string, v: string) {
    this.m.set(k, v)
  }
  remove(k: string) {
    this.m.delete(k)
  }
}

let clock = Date.parse('2026-11-16T10:00:00.000Z')
const tick = () => new Date((clock += 1000)).toISOString()

function prop(id: string, name: string, extra: Partial<Property> = {}): Property {
  const t = tick()
  return {
    id, name, address: '', rent: 80000, managementFee: 5000, deposit: null, keyMoney: null, layout: '2LDK', area: 50,
    ageYears: null, builtYearMonth: '', parking: 'unknown', parkingFee: null, nearest: '', memo: '', suumoUrl: '',
    checkedDate: '2026-11-16', status: 'considering', favorite: false, lat: 34.78, lng: 135.4, locationApprox: false,
    createdAt: t, updatedAt: t, ...extra,
  }
}

class Device {
  local: Property[] = []
  kv = new MemKV()
  state!: SyncState
  engine!: SyncEngine
  answer = true
  asked = 0
  server: FakeServer
  name: string
  constructor(server: FakeServer, name: string) {
    this.server = server
    this.name = name
  }
  async login() {
    this.engine = new SyncEngine(this.server.store(), this.kv, 'user-' + this.name, {
      getLocal: () => this.local,
      setLocal: (l) => {
        this.local = l
        this.engine.localChanged(l) // 画面側の effect と同じ流れ（再送されないこと）
      },
      onState: (s) => (this.state = s),
      confirmUpload: () => {
        this.asked++
        return this.answer
      },
      now: tick,
    }, { flushDelayMs: 100000, retryDelayMs: 100000 })
    await this.engine.start()
  }
  edit(fn: (l: Property[]) => Property[]) {
    this.local = fn(this.local)
    this.engine.localChanged(this.local)
  }
  async sync() {
    await this.engine.flush()
    await this.engine.pull()
  }
  names() {
    return this.local.map((p) => p.name).sort()
  }
}

const server = new FakeServer()
const A = new Device(server, 'A')
const B = new Device(server, 'B')

// 1. 初回ログイン：A にだけ既存データがある → 確認してアップロード
A.local = [prop('p1', '伊丹ハイツ')]
await A.login()
assert.equal(A.asked, 1, '初回はアップロード確認')
assert.equal(server.rows.size, 1)
await B.login()
assert.equal(B.asked, 0, 'Bは自分だけのデータがないので確認なし')
assert.deepEqual(B.names(), ['伊丹ハイツ'], 'Bに同期される')

// 2. B で追加 → A に届く
B.edit((l) => [...l, prop('p2', '稲野マンション')])
await B.engine.flush()
await A.engine.pull()
assert.deepEqual(A.names(), ['伊丹ハイツ', '稲野マンション'])

// 3. A で編集 → B に届く（他の物件は変わらない）
A.edit((l) => l.map((p) => (p.id === 'p1' ? { ...p, memo: '内見OK', updatedAt: tick() } : p)))
await A.engine.flush()
await B.engine.pull()
assert.equal(B.local.find((p) => p.id === 'p1')!.memo, '内見OK')

// 4. リモート反映が再送ループにならない
const before = server.calls
await B.engine.flush()
assert.equal(server.calls, before, '受信しただけのデータは再送しない')
assert.equal(B.engine.pendingCount, 0)

// 5. 同時編集：後から編集した方が残る（A が古い、B が新しい）
A.edit((l) => l.map((p) => (p.id === 'p2' ? { ...p, status: 'excluded', updatedAt: tick() } : p)))
B.edit((l) => l.map((p) => (p.id === 'p2' ? { ...p, status: 'main', updatedAt: tick() } : p)))
await B.engine.flush()
await A.sync() // A の古い変更はサーバーで無視され、B の内容を受け取る
assert.equal(A.local.find((p) => p.id === 'p2')!.status, 'main', '後勝ち')
assert.equal(server.rows.get('p2')!.data.status, 'main')
assert.equal(A.engine.pendingCount, 0)

// 6. 削除が相手に伝わる
B.edit((l) => l.filter((p) => p.id !== 'p1'))
await B.engine.flush()
assert.equal(server.rows.get('p1')!.deleted, true, 'サーバーには削除の印')
await A.engine.pull()
assert.deepEqual(A.names(), ['稲野マンション'], 'A からも消える')

// 7. オフライン中の変更は貯めて、回復後に送る
server.offline = true
A.edit((l) => [...l, prop('p3', 'オフライン登録')])
await A.engine.flush()
assert.equal(A.state.phase, 'offline')
assert.equal(A.engine.pendingCount, 1, '送信待ち1件')
server.offline = false
await A.engine.flush()
assert.equal(A.engine.pendingCount, 0)
assert.equal(server.rows.get('p3')!.data.name, 'オフライン登録')

// 8. 送信待ちはページを再読み込みしても残る（KVに保存）
server.offline = true
A.edit((l) => l.map((p) => (p.id === 'p3' ? { ...p, rent: 70000, updatedAt: tick() } : p)))
await A.engine.flush()
A.engine.stop()
server.offline = false
await A.login() // 再読み込み相当
assert.equal(A.asked, 1, '2回目以降は確認しない')
assert.equal(server.rows.get('p3')!.data.rent, 70000, '再起動後に送信待ちを送る')

// 9. リアルタイム受信（1件反映）
await B.engine.pull()
const row: RemoteRow = { id: 'p4', data: prop('p4', 'リアルタイム物件'), deleted: false }
server.rows.set('p4', row)
B.engine.applyRemote(row)
await new Promise((r) => setTimeout(r, 0))
assert.ok(B.names().includes('リアルタイム物件'))

// 10. 初回アップロードを断ると、そのブラウザだけの物件は消える（共有データは汚さない）
const C = new Device(server, 'C')
C.local = [prop('pc', 'テスト用の物件')]
C.answer = false
await C.login()
assert.equal(C.asked, 1)
assert.ok(!C.names().includes('テスト用の物件'))
assert.ok(!server.rows.has('pc'))
assert.ok(C.names().includes('リアルタイム物件'), '共有データは受け取る')

// 11. 初回の取得が失敗したら、確認前にローカルを送らない
const D = new Device(server, 'D')
D.local = [prop('pd', '未確認の物件')]
server.offline = true
await D.login()
assert.ok(!D.engine.isReady)
D.engine.localChanged(D.local)
server.offline = false
assert.ok(!server.rows.has('pd'), '統合前は送らない')
D.engine.stop()

for (const d of [A, B, C]) d.engine.stop()
console.log('sync tests: OK')
