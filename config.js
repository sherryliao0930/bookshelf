// ===== 電子書櫃 設定檔 =====
// 請把下面三個地方換成你自己的資料，改完存檔即可，不需要重新編譯任何東西。

// 1) Supabase 專案網址（形如 https://xxxxxxxx.supabase.co）
const SUPABASE_URL = 'https://pvdhuqmycnesvfgjogle.supabase.co';

// 2) Supabase anon public key（很長一串，開頭通常是 eyJ...）
const SUPABASE_ANON_KEY = 'sb_publishable_OyR1H945iEtwLiCNVjoRyw_uZTmKhaG';

// 3) 管理密碼：知道這組密碼的人才能「上傳新書」和「刪除書」。
//    只想自己管理就設一組別人猜不到的；想讓大家都能上傳，設成空字串 '' 即可。
const ADMIN_PASSWORD = 'liaopeiyu';

// 4) Storage bucket 名稱（照著 supabase-schema.sql 建立的話不用改）
const BUCKET = 'books';

// 5) 書櫃標題（顯示在網頁最上方）
const SHELF_TITLE = '609通用教材電子書櫃';

// 6) 分類（科目）清單：書架會照這個順序分層，上傳時也從這裡選。
//    想改科目、加減項目，直接改這一行就好，順序就是書架上的順序。
const CATEGORIES = ['國語', '數學', '自然', '社會', '英語', '健體', '藝術', '綜合'];
