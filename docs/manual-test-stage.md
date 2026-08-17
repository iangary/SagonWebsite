# 綠界 stage + 黑貓測試站 — 手動測試腳本

> 這份文件只收「**無法自動化**」的測試：要真的連綠界測試站、黑貓測試站、真實 SMTP 的那些。
> 能用整合測試或 E2E 覆蓋的項目不在這裡（見 `docs/test-checklist.html` 的 B、C、F、G 各節）。
> 對應檢核表項目：B-14、F-10、F-12～F-14、G-08、L-05。

**執行規則**

- 依 M-1 → M-8 順序執行，前面的訂單可以留給後面的步驟用。
- 每一條測試都要填「記錄欄位」：**訂單編號、執行時間、截圖、相關 Webhook 事件 id**（後台 → Webhook）。
- 任何一步的實際結果與預期不符 → 立即停止、**保留現場**，依文末的「失敗處理程序」蒐證後再決定是否繼續。

---

## 前置作業

### P-1 `.env` 填入 stage 憑證

以 `.env.example` 為底，確認下列變數（名稱以 `.env.example` 為準）：

| 群組 | 變數 | 說明 |
|---|---|---|
| 綠界共用 | `ECPAY_ENV=stage` | 一律 stage，正式金鑰不進這份腳本 |
| 金流 AIO | `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` | 官方測試帳號 `3002607` 那組即可 |
| 物流 C2C | `ECPAY_LOGISTICS_MERCHANT_ID` / `ECPAY_LOGISTICS_HASH_KEY` / `ECPAY_LOGISTICS_HASH_IV` | C2C 官方測試帳號 `2000933` 那組；B2C 與 C2C 不共用、不能混串 |
| 電子收據 | `ECPAY_RECEIPT_MERCHANT_ID` / `ECPAY_RECEIPT_HASH_KEY` / `ECPAY_RECEIPT_HASH_IV` / `ECPAY_RECEIPT_AUTO_ISSUE` | M-7 前半自動開立需 `AUTO_ISSUE=true` |
| 寄件人 | `ECPAY_SENDER_NAME` / `ECPAY_SENDER_PHONE` / `ECPAY_SENDER_CELLPHONE` / `ECPAY_SENDER_ZIPCODE` / `ECPAY_SENDER_ADDRESS` | `NAME` 限 4～10 字元、不可填公司名；地址欄位黑貓建單會用到（見 P-5） |
| 黑貓 | `TCAT_ENV=stage`、`TCAT_CUSTOMER_ID` / `TCAT_CUSTOMER_TOKEN` / `TCAT_SENDER_ZIP`、`TCAT_OBT_TYPE` / `TCAT_PRODUCT_TYPE_ID` / `TCAT_DEFAULT_SPEC` / `TCAT_SPEC_QTY_STEP` | 契客代號與授權碼在黑貓契客專區取得；`TCAT_SENDER_ZIP` 是**黑貓郵碼後六碼**，不是郵遞區號（見 P-5） |

### P-2 cloudflared tunnel 與 `APP_URL`

綠界的 ReturnURL / PaymentInfoURL / 物流回拋都是**綠界主動打過來**，本機必須有公開網址：

1. `docker compose --profile tunnel up -d cloudflared`，從 log 取得 `https://xxx.trycloudflare.com`。
2. 把該網址填進 `APP_URL` 與 `NEXT_PUBLIC_APP_URL`，重啟 app 與 worker。
3. 驗證：瀏覽器開 `https://xxx.trycloudflare.com/api/health` 應回 200。

> trycloudflare 網址每次重啟會換，換了就要重填 `.env` 並重啟。測試中途 tunnel 斷線＝所有回拋都會遺失。

### P-3 服務全開

1. `docker compose up -d db redis mailpit`
2. `npm run worker`（**必須開著**——建物流單、開收據、寄信、黑貓輪詢全在 worker）
3. 啟動 app（`npm run dev` 或 production build）。
4. Mailpit 收信匣：<http://localhost:8025>。
5. 後台登入：`admin@sagon.local` / `admin1234`（seed 帳號）。

### P-4 收據字軌（M-7 的前置，也是目前唯一的功能性阻塞點）

登入 <https://vendor-stage.ecpay.com.tw>，為收據測試商店設定**收據字軌**。
沒設定字軌，開立一律回「查無可使用字軌」——M-1～M-6 仍可執行（開收據的 job 會失敗留在佇列），但 M-7 整條會卡住。

### P-5 黑貓需要真實寄件地址

⚠️ M-6 會建立**真實託運單**（黑貓測試站也可能實際派收）。執行前：

1. `ECPAY_SENDER_ADDRESS` / `ECPAY_SENDER_ZIPCODE` 填真的出貨地址。
2. 跑 `npx tsx --env-file-if-exists=.env scripts/tcat-parse-address.ts "你的寄件地址"`，把回傳郵碼的後六碼填進 `TCAT_SENDER_ZIP`。這一步同時驗證了契客代號與授權碼有效。

---

## M-1 信用卡付款（對應 B-14）

**測試卡**：`4311-9522-2222-2222`，有效期填任何未來年月，CVV `222`。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 前台加購物車 → 結帳，配送選「宅配」，付款選「信用卡」，送出 | 導向綠界 stage 收銀台，網址是 `payment-stage.ecpay.com.tw` |
| 2 | 輸入測試卡完成刷卡（含 3D 驗證頁） | 導回本站結果頁，顯示**付款成功**與訂單明細 |
| 3 | 後台 → 訂單 | 訂單狀態 `PAID`（或已被 worker 推進 `PROCESSING`），付款方式、綠界交易編號有值 |
| 4 | 後台 → Webhook | 有一筆 ReturnURL 事件，已處理、簽章有效 |
| 5 | Mailpit | 收到「付款成功」通知信，金額、品項、配送方式正確 |
| 6 | worker log | 依序出現 `create-shipment`、`issue-receipt`、`send-email` 三個 job（收據 job 在字軌未設定時會失敗，屬預期，見 P-4） |

**記錄欄位**：訂單編號／時間／結果頁截圖／Webhook 事件 id／綠界 TradeNo。

## M-2 ATM 虛擬帳號（含 F1 修復驗證）

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 下單，付款選「ATM」 | 綠界回傳虛擬帳號後導回結果頁 |
| 2 | 檢視結果頁 | 顯示**銀行代碼、虛擬帳號、繳費期限**；**沒有**「重新付款」按鈕（取號後不能換管道重付） |
| 3 | 後台 → 訂單 | 訂單仍是 `PENDING_PAYMENT`；Mailpit 收到「取號完成」通知信 |
| 4 | **F1 驗證**：查 DB（或後台）該訂單的 `expiresAt` | 應為建單後**約 1 天**，不是 30 分鐘——ATM 的 `ExpireDate` 單位是天、下限 1 天，庫存預扣期已對齊（`actualExpireMinutes`，`src/lib/ecpay/aio.ts`） |
| 5 | 登入綠界 stage 廠商後台 → 模擬 ATM 付款完成 | 收到 ReturnURL，訂單轉 `PAID`，庫存轉實扣，寄出付款成功信 |

> **逾期入帳安全網**（F1 的另一半）：若訂單已被取消後才收到成功回拋，系統不會復活訂單，
> 而是把 payment 標成 `PAID` 並寫入 failReason「逾期入帳：訂單已取消但仍收到付款，需人工退款」，
> 於後台訂單頁可見。此行為已有整合測試覆蓋，手動流程只需知道去哪裡看。

**記錄欄位**：訂單編號／時間／結果頁截圖／`expiresAt` 值／Webhook 事件 id。

## M-3 超商代碼繳費（CVS）

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 下單，付款選「超商代碼」 | 結果頁顯示繳費代碼與期限（以分鐘計） |
| 2 | 後台 → 訂單 | 仍是 `PENDING_PAYMENT`；Mailpit 收到取號通知信 |
| 3 | 綠界 stage 後台 → 模擬超商繳費完成 | 訂單轉 `PAID`，後續與 M-1 相同（物流單、收據、寄信） |

**記錄欄位**：訂單編號／繳費代碼／時間／Webhook 事件 id。

## M-4 電子地圖真實選店（對應 F-08 的手動面）

至少測 **7-ELEVEN 與全家**各一次（萊爾富、OK 有空再補）。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 桌機結帳頁選「超商取貨」→ 點選店 | 彈出綠界電子地圖（popup），可搜尋、選定門市 |
| 2 | 選定門市 | popup 關閉，結帳頁自動帶入門市代號、名稱、地址 |
| 3 | 再點一次選店、換一間門市 | **覆蓋**原本的門市，不是殘留舊值 |
| 4 | 手機（或視窗被瀏覽器擋 popup）走同一流程 | 走 sessionStorage fallback：整頁導向地圖 → 選完導回結帳頁，門市資料還在、**已填的表單欄位不遺失** |
| 5 | 換 7-11 ↔ 全家重複 1–4 | 兩家超商都成功 |

> **F4 防偽驗證**：結帳頁開地圖時會發一個 token 存在 sessionStorage 並放進 `ExtraData`，
> 地圖回拋（map-reply）會原樣帶回、由結帳頁驗證。所以**只有「本次結帳視窗開出去的地圖」的回傳會被接受**；
> 直接對 map-reply 端點偽造門市回傳不會進到別人的結帳流程。手動測試只要確認正常流程可用即可。

**記錄欄位**：門市代號與名稱／截圖（桌機與手機各一）／時間。

## M-5 C2C 超商建單 + 列印一段標（對應 F-10）

前提：M-3 或 M-4 產生的**已付款**超商取貨訂單（7-11 一筆、全家一筆）。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 付款完成後等 worker 跑 `create-shipment` | 自動建立綠界物流單，訂單轉 `PROCESSING`，`AllPayLogisticsID` 有值 |
| 2 | 後台訂單頁 → 「列印一段標」 | 開新視窗（POST 到綠界帶簽章），一段標版面正確：門市、收件人、單號齊全 |
| 3 | 全家訂單重複 1–2 | 同樣成功（兩家超商的標籤格式不同，都要看過） |
| 4 | **重入防護**：對已有物流單的訂單再看建單按鈕 | 按鈕顯示「已建立物流單」且不可用；不會產生第二張物流單 |
| 5 | **F2 驗證**：若前次建單失敗落到人工處理，再按「建立物流訂單」 | 出現 confirm 對話框警告「物流端可能已經成單，重新建單會產生第二張真實託運單」，取消則不送出 |

**記錄欄位**：訂單編號／`AllPayLogisticsID`／一段標截圖／時間。

## M-6 黑貓宅配建單 + 託運單 + 貨態輪詢（對應 F-12～F-14）

前提：一筆**已付款的宅配（HOME）**訂單（可用 M-1 的）。⚠️ 見 P-5，會產生真實託運單，建兩張就是兩筆真實運費（黑貓**沒有冪等鍵**）。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | worker 跑 `create-shipment`（或後台按「建立黑貓託運單」） | PrintOBT 成功：`shipmentNo`（托運單號）有值，訂單轉 `PROCESSING` |
| 2 | 檢查 `storage/labels/` | 出現該訂單的託運單 PDF（DownloadOBT 建單當下就抓回來存檔） |
| 3 | 後台訂單頁 → 「列印託運單」（`GET /api/admin/labels/[orderId]`） | PDF 開得起來，版面與 `docs/黑貓宅急便…/03 託運單樣本` 的 A4 二模樣本一致 |
| 4 | **立刻把 PDF 另存備份** | ⚠️ 黑貓 `FileNo` 只有 **24 小時**有效，過期無法向黑貓重新下載；目前**沒有補印機制**（已知缺口，檢核表「F. 物流」節 F-15）。本機 `storage/labels/` 的檔案是唯一副本 |
| 5 | **重入防護**：重跑 `create-shipment` job、再看後台按鈕 | 按鈕 disabled；不會再建第二張託運單 |
| 6 | 手動觸發貨態輪詢：`npx tsx --env-file-if-exists=.env --conditions=react-server scripts/enqueue-job.ts poll-tcat-status` | worker 執行 `queryObtStatus`，`LogisticsStatusLog` 寫入貨態；**連跑兩次不產生重複歷程**（以「代碼＋發生時間」去重）。平時由 worker 每 30 分鐘自動輪詢 |
| 7 | 後台訂單頁與前台訂單查詢頁 | 貨態時間軸顯示黑貓狀態與時間，後台另有「狀態訊息」列（`Shipment.statusMsg`，F2 修復後新增） |

**記錄欄位**：訂單編號／托運單號／PDF 檔名與備份位置／輪詢時間／`LogisticsStatusLog` 筆數。

## M-6b 呼叫黑貓來收貨（印單 API 2.6 `Call`）

⚠️ **這支 API 會叫真人開車過來**，而且黑貓**每個收貨點每日只受理一次**、無法指定時段。
測試站也可能實際派收（同 P-5），一天只有一次機會，請排在 M-6 建完託運單之後再做。

前提：至少一張黑貓託運單處於 `CREATED`（已配號、還沒被收走）。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | 後台 → 訂單列表 → 右上「呼叫黑貓收貨」 | 先問件數（預設帶入待交寄的張數）、再問備註，最後 confirm 警告「一天只受理一次」 |
| 2 | 確認送出 | Toast 顯示黑貓原文回覆（例：「集貨通知已送出成功，司機將於 3 點後前往取件」）；`tcat_pickup_calls` 多一筆 `succeededDate` = 今天 |
| 3 | **重入防護**：重新整理後再看按鈕 | 按鈕換成「今天已呼叫黑貓收貨（N 件，HH:MM:SS）」，沒有第二顆可按的按鈕 |
| 4 | （選用）直接再呼叫一次 server action | 回「今天已經呼叫過黑貓了」，**不會**再打黑貓 |
| 5 | 件數填 0 或非數字 | 前端就擋下來，不送出 |

**記錄欄位**：`SrvTranId`／黑貓回覆訊息／件數／司機實際到場時間。

## M-7 電子收據（對應 G-08；**需先完成 P-4 字軌**）

> 電子收據不是統一發票，不能報稅抵扣；紙本統一發票仍由人工開立、後台「回填發票號碼」登錄。

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | `ECPAY_RECEIPT_AUTO_ISSUE=true`，完成一筆付款 | worker `issue-receipt` 成功，收據號碼寫回訂單，綠界收據後台查得到這張 |
| 2 | **負數品項驗證（首次開立必看）** | 用一筆**有折扣碼**的訂單開立：折扣是負數單價品項（`src/lib/orders/receipt.ts`）。官方文件只寫「單價可為 0」沒明說可為負——**這是未驗證的假設**。若被退件，改成把折扣按比例攤回各品項再重測 |
| 3 | 後台 → 訂單 → 作廢收據，填作廢原因 | 作廢成功、狀態正確（綠界限制原因 200 字元，超過會被截斷） |
| 4 | 改 `ECPAY_RECEIPT_AUTO_ISSUE=false`、重啟，再完成一筆付款 | **不會**自動開立；後台可人工觸發開立且成功 |
| 5 | 下一筆結帳選**公司戶（統編）**的訂單並付款 | 電子收據**照常開立**（收據本身沒有統編欄位）；統編與公司抬頭進的是**紙本發票紀錄**（後台訂單頁可見，供人工開立紙本發票後「回填發票號碼」） |

**記錄欄位**：訂單編號／收據號碼／開立與作廢時間／截圖（綠界收據後台查詢結果）。

## M-8 真實 SMTP 寄信（對應 L-05）

| # | 操作 | 預期結果 |
|---|---|---|
| 1 | `.env` 的 `SMTP_HOST/PORT/USER/PASS/SECURE`、`MAIL_FROM` 換成正式 SMTP，重啟 worker | — |
| 2 | 完整走一筆訂單（下單 → 付款 → 建物流單） | Gmail 真實信箱收到「付款成功」與「已出貨」通知信，**不在垃圾信匣** |
| 3 | 檢視信件原始檔的 `Authentication-Results` 標頭 | `spf=pass`、`dkim=pass`、`dmarc=pass` |
| 4 | 檢查信件內容 | zh-TW 文案與中文字型正常顯示、金額品項門市正確、寄件者名稱與回覆地址正確 |
| 5 | 測完把 SMTP 改回 Mailpit | 避免後續測試對外亂寄信 |

**記錄欄位**：收信時間／`Authentication-Results` 全文／信件截圖。

---

## 失敗處理程序

任何一步不符預期時：

1. **停止測試，不要重試、不要重按按鈕**（重試會污染現場，黑貓重建單還會多花運費）。
2. 保留現場：截圖當下畫面、記下訂單編號與時間。
3. 蒐集證據：
   - worker log（含失敗 job 的完整 stack trace）；
   - 後台 → Webhook 該筆事件的**原始 payload** 與處理狀態；
   - 若是 enqueue 失敗：查 AuditLog 的 `enqueue-failed` 紀錄（F5 修復），之後可用 `scripts/enqueue-job.ts` 手動補派。
4. 把「操作步驟 → 預期 → 實際 → 證據」寫進問題單，再決定修復或繼續。
