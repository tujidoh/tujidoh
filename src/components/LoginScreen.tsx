import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authErrorMessage } from '../lib/cloud'

export default function LoginScreen({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setError(authErrorMessage(error.message))
    } catch (err) {
      setError(authErrorMessage(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>
          <span className="logo">🏠</span> 伊丹 賃貸比較マップ
        </h1>
        <p className="muted">2人で物件データを共有するため、ログインしてください。</p>
        <label>
          メールアドレス
          <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          パスワード
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
        <p className="hint">アカウントは管理者（Supabase）が作成した2人分だけです。新規登録はできません。</p>
      </form>
    </div>
  )
}
