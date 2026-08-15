# 莎岡選品店 — 電商網站

繁體中文電商網站，版面與資訊架構參考 [www.sagan.com.tw](https://www.sagan.com.tw)。
Docker + Next.js 16 + PostgreSQL 18，串接**綠界 ECPay 金流、超商取貨與電子收據**，
會員支援 **Google SSO / Email 密碼 / 手機驗證碼**三種登入並可互相綁定。

> 這份 README 講的是**怎麼跑起來**。
> 想知道**系統做什麼、規則怎麼定、為什麼這樣設計**，看 [SPEC.md](SPEC.md)。

---

## ⚠️ 關於商品素材的著作權

`prisma/seed-data/` 與 `public/uploads/seed/` 的商品文案與圖片是**從 sagan.com.tw 抓取的他人著作權素材**，
只供本機開發與測試使用，**不得對外上線**。兩個目錄都已列入 `.gitignore`，
爬蟲也需要 `SEED_SOURCE=sagan` 才會執行。正式營運前請換成自有素材。

---

## 快速開始

```bash
cp .env.example .env
docker compose up -d db redis mailpit
npm install
npx prisma migrate dev
SEED_SOURCE=sagan npm run scrape   # 抓商品（約 12 分鐘，每秒 1 request）
npm run seed
npm run dev
```

開 <http://localhost:3000>。另開一個終端跑背景工作：

```bash
npm run worker
```

| 服務 | 網址 | 說明 |
|---|---|---|
| 前台 | <http://localhost:3000> | |
| 後台 | <http://localhost:3000/admin> | `admin@sagon.local` / `admin1234` |
| 測試會員 | | `customer@sagon.local` / `admin1234`（手機 0912345678） |
| Mailpit | <http://localhost:8025> | 開發用收信匣 |
| Adminer | <http://localhost:8080> | `docker compose up -d adminer` |
| PostgreSQL | `localhost:15433` | 避開其他 PG 與 Windows 動態保留埠（5150–5749 會吃掉 5433），容器間仍走 `db:5432` |

---

## 綠界串接：本機開發必讀

綠界的付款結果通知是**從綠界的伺服器打進來**的，`localhost` 它連不到。
沒有公開網址的話，付款完成後訂單狀態不會更新。結帳頁上會有紅字提醒。

```bash
docker compose --profile tunnel up -d cloudflared
docker compose logs cloudflared | grep trycloudflare
```

把取得的網址填進 `.env` 的 `APP_URL` 與 `NEXT_PUBLIC_APP_URL`，**重啟 dev server**。
`next.config.ts` 會自動把這個網域加進 `allowedDevOrigins`，不用另外設定。

### 三個服務的簽章方式不同

| 服務 | 簽章 | 測試站 | 商店代號 |
|---|---|---|---|
| 全方位金流 AIO | CheckMacValue（**SHA256**） | `payment-stage` | `ECPAY_MERCHANT_ID` |
| 物流整合（僅超商 C2C） | CheckMacValue（**MD5**） | `logistics-stage` | `ECPAY_LOGISTICS_MERCHANT_ID` |
| 電子收據 | **AES-128-CBC** 加密 JSON | `einvoice-stage` | `ECPAY_RECEIPT_MERCHANT_ID` |

**沒有串的**：電子發票（沒申請，紙本由人工開立隨包裹寄出）、宅配（黑貓另外簽約，
不經綠界）、超商 B2C（申請類型與 C2C 不能混串，需要第二組商店代號）。

CheckMacValue 的實作對照官方文件範例寫了 golden test（`src/lib/ecpay/checkmac.test.ts`），
改動簽章邏輯後務必跑 `npm run test`。

### Callback 端點

| 路徑 | 用途 |
|---|---|
| `POST /api/ecpay/payment/return` | **付款結果（權威來源）**。只有這裡能把訂單改成已付款 |
| `POST /api/ecpay/payment/info` | ATM／超商取號通知 |
| `POST /api/ecpay/payment/result` | 前台導回，只負責顯示結果頁，**不改狀態** |
| `POST /api/ecpay/logistics/reply` | 物流狀態回拋 |
| `POST /api/ecpay/logistics/map-reply` | 電子地圖選店結果 |

全部都會先落地成 `WebhookEvent` 再處理，`(provider, kind, externalId)` 唯一，
所以綠界重送不會重複扣庫存。處理失敗的可以在 **後台 → Webhook** 手動重送。

### 開發時模擬付款成功

信用卡的 `ReturnURL` 通知只有真的刷卡才會發出。要測試後續流程（實扣庫存、
建物流單、開收據、寄信）可以自己簽一份通知打進來：

```bash
npx tsx --env-file-if-exists=.env --conditions=react-server scripts/simulate-ecpay-callback.ts payment-return <orderNo>
```

---

## 目前已驗證與尚未驗證的部分

跑過真實的綠界測試站，實測結果：

| 項目 | 狀態 |
|---|---|
| AIO 送單、收銀台顯示正確金額與品項 | ✅ 綠界接受簽章 |
| ATM 取號 → `PaymentInfoURL` 回拋 | ✅ 真實回拋，驗簽通過，虛擬帳號寫入 |
| 付款成功 → 實扣庫存、訂單轉狀態 | ✅（用 `simulate-ecpay-callback.ts` 驗證） |
| Webhook 冪等（重送不重複扣庫存） | ✅ |
| 物流狀態回拋 → 更新貨態 | ✅ |
| 超商取貨選店（ExpressMap） | ✅ 綠界電子地圖回傳真實門市（7-11 建盛門市）並寫入 |
| 正式版 Docker 映像與 compose | ✅ 建置、migration、健康檢查、供頁皆正常 |
| Vitest 單元 185 項 + 整合 306 項（真實 Postgres） | ✅ 全數通過 |
| 後台商品維護（新增／圖片／規格／分類品牌） | ✅ 建立→上傳→上架→刪除全程實測 |
| 黑貓 `ParsingAddress`（地址換郵碼） | ✅ 測試站真實回應，憑證有效 |
| 超商 C2C 建單 | ⚠️ **未實測**（先前實測的是宅配 TCAT，已改走黑貓） |
| 黑貓建單 `PrintOBT` → 下載託運單 | ⚠️ **未實測** |
| 黑貓貨態輪詢 `OBTStatus` | ⚠️ **未實測** |
| 電子收據開立 | ⚠️ **未實測** |

**超商 C2C 建單**：物流商店代號從 B2C（`2000132`）換成 C2C（`2000933`），
`LogisticsType` 也修正為固定 `CVS`，需要重新對測試站跑一次建單。

**電子收據**：AES 加解密沿用原本電子發票那套（已有 golden test），但還沒對綠界
測試站實際送過電文。特別要驗的是折扣以負數單價呈現時會不會被退件 ——
官方文件只寫「單價可為 0」，沒有明說可為負。

**黑貓宅配**：已改為直接串接統一速達印單 API（規格書在 `docs/黑貓宅急便_…_v2.1.2/`）。
`ParsingAddress` 已對測試站實測通過，確認契客代號與授權碼有效、測試站也對我們開通
（`scripts/tcat-parse-address.ts` 可重跑）。寄件人資料已對齊契客專區的「印單資料設定」：
新北市中和區宜安路 171 號 → 黑貓郵碼 `40-693-52-C`，`TCAT_SENDER_ZIP=69352C`。

尚未實測的是 `PrintOBT` 建單 —— 它會產生一張**真實的託運單**，留給有人在旁邊確認時再跑。

要注意黑貓建單**沒有冪等鍵**：逾時而其實已成立的情況無法從回應分辨，
所以程式碼刻意不自動重試，任何失敗都轉人工到黑貓後台確認後回填單號。

**信用卡付款**：沒有實際在綠界收銀台輸入卡號完成刷卡。收銀台本身已確認會接受
我們送出的訂單（金額、品項、訂單編號都正確顯示），付款成功後的處理邏輯則是用
`scripts/simulate-ecpay-callback.ts` 送出簽章正確的通知來驗證。

---

## 常用指令

```bash
npm run dev          # 開發伺服器
npm run worker       # 背景工作（物流建單、開發票、寄信、釋放逾期庫存）
npm run test         # Vitest 單元測試（不碰資料庫，最快）
npm run test:integration  # 整合測試（需 docker compose 的 db，連 sagon_test 庫）
npm run test:all     # 單元 + 整合
npm run e2e          # Playwright 端到端測試（金流模擬需 .env 的綠界測試金鑰）
npm run typecheck    # tsc --noEmit
npm run build        # 正式版建置
npm run db:migrate   # 建立並套用 migration
npm run db:studio    # Prisma Studio
```

> `next build` 會把 `NODE_ENV` 設成 production，因此**存在 `.env.production` 時會優先讀它**。
> 本機 build 看到 `Can't reach database server at db:5432` 就是這個原因（`db` 是容器內的主機名）。
> 這不影響建置 —— `generateStaticParams` 連不到資料庫時會回空陣列，改由執行期產生頁面。

補跑失敗的背景工作：

```bash
npx tsx --env-file-if-exists=.env --conditions=react-server scripts/enqueue-job.ts create-shipment <orderId>
```

---

## 架構

```
src/
├─ app/
│  ├─ [locale]/          前台（next-intl，zh-TW 預設、/en 英文）
│  ├─ admin/             後台（獨立 root layout，不做多語系）
│  └─ api/ecpay/         綠界 callback
├─ lib/
│  ├─ ecpay/             checkmac / aio / logistics / receipt / webhook
│  ├─ orders/            pricing / stock / create / payment / logistics / receipt
│  ├─ auth/              Auth.js 設定、密碼、OTP
│  ├─ sms/               可插拔簡訊供應商（console / 三竹）
│  └─ cart/
├─ worker/               BullMQ 消費者
└─ components/
```

### 渲染方式

前台頁面是**逐次請求渲染**（`ƒ Dynamic`），不是建置時預先產生的靜態頁。

原因是 `[locale]/layout.tsx` 刻意沒有 `generateStaticParams`：每一頁都含有 header，
而 header 的分類導覽要查資料庫。容器建置階段沒有資料庫，若強行預渲染，
不是建置失敗，就是把「沒有分類」的 HTML 烤進去，之後才靠 ISR 慢慢修正 ——
第一批訪客會看到殘缺的導覽列。

代價是每次請求都會查資料庫。以這個規模（81 件商品、資料庫同機）成本很低，
而且內容永遠是最新的。跨頁重複的查詢（header 分類）已經用 `unstable_cache`
包起來，改動後用 `revalidateTag('nav-categories')` 失效。

要改成靜態產生的話：在 `[locale]/layout.tsx` 加回 `generateStaticParams`，
並確保**建置時連得到資料庫**（例如在 CI 用同一個網段的 DB，或改成建置後才組映像）。
各頁的 `revalidate` 已經設好，加回去就會生效。

### 幾個關鍵設計

**庫存預扣**。下單時用一句帶條件的 `UPDATE ... WHERE stock - reservedStock >= qty`
完成「檢查 + 佔用」，而不是先 SELECT 再 UPDATE —— 後者在兩個人搶最後一件時會超賣。
付款成功才把預扣轉成實扣；逾期未付款由 worker 每 5 分鐘釋放一次。

**訂單金額**。`calculatePricing()` 是不碰 DB 的純函式，購物車、結帳、後台共用同一份邏輯，
也才能用單元測試涵蓋各種折扣組合。最終金額一律以伺服器端重算為準，不信任前端試算。

**付款狀態的權威來源**只有 `ReturnURL`。前台導回的 `OrderResultURL` 是使用者的瀏覽器送來的，
可以偽造，只用來顯示畫面。

**三種登入方式**共用同一個 `User`：Google 與 Email 以 email 合併（Google 的 email 一定驗證過），
手機以 `phone` 唯一鍵合併。`/account/security` 可以綁定與解除，但會擋下「解除後就沒有任何
登入方式」的情況。

**匿名購物車**的識別碼由 `proxy.ts` 發放 —— Server Component 在 render 階段不能寫 cookie，
所以購物車頁只負責讀。登入時會把匿名車併進會員車。

---

## 正式環境

```bash
cp .env.example .env.production   # 填入正式值（此檔已列入 .gitignore）
docker compose -f docker-compose.prod.yml up -d --build
```

四個服務：`db`、`redis`、`web`、`worker`，外加一個一次性的 `migrate`。
`migrate` 跑完 `prisma migrate deploy` 就結束，`web` 與 `worker` 都設定成等它
**成功結束**後才啟動，所以程式跑起來時 schema 一定是最新的。

> Prisma CLI 有一整串傳遞相依，所以 migration 用有完整 `node_modules` 的
> `migrate` 階段來跑，`runner` 映像只留 Next.js standalone 的產物保持精簡。

### 商品圖片的儲存位置

後台上傳的圖片存在 `public/uploads/products/{商品id}/`。
`docker-compose.prod.yml` 已經把 `/app/public/uploads` 掛成 named volume（`uploads`），
所以重建容器不會掉圖 —— 但**這個 volume 一定要進備份範圍**，
它跟資料庫一樣是不可重生的資料。

要改成物件儲存（S3／Cloudflare R2）只需改 `src/lib/uploads.ts` 這一個模組，
其他地方都只認 `ProductImage.url` 這個字串。

上線前務必確認：

- [ ] `AUTH_SECRET` 換成 `openssl rand -base64 32` 產生的值
- [ ] `uploads` volume 與資料庫都納入自動備份
- [ ] `ECPAY_ENV=production`，並換上正式商店代號與金鑰
- [ ] `APP_URL` 是正式網域（HTTPS），綠界後台的白名單也要設定
- [ ] `SMS_PROVIDER=mitake` 並填入帳密（否則手機登入的驗證碼不會真的寄出）
- [ ] `SMTP_*` 換成正式寄信服務
- [ ] Google OAuth 的 redirect URI 加入 `https://<網域>/api/auth/callback/google`
- [ ] 商品素材換成自有內容（見最上方的著作權說明）
- [ ] 綠界物流狀態碼對照表（`src/lib/ecpay/logistics.ts` 的 `STATUS_CODES`）
      目前只收錄常見里程碑，請對照官方完整碼表補齊

---

## 技術選型

Next.js 16.3（App Router / RSC / Server Actions）、React 19、TypeScript strict、
Tailwind CSS v4、Prisma 6 + PostgreSQL 18、Auth.js v5、BullMQ + Redis 8、
next-intl、Zod、Vitest、Playwright。
