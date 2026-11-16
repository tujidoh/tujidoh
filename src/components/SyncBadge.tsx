import type { SyncState } from '../lib/sync'

export function syncLabel(s: SyncState | null) {
  if (!s || s.phase === 'starting') return '接続中…'
  switch (s.phase) {
    case 'synced':
      return '同期済み'
    case 'syncing':
      return s.pending ? `同期中（${s.pending}件）` : '同期中…'
    case 'offline':
      return s.pending ? `オフライン（未送信${s.pending}件）` : 'オフライン'
    case 'error':
      return s.pending ? `同期エラー（未送信${s.pending}件）` : '同期エラー'
  }
}

export default function SyncBadge({ state, realtime, onClick }: { state: SyncState | null; realtime: boolean; onClick: () => void }) {
  const phase = state?.phase ?? 'starting'
  const icon = phase === 'synced' ? '✓' : phase === 'error' ? '!' : phase === 'offline' ? '⚠' : '⟳'
  return (
    <button
      className={`sync-badge ${phase}`}
      onClick={onClick}
      title={`${syncLabel(state)}${realtime ? '（リアルタイム接続中）' : ''}${state?.error ? '\n' + state.error : ''}`}
      aria-label={`同期状態: ${syncLabel(state)}`}
    >
      <span className="sync-icon">{icon}</span>
      <span className="hide-sm">{syncLabel(state)}</span>
    </button>
  )
}
