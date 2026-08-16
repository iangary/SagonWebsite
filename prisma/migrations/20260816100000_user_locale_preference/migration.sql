-- 會員的介面語系偏好。
--
-- localePrefix 改成 never 之後（b592e6b），語系只記在 NEXT_LOCALE cookie 裡，
-- 而那是一個沒有 maxAge 的 session cookie —— 關掉瀏覽器就沒了，手機更容易被系統回收，
-- 使用者每次回來都要重選。存在會員身上才能跨裝置、跨瀏覽器保留。
--
-- null 代表沒選過，維持原本依 Accept-Language 判斷的行為。

-- AlterTable
ALTER TABLE "users" ADD COLUMN "locale" TEXT;
