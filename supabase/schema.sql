-- =====================================================================
-- 伊丹 賃貸比較マップ：共有データベース設定（Supabase SQL Editor で1回実行）
--
-- ★実行前に、下の「メンバー登録」の2つのメールアドレスを
--   あなたとパートナーのものに書き換えてください。
-- 何度実行しても壊れないように書いてあります（再実行OK）。
-- =====================================================================

-- ---------- 1. メンバー（この2人だけがデータを読み書きできる） ----------
create table if not exists public.app_members (
  email text primary key check (email = lower(email))
);
alter table public.app_members enable row level security;
-- app_members にはポリシーを作らない＝画面（API）からは読み書き不可。管理はSQL Editorだけで行う。

-- ★ここを書き換え（小文字で）
insert into public.app_members (email) values
  ('you@example.com'),
  ('partner@example.com')
on conflict do nothing;

-- ログイン中のユーザーがメンバーかどうか
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- ---------- 2. 物件データ ----------
-- 物件1件 = 1行。中身はアプリの Property をそのまま JSON (data) で保存します。
-- 削除は「deleted = true」の印をつける方式（相手の端末にも削除を伝えるため）。
create table if not exists public.properties (
  id          text primary key,
  data        jsonb not null,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists properties_updated_at_idx on public.properties (updated_at);

alter table public.properties enable row level security;

drop policy if exists "members can read" on public.properties;
create policy "members can read" on public.properties
  for select to authenticated using (public.is_member());

drop policy if exists "members can insert" on public.properties;
create policy "members can insert" on public.properties
  for insert to authenticated with check (public.is_member());

drop policy if exists "members can update" on public.properties;
create policy "members can update" on public.properties
  for update to authenticated using (public.is_member()) with check (public.is_member());
-- DELETE のポリシーは作らない（行の物理削除は不可。削除は deleted フラグで行う）

revoke all on table public.properties from anon;
revoke delete, truncate on table public.properties from authenticated;
grant select, insert, update on table public.properties to authenticated;
revoke all on table public.app_members from anon, authenticated;

-- ---------- 3. 更新ルール ----------
-- ・古い内容で新しい内容を上書きしない（2人が同時に編集しても、後から編集した方が残る）
-- ・updated_at / updated_by はサーバー側で自動設定
create or replace function public.properties_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(new.data ->> 'updatedAt', '') < coalesce(old.data ->> 'updatedAt', '') then
    return null; -- 古い更新は無視（エラーにはしない）
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists properties_before_write on public.properties;
create trigger properties_before_write
  before insert or update on public.properties
  for each row execute function public.properties_before_write();

-- ---------- 4. リアルタイム同期（相手の変更をすぐ反映） ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'properties'
     ) then
    alter publication supabase_realtime add table public.properties;
  end if;
end $$;

-- 確認用：登録されたメンバー
select email as "登録済みメンバー" from public.app_members order by email;
