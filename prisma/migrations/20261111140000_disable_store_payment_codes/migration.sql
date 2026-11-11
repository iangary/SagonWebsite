-- 店家決定不提供超商繳費：把已存的付款設定裡「超商代碼繳費」「超商條碼繳費」取消勾選。
--
-- 只改資料、不改結構。程式的預設值（lib/shop-settings.ts 的 ONLINE_METHOD_DEFAULTS）
-- 也同步改成關閉，但正式站在後台存過付款設定，存下來的值會蓋過預設 —— 所以要這一步。
--
-- 已經用超商代碼／條碼成立、還在等繳費的訂單不受影響：開關只管「之後還能不能選」。
-- 日後要恢復，到後台 → 設定 → 付款 勾回去即可，這支 migration 不會再跑第二次。

UPDATE "shop_settings"
SET "value" = jsonb_set(
      jsonb_set("value", '{methods,CVS}', 'false'::jsonb),
      '{methods,BARCODE}', 'false'::jsonb
    )
WHERE "key" = 'payment'
  AND jsonb_typeof("value" -> 'methods') = 'object';
