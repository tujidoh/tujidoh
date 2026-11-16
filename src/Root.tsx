import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import LoginScreen from './components/LoginScreen'
import { cloudConfigured, getClient } from './lib/cloud'

/**
 * Supabase が設定されていればログイン必須（2人で共有モード）。
 * 未設定なら従来どおり、この端末だけで動く。
 */
export default function Root() {
  if (!cloudConfigured) return <App cloud={null} />
  return <CloudRoot />
}

function CloudRoot() {
  const client = getClient()
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [client])

  if (session === undefined) return <div className="login-page muted">読み込み中…</div>
  if (!session) return <LoginScreen client={client} />
  return <App key={session.user.id} cloud={{ client, user: session.user }} />
}
