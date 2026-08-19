-- ======================================================
--  電子書櫃 · 追加功能用的資料庫更新
--  用途：讓「拖曳排序」和「改書名／換封面」能存回雲端
--
--  用法：Supabase 後台 → SQL Editor → New query
--       整份貼上 → 按 Run。跑一次就好，重複跑也不會壞。
--
--  ※ 如果你是第一次設定書櫃，直接跑 supabase-schema.sql 就好，
--    那一份已經包含這裡的所有東西，不用再跑這份。
-- ======================================================

-- ---------- 1. 排序欄位 ----------
-- 記住每本書在書架上的位置，數字小的排前面
alter table public.books add column if not exists position int;

create index if not exists books_position_idx on public.books (position);

-- 把現有的書照上架時間先編好號（新的在前），之後就能自由拖曳
with ordered as (
  select id, row_number() over (order by created_at desc) * 10 as pos
  from public.books
  where position is null
)
update public.books b
set position = o.pos
from ordered o
where b.id = o.id;

-- ---------- 2. 分類欄位 ----------
-- 每本書屬於哪一科（國語、數學…），空的就是「未分類」
alter table public.books add column if not exists category text;

create index if not exists books_category_idx on public.books (category);

-- ---------- 3. 修改權限 ----------
-- 改書名、換封面、存排序都需要 update 權限。
-- 注意：真正的門檻是 config.js 裡的 ADMIN_PASSWORD（前端關卡），
--       它只擋一般路人，擋不住懂技術的人。詳見「設定說明.md」的安全提醒。
drop policy if exists "anyone can update books" on public.books;
create policy "anyone can update books"
  on public.books for update
  to anon, authenticated
  using (true)
  with check (true);
