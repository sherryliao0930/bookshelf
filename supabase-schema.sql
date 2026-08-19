-- ======================================================
--  電子書櫃 Supabase 資料庫設定
--  用法：Supabase 後台 → 左側 SQL Editor → New query
--       把這整份貼上 → 按 Run。跑一次就好。
-- ======================================================

-- ---------- 1. 書籍資料表 ----------
create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  author      text,
  pdf_path    text not null,          -- Storage 裡 PDF 的路徑
  cover_path  text,                   -- Storage 裡封面的路徑（可空）
  page_count  int,
  size_bytes  bigint,
  position    int,                    -- 書架上的順序（拖曳排序用，小的排前面）
  category    text,                   -- 分類／科目（空的＝未分類）
  created_at  timestamptz not null default now()
);

create index if not exists books_created_idx on public.books (created_at desc);
create index if not exists books_position_idx on public.books (position);
create index if not exists books_category_idx on public.books (category);

alter table public.books enable row level security;

-- 任何人都可以「看」書櫃（因為你選擇：拿到網址的人都能看）
drop policy if exists "anyone can read books" on public.books;
create policy "anyone can read books"
  on public.books for select
  to anon, authenticated
  using (true);

-- 任何人都可以新增／刪除書籍紀錄。
-- 注意：真正的門檻是 config.js 裡的 ADMIN_PASSWORD（前端關卡），
--       它只擋一般路人，擋不住懂技術的人。詳見「設定說明.md」的安全提醒。
drop policy if exists "anyone can insert books" on public.books;
create policy "anyone can insert books"
  on public.books for insert
  to anon, authenticated
  with check (true);

-- 改書名、換封面、拖曳排序都需要 update 權限
drop policy if exists "anyone can update books" on public.books;
create policy "anyone can update books"
  on public.books for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anyone can delete books" on public.books;
create policy "anyone can delete books"
  on public.books for delete
  to anon, authenticated
  using (true);

-- ---------- 2. 檔案空間（Storage bucket） ----------
insert into storage.buckets (id, name, public)
values ('books', 'books', true)
on conflict (id) do update set public = true;

-- 任何人都可以下載／閱讀檔案
drop policy if exists "public read books bucket" on storage.objects;
create policy "public read books bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'books');

-- 任何人都可以上傳（同樣由前端密碼把關）
drop policy if exists "public upload books bucket" on storage.objects;
create policy "public upload books bucket"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'books');

drop policy if exists "public update books bucket" on storage.objects;
create policy "public update books bucket"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'books');

drop policy if exists "public delete books bucket" on storage.objects;
create policy "public delete books bucket"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'books');

-- ---------- 3. 即時同步（別人上傳時你的畫面自動更新） ----------
-- 若這行報錯說已經在裡面了，忽略即可。
alter publication supabase_realtime add table public.books;
