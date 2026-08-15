# 全站檢查報告（site review findings）

- 檢查日期：2026-08-15
- 範圍：前台全部頁面、後台全部頁面、金流/物流/收據串接程式、測試基礎設施
- 方法：三路程式碼探索 + 本機 dev 逐頁走查（desktop 1280×800 / mobile 375×812）+ 自動化 smoke（`test/e2e/smoke-quality.spec.ts`）
- 嚴重度：P0 = 會賠錢或擋出貨；P1 = 營運會踩到；P2 = 品質/維護性

## 本次已修復（修復內容見各檔案，行為由新測試釘住）

| ID | 嚴重度 | 問題 | 修復 |
|----|--------|------|------|
| F1 | P0 | ATM 繳費期限實際是 1 天（綠界下限），但庫存預扣/訂單取消排程只等 30 分鐘 —— 消費者隔天匯款會「錢收到了、訂單已取消」且無人知道（回拋被無聲吞掉回 1\|OK） | `aio.ts` 新增 `actualExpireMinutes()`；`create.ts` 預扣期依付款方式對齊；`payment.ts` 加安全網：取消後入帳 → payment 標 PAID + failReason「逾期入帳…需人工退款」，後台看得到 |
| F2 | P1 | 黑貓建單轉人工處理時，操作指示寫在 `Shipment.statusMsg` 但後台完全不顯示；且建單按鈕仍可按 → 可能重複開出第二張真實託運單 | 後台訂單頁顯示狀態訊息（PENDING 時紅字）；曾轉人工的單再按建單會先跳確認對話框 |
| F3 | P2 | `recordWebhook` 併發收到同一筆重送時 create 會撞唯一鍵直接 500 → 綠界又重送一輪 | 捕捉 P2002 改為重讀既有事件 |
| F4 | P1 | 電子地圖 ExtraData token 產生了但從未驗證 —— 任何同源分頁都能把門市資料塞進結帳頁 | 結帳頁開地圖時存一次性 token，map-reply 原樣帶回，token 不符即忽略 |
| F5 | P1 | `enqueue()` 吞掉 Redis 錯誤只印 log —— 付款成功後的建物流單/開收據/寄信可能無聲消失，訂單卡死沒人知道 | 失敗時落一筆 AuditLog（action=`enqueue-failed`）供人工補送；`scripts/enqueue-job.ts` 補上 `poll-tcat-status` |
| F6 | P2 | `setProductCategories` revalidate 到不存在的 `/admin/categories`（實際是 `/admin/taxonomy`） | 修正路徑 |
| F7 | P2 | repo 從第一天就沒有 eslint 設定檔，`npm run lint` 直接報錯 | 新增 `eslint.config.mjs`（eslint-config-next 16 flat config） |
| F8 | P1 | Windows 的 Hyper-V/WSL 動態保留埠（5150–5749）吃掉 5433，Postgres 容器綁不起來 —— 本機 dev 與測試都連不到資料庫 | docker compose 與 `.env` 改用 15433 |
| F9 | P0 | 全站客服信箱是開發用占位 `service@sagon.local`，客人寄信會石沉大海（原 W3）。四個頁面各自寫死，明明已有 `SHOP_SERVICE_EMAIL` 設定卻沒人讀 | 預設值改為真實信箱；頁尾／關於／聯絡／常見問題四處改讀 `env.SHOP_SERVICE_EMAIL`，單一來源 |
| F10 | P0 | 缺隱私權政策、服務條款、退換貨政策 —— 消保法七天鑑賞期為強制告知事項（原 R11） | 新增 `/privacy`、`/terms`、`/returns` 三頁，頁尾與 sitemap 收錄，FAQ 互連 |

## 未修（需排期或商業決策）

| ID | 嚴重度 | 頁面/模組 | 問題 | 建議 |
|----|--------|-----------|------|------|
| R1 | P1 | 黑貓託運單 | PDF 只在建單當下抓一次，`FileNo` 24 小時失效後無法補印（`downloadObt` 的重抓參數沒有被任何介面用到） | 後台加「重新下載託運單」動作（24h 內有效），並在標籤遺失時提示改走人工回填 |
| R2 | P1 | 商品編輯 | `descriptionHtml` 只能在建立時填，`updateProduct` schema 沒有這欄 —— 建立後就永遠改不了；且前台以未消毒的 HTML 渲染（僅管理員可寫入，風險受限但存在） | schema 補欄位 + 前台渲染前用 sanitize-html 白名單過濾 |
| R3 | P1 | 登入/訪客查單 | 密碼登入與訪客訂單查詢都沒有節流 —— 可暴力嘗試 | 以 IP+帳號維度加簡單節流（Redis INCR + TTL） |
| R4 | P1 | 部署 | Caddyfile 只設快取標頭，沒有任何安全標頭（HSTS、X-Content-Type-Options、frame-ancestors…） | Caddy 補 header 區塊 |
| R5 | P1 | 金流對帳 | `queryTradeInfo()` 與退款端點定義了但沒人呼叫：REFUNDED 只是記帳狀態，不會真的向綠界退款，也沒有定期對帳工作 | 排期做：退款 API 串接 + 每日 queryTradeInfo 對帳 cron |
| R6 | P2 | 黑貓 | `TW_HOLIDAYS` 只有國定三天（TODO 註記每年更新），農曆假日缺 —— 出貨日落在休息日會被黑貓以 E032 退件轉人工 | 每年初更新，或改接政府行事曆 API |
| R7 | P2 | 黑貓 | `Shipment.receiverPhone` 從未被寫入（只存手機），黑貓的市話欄恆空 —— 配送聯絡完全依賴手機欄 | 結帳可選填市話，或接受現狀並記錄 |
| R8 | P2 | CVS 標籤 | `goodsAmount` 用含運費的 `grandTotal` 申報（非代收時無實害，但標籤上的申報值偏高） | 改用 subtotal-discount，或接受現狀 |
| R9 | P2 | 商品編輯 | 已上架商品每次儲存（狀態仍為 ACTIVE）都會重寫 `publishedAt`，原始上架時間遺失 | 只在 DRAFT/ARCHIVED→ACTIVE 時設定 |
| R10 | P2 | 貨態輪詢 | `recordStatusHistory` 每次輪詢載入該出貨單全部歷程做去重，量大時無上限 | 以 (statusCode, occurredAt) 唯一索引改用 upsert |
| R11 | ~~P0~~ | 全站 | ~~缺隱私權政策、服務條款、退換貨政策頁~~ → 已於 2026-08-15 補齊（見 F10）。**但條文內容由開發方擬定，未經律師審閱**，正式營運前建議請法律顧問過目，特別是下列三處商業決定：① 七天鑑賞期退貨的退回運費依消保法由賣方負擔（現行條文即如此寫）；② 貼身衣物拆封不退的認定範圍；③ 管轄法院約定 | 送法律顧問審閱 |
| R12 | P2 | 前端 | 8 個元件踩到 React 19 的 `set-state-in-effect`（eslint 已降為警告）：toast、cart-count-provider、add-to-cart、checkout-form、image-manager、coupon-form、security-panel 等 | 逐一重構為事件回呼/衍生狀態 |
| R13 | P2 | 文件 | 測試數字三處漂移（README「147」、檢核表「85」、實際值隨本次大增） | 本次收尾一併更新 |

## 逐頁走查結果

前台以本機 dev 逐頁檢視 + `test/e2e/smoke-quality.spec.ts` 自動掃描（console 錯誤、
h1/main 結構、圖片 alt、i18n key）；後台互動流程由 `test/e2e/admin-*.spec.ts` 以真實
瀏覽器事件覆蓋（登入、訂單操作、商品維護）。

### 本次走查新發現（已修）

| ID | 嚴重度 | 頁面 | 問題 | 處置 |
|----|--------|------|------|------|
| W1 | P1 | /faq | 發票說明過時：寫「開立電子發票、可存載具或捐贈」，實際是紙本發票隨包裹寄出＋電子收據（結帳頁寫的才是對的），客人看到的資訊自相矛盾 | 已改寫 FAQ 該題 |
| W2 | P2 | /cart（空狀態） | 空購物車頁沒有 h1（有商品時才有），違反每頁一個 h1 | 已補 sr-only h1 |

### 本次走查新發現（未修，記錄待辦）

| ID | 嚴重度 | 頁面 | 問題 | 建議 |
|----|--------|------|------|------|
| W3 | ~~P0~~ | /faq、/contact、/about | ~~客服信箱是開發用占位網域~~ → 已於 2026-08-15 修復（見 F9）。剩餘提醒：寄件人位址 `MAIL_FROM` 仍是 `no-reply@sagon.local`，正式寄信需搭配可通過 SPF/DKIM 的網域 | 上線前設定寄件網域 |
| W4 | P1 | /en 全站 | 英文版只有 UI 標籤有翻譯：首頁 hero 標語、About 段落、公告列（全站消費滿…）、footer 文案、分類名稱全是中文；Category 明明有 `nameEn` 欄位但導覽沒有使用 | 決定英文版的定位：要嘛補齊翻譯（含 nameEn 串接），要嘛先下線 /en 避免半吊子體驗；已加 `test.fail` 標記的 E2E 追蹤（smoke-quality.spec.ts） |
| W5 | P2 | / 首頁 | 「精選商品」與「新品上架」內容完全相同 —— `getFeaturedProducts` 就是 publishedAt 排序，沒有精選旗標，兩區塊放一樣的 8 件商品 | 加 `isFeatured` 欄位或改為隨機/銷量排序，否則區塊二選一 |
| W6 | P2 | 整體 | 整合測試揭露：`releaseExpiredReservations` 與 `handlePaymentReturn` 併發時會互相死鎖（Postgres 40P01，鎖定順序相反：付款先鎖 payment→order→variant，釋放先鎖 variant→reservation→order）。資料不變量不會壞、綠界重送會自癒，但 worker 會有噪音錯誤 | 統一兩邊的鎖定順序（都先 update order row） |
| W7 | P2 | 金流 | 併發重複回拋時，交易內判贏家、但交易外的 enqueue 不分輸贏都會執行 —— 極端情況 create-shipment/issue-receipt 會排兩次（兩者皆有冪等防護，實害為零，記錄現狀） | enqueue 移進「贏家」分支 |
| W8 | P2 | 後台商品頁 | React 警告「Encountered two children with the same key ''」—— 某清單元件用了空字串當 key（E2E 跑後台商品編輯流程時穩定出現於 dev console） | 找出該清單改用穩定 id 當 key |

### 走查通過項

- 首頁／商品列表／商品頁／購物車／結帳／登入註冊／FAQ／關於／聯絡／訂單查詢／404：console 零錯誤（smoke 自動掃描）
- 訪客訂單查詢：雙因素（訂單編號＋聯絡方式）強制、查無訂單有明確錯誤訊息、訂單編號不可枚舉
- 每頁一個 main／一個 h1、商品圖皆有 alt（修 W2 後）
- 草稿商品前台搜尋不到、sitemap 不收錄；上架後即出現（E2E 驗證）
- 結帳表單逐欄驗證訊息正常（郵遞區號、統編、手機格式）
- 後台登入權限：未登入導 /login、非管理員擋在外（E2E 驗證）
