-- 重設／變更密碼時讓既有 session 失效。
--
-- session 是 JWT（不存資料庫），沒辦法從伺服器端刪掉。改成在 token 裡記登入當下的
-- sessionVersion，jwt callback 定期對照資料庫，對不上就作廢 —— 改密碼時把這欄 +1 即可。
-- 預設 0：上線前就簽發的 token 沒有這個欄位，視同 0，不會把所有人踢出去。
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
