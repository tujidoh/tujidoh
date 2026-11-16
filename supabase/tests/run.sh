#!/usr/bin/env bash
# schema.sql をローカル PostgreSQL でテストする（開発者向け）
# 使い方: PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
$P -c 'drop database if exists itami_rls_test' -c 'create database itami_rls_test'
$P -d itami_rls_test -f supabase/tests/supabase_shim.sql 2>/dev/null
$P -d itami_rls_test -f supabase/schema.sql >/dev/null 2>&1
$P -d itami_rls_test -f supabase/schema.sql >/dev/null 2>&1   # 再実行しても壊れないこと
$P -d itami_rls_test -f supabase/tests/rls_test.sql
