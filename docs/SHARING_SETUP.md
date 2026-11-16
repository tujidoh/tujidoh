# 2人で共有するための設定ガイド（Supabase ＋ Cloudflare Pages）

このガイドの通りに設定すると、次のようになります。

- `https://（好きな名前）.pages.dev` という自分たち専用のアドレスで、スマホ・PCのどこからでも開ける
- あなたとパートナーの **2人だけ** がログインでき、物件データが全端末で自動的に同期される
- 費用は **0円**（Supabase 無料プラン ＋ Cloudflare Pages 無料プラン）

所要時間の目安：30〜40分。順番どおりに進めてください。

> 画面の文言やボタンの位置は、各サービスの更新で多少変わることがあります。見つからない場合は似た名前のメニューを探してください。

---

## STEP 1. Supabase でデータベースを作る（約10分）

### 1-1. アカウント作成とプロジェクト作成

1. <https://supabase.com> を開き、右上の **「Start your project」** → **「Continue with GitHub」** でログインします（GitHub アカウントをそのまま使えます）。
2. 組織（Organization）の作成画面が出たら、名前は何でもOK（例：`tujidoh`）、Plan は **Free** を選びます。
3. **「New project」** を押し、次のように入力します。
   - **Project name**：`itami-rental-map`（何でもOK）
   - **Database Password**：「Generate a password」で自動生成し、**どこかに控えておく**（普段は使いませんが、紛失すると再設定が必要）
   - **Region**：**Northeast Asia (Tokyo)**
4. **「Create new project」** を押し、1〜2分待ちます（準備中の表示が消えればOK）。

### 1-2. 表（テーブル）と権限を作る

1. このリポジトリの [`supabase/schema.sql`](../supabase/schema.sql) を開き、中身をすべてコピーします。
   GitHub で開いた場合は、右上の「Copy raw file」ボタン（四角が2つ重なったアイコン）で全文コピーできます。
2. Supabase の左メニュー **「SQL Editor」** を開き、空のエディタ（なければ「+ New query」）に貼り付けます。
3. **★重要★** 貼り付けた文の中の次の2行を、**あなたとパートナーのメールアドレス（小文字）** に書き換えます。
   ```sql
     ('you@example.com'),
     ('partner@example.com')
   ```
4. 右下の **「Run」**（または Ctrl+Enter）を押します。
   - 「destructive operation」などの確認が出たら、そのまま実行して問題ありません（このSQLは何度実行しても安全です）。
   - 結果欄に「登録済みメンバー」として2つのメールアドレスが表示されれば成功です。

### 1-3. 勝手に新規登録されないようにする

1. 左メニュー **「Authentication」** → **「Sign In / Providers」**（古い画面では「Providers」）を開きます。
2. **「Allow new users to sign up」**（新規ユーザーの登録を許可）を **オフ** にして **「Save changes」**。
3. 同じ画面の **Email** プロバイダーが **有効（Enabled）** になっていることを確認します（初期状態で有効です）。

> もしこの設定を忘れても、`schema.sql` の権限設定により、メンバー表に無い人は物件データを一切読み書きできません（二重の守り）。

### 1-4. 2人分のログインアカウントを作る

1. 左メニュー **「Authentication」** → **「Users」** を開きます。
2. 右上の **「Add user」** → **「Create new user」** を選びます。
3. 次のように入力して **「Create user」**。
   - **Email**：1-2 で登録した **あなた** のメールアドレス
   - **Password**：ログインに使うパスワード（8文字以上推奨。スマホのパスワード管理に保存すると楽です）
   - **Auto Confirm User?**：**オン（チェックを入れる）** ← 確認メールなしですぐ使えるようにするため
4. 同じ手順で **パートナー** のアカウントも作ります。パスワードはパートナーに直接伝えてください。

### 1-5. 接続情報（URL と公開キー）を控える

1. プロジェクト画面上部の **「Connect」** ボタンを押すか、左下の歯車 **「Project Settings」** → **「API Keys」** を開きます。
2. 次の2つをメモ帳にコピーしておきます。
   - **Project URL**：`https://xxxxxxxx.supabase.co` の形（「Project Settings」→「Data API」にもあります）
   - **Publishable key**：`sb_publishable_...` で始まるキー
     （画面に「Legacy API keys」タブしかない場合は **`anon` `public`** と書かれたキーを使います）

> ⚠ **`secret` キー／`service_role` キーは絶対に使わないでください**（全データを操作できる管理者用キーです）。
> Publishable key（anon key）はブラウザに埋め込んで使う前提の公開用キーで、データは 1-2 の権限設定（RLS）で守られています。

---

## STEP 2.（任意）自分のPCで共有モードを試す

1. プロジェクトのフォルダにある `.env.example` をコピーして、名前を **`.env.local`** に変えます。
   （Windows のエクスプローラーで拡張子を表示していない場合は、メモ帳で新規作成して「ファイルの種類：すべてのファイル」で `.env.local` という名前で保存してください）
2. `.env.local` をメモ帳で開き、STEP 1-5 で控えた値に書き換えて保存します。
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
   ```
3. `npm run dev` で起動し直して `http://localhost:5173/` を開くと、ログイン画面が出ます。
4. 1-4 で作ったアカウントでログインします。
   - このブラウザに以前登録した物件があると「共有データに追加しますか？」と聞かれます。**OK** で共有データに入ります。

> `.env.local` は GitHub には上がりません（`.gitignore` 済み）。
> `.env.local` を削除（または名前を変更）すれば、従来どおりログインなしの「この端末だけ」モードに戻ります。

---

## STEP 3. Cloudflare Pages で公開する（約10分）

### 3-1. アカウント作成

1. <https://dash.cloudflare.com/sign-up> で無料アカウントを作ります（メールアドレスとパスワード。クレジットカード不要）。
2. 確認メールが届いたらリンクを押して認証します。

### 3-2. GitHub のリポジトリとつなぐ

1. Cloudflare ダッシュボード左メニューの **「Workers & Pages」**（「Compute」の中にある場合もあります）を開きます。
2. **「Create application」**（作成）を押し、**「Pages」** タブ → **「Import an existing Git repository」**（Gitに接続）を選びます。
   - 画面に Workers の作成しか出ない場合は、下の方にある **「Looking to deploy Pages? Get started」** のリンクから進んでください。
3. **「Connect GitHub」** を押し、GitHub の画面で「Cloudflare Workers and Pages」アプリのインストールを許可します。
   - 「Only select repositories」で **`tujidoh/tujidoh`** を選ぶのがおすすめです。
4. リポジトリ一覧から **`tujidoh`** を選んで **「Begin setup」**。

### 3-3. ビルド設定

次のように入力します。

| 項目 | 入力する値 |
|---|---|
| Project name | `itami-rental-map`（これがアドレス `https://itami-rental-map.pages.dev` になります。使用済みなら別名に） |
| Production branch | `claude/supabase-shared-sync`（main に統合した後は `main` に変更） |
| Framework preset | `React (Vite)`（無ければ `None`） |
| Build command | `npm run build` |
| Build output directory | `dist` |

**「Environment variables (advanced)」** を開き、**「+ Add variable」** で2つ追加します（STEP 1-5 の値）。

| Variable name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_xxxxxxxx` |

> 変数名は1文字でも違うと動きません。コピー＆ペーストしてください。
> Node.js のバージョンはリポジトリの `.node-version`（22）で自動指定されます。

### 3-4. 公開

1. **「Save and Deploy」** を押します。1〜3分でビルドが終わり、`https://itami-rental-map.pages.dev` のようなアドレスが表示されます。
2. そのアドレスを開き、ログイン画面が出れば成功です。
3. 以後、GitHub のブランチに変更を Push すると、自動的に再公開されます。

> **ログイン画面が出ずにそのまま地図が出る場合**：環境変数が設定されていません。Cloudflare のプロジェクト →「Settings」→「Variables and Secrets」（または「Environment variables」）で2つの変数を確認し、「Deployments」タブで最新のデプロイの「…」→ **「Retry deployment」** を実行してください（環境変数はビルド時に埋め込まれるため、再ビルドが必要です）。

### 3-5.（任意）Supabase に公開アドレスを登録

Supabase の **「Authentication」→「URL Configuration」→「Site URL」** に、3-4 のアドレス（例：`https://itami-rental-map.pages.dev`）を入力して保存しておきます。
今のパスワードログインには必須ではありませんが、将来パスワード再設定メールなどを使う場合に必要になります。

---

## STEP 4. スマホで使う

1. スマホのブラウザ（iPhone は Safari、Android は Chrome）で公開アドレスを開き、ログインします。
2. ホーム画面に追加しておくと、アプリのように開けます。
   - iPhone：共有ボタン（□↑）→「ホーム画面に追加」
   - Android：右上の「︙」→「ホーム画面に追加」
3. 一度ログインすれば、ログアウトするまでログイン状態が続きます。

---

## 使い方のポイント

- 画面上部の **同期バッジ**：✓ 同期済み ／ ⟳ 同期中 ／ ⚠ オフライン（未送信あり）／ ! エラー。押すと詳細が見られます。
- 電波が無い所で編集しても、端末に保存され、つながったときに自動で送信されます。
- 2人が同じ物件を同時に編集した場合は、**後から保存した方** が残ります。
- 相手の変更は、通常数秒以内に自動で反映されます（リアルタイム接続）。反映されない場合は「データ管理」→「今すぐ同期」。
- 取り込んだ GeoJSON・絞り込み条件・並び順は **端末ごと** の設定です（共有されません）。
- **ログアウト** すると、その端末に保存された物件データは消えます（サーバーには残ります）。共用PCで使った後などに。

## 無料プランの注意点

| サービス | 無料プランの主な条件 | 影響 |
|---|---|---|
| Supabase Free | DB 500MB、プロジェクト2つまで。**1週間アクセスが無いと一時停止** | 物件データは数百件でも数MB程度で余裕。一時停止してもデータは消えず、Supabase の画面で「Restore project」を押せば再開できます |
| Cloudflare Pages Free | ビルド月500回、通信量無制限 | 個人利用で上限に達することはまずありません |

念のため、月1回程度「データ管理」→「JSONでエクスポート」でバックアップを取っておくと安心です。

## パートナーの追加・変更やパスワード再設定

- **パスワードを忘れた**：Supabase「Authentication」→「Users」で該当ユーザーの「…」→ パスワード変更（または削除して作り直し）。
- **メンバーを入れ替える**：SQL Editor で次を実行し、Users でアカウントを作成。
  ```sql
  insert into public.app_members (email) values ('new@example.com');
  delete from public.app_members where email = 'old@example.com';
  ```

## うまくいかないとき

| 症状 | 確認すること |
|---|---|
| 「メールアドレスまたはパスワードが違います」 | 1-4 で作ったアドレス・パスワードか。大文字小文字。 |
| 「メールアドレスが未確認です」 | 1-4 の「Auto Confirm User」を入れ忘れ。Users でユーザーを削除して作り直す。 |
| 同期エラー「アクセス権がありません」 | 1-2 のメンバー表に、ログインしたメールアドレス（小文字）が入っているか。 |
| 同期エラー「データベースの表がありません」 | 1-2 の SQL を実行したか。 |
| ログイン画面が出ない | 3-3 の環境変数（ローカルなら `.env.local`）と、設定後の再ビルド。 |
| 相手の変更がすぐ出ない | 「データ管理」の表示が「リアルタイム未接続」なら、画面を開き直すか「今すぐ同期」。1-2 の SQL の最後（リアルタイム設定）が実行されているか。 |
