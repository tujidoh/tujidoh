-- schema.sql の権限・更新ルールのテスト。失敗すると例外で止まる。
\set ON_ERROR_STOP on

-- メンバー（schema.sql のサンプル: you@example.com）
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"You@Example.com","role":"authenticated"}';
insert into public.properties (id, data) values ('p1', '{"name":"A","updatedAt":"2026-11-16T10:00:00.000Z"}');
do $$ begin
  assert (select count(*) from public.properties) = 1, 'member should see own insert';
  assert (select updated_by from public.properties where id='p1') = '11111111-1111-1111-1111-111111111111', 'updated_by set';
end $$;

-- 新しい更新は反映される（upsert）
insert into public.properties (id, data) values ('p1', '{"name":"B","updatedAt":"2026-11-16T11:00:00.000Z"}')
  on conflict (id) do update set data = excluded.data, deleted = excluded.deleted;
do $$ begin assert (select data->>'name' from public.properties where id='p1') = 'B', 'newer update applied'; end $$;

-- 古い更新は無視される
insert into public.properties (id, data) values ('p1', '{"name":"OLD","updatedAt":"2026-11-16T09:00:00.000Z"}')
  on conflict (id) do update set data = excluded.data, deleted = excluded.deleted;
do $$ begin assert (select data->>'name' from public.properties where id='p1') = 'B', 'older update ignored'; end $$;

-- 物理削除はできない
do $$ begin
  begin
    delete from public.properties where id = 'p1';
    raise exception 'delete should be denied';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.properties) = 1, 'delete must not remove rows';
end $$;

-- パートナー
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"partner@example.com","role":"authenticated"}';
do $$ begin assert (select count(*) from public.properties) = 1, 'partner sees shared data'; end $$;
update public.properties set data = '{"name":"C","updatedAt":"2026-11-16T12:00:00.000Z"}', deleted = true where id='p1';
do $$ begin assert (select deleted from public.properties where id='p1'), 'soft delete by partner'; end $$;

-- メンバー以外のログインユーザー：見えない・書けない
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","email":"stranger@example.com","role":"authenticated"}';
do $$ begin assert (select count(*) from public.properties) = 0, 'stranger must not read'; end $$;
do $$ begin
  begin
    insert into public.properties (id, data) values ('x', '{"updatedAt":"2026-11-16T12:00:00.000Z"}');
    raise exception 'stranger insert should fail';
  exception when insufficient_privilege then null; -- RLS違反
  end;
end $$;
update public.properties set deleted = false where id='p1';
reset role;
do $$ begin assert (select deleted from public.properties where id='p1'), 'stranger update must not apply'; end $$;

-- メンバー表は API から見えない
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"you@example.com","role":"authenticated"}';
do $$ begin
  begin
    perform 1 from public.app_members;
    raise exception 'members table should be hidden';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from pg_proc where proname='is_member' and has_function_privilege('anon', oid, 'execute')), 'anon cannot call is_member';
end $$;

-- 未ログイン（anon）：アクセス不可
set role anon;
set request.jwt.claims = '';
do $$ begin
  begin
    perform 1 from public.properties;
    raise exception 'anon should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- リアルタイム配信対象に入っている
do $$ begin assert exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='properties'), 'realtime publication'; end $$;
select 'RLS tests: OK' as result;
