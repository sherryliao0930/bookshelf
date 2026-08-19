# 六上電子書櫃

書架樣式的班級電子書網站：上傳 PDF 與封面，就會變成書架上一本一本的電子書，
點下去可以翻閱、輸入頁數跳頁、放大縮小。書本依科目分層擺放。

- **前端**：單檔 HTML + CSS + JS，沒有建置流程
- **後端**：Supabase（Postgres + Storage）
- **PDF 閱讀**：pdf.js

## 設定

詳見 [設定說明.md](設定說明.md)。簡單說：

1. 到 supabase.com 開一個免費專案
2. SQL Editor 執行 `supabase-schema.sql`（新專案）或 `supabase-migration.sql`（既有專案要補的欄位與權限）
3. 把 Project URL 和 publishable key 填進 `config.js`

## 注意

`config.js` 裡的 `ADMIN_PASSWORD` 是前端關卡，只擋一般路人，不是真正的權限保護。
不要放有版權或含個資的檔案。
