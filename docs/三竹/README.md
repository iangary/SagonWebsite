# 三竹簡訊（Mitake）

手機 OTP 登入用的簡訊供應商。這個資料夾放三竹給的原始文件與其 Markdown 轉錄。

| 檔案 | 內容 |
|---|---|
| [`B2C_MitakeAPI_v2.14.md`](B2C_MitakeAPI_v2.14.md) | 規格書 v2.14 全 18 頁轉錄（欄位、狀態碼、附錄） |
| [`B2C_MitakeAPI_Sample_v1.01.md`](B2C_MitakeAPI_Sample_v1.01.md) | 程式範例 v1.01 轉錄（Java／PHP／C#）＋本專案 TS 對應寫法。三竹明講**僅供參考、請勿直接套用** |
| [`mitake-reply-api-provisioned.md`](mitake-reply-api-provisioned.md) | 三竹的開通回覆：**正式端點、IP 登記狀態、300 點試用**（2026-08-22） |
| `*.pdf` | 三竹提供的原始檔，不要改 |

相關文件：

- [`../mitake-sms-integration.html`](../mitake-sms-integration.html) —— 研究筆記與**落差清單 G1～G8**，是實作的依據
- [`../mitake-api-application-email.md`](../mitake-api-application-email.md) —— 向三竹申請權限的信件（**已寄出並已獲回覆**）
- [`../../src/lib/sms/mitake.ts`](../../src/lib/sms/mitake.ts) —— 現行實作
- [`../../src/lib/auth/otp.ts`](../../src/lib/auth/otp.ts) —— 呼叫端

---

## 後續怎麼創建

目前狀態：程式的「形狀」是對的（POST form-urlencoded、`CharsetURL=UTF-8`、
`statuscode ∈ {0,1,2,4}` 視為受理），但**還沒有真的發過一則簡訊**——
`SMS_PROVIDER` 還是 `console`，而現有程式的端點網址是錯的。

順序是固定的：**先申請（人工、要等）→ 再改程式（不需等）→ 最後用餘額查詢驗證連線 → 才切換**。
第 1 步沒完成，第 3、4 步一定失敗，而且失敗訊息（`statuscode=p` / `k`）在本機完全測不出來。

### ~~第 1 步：向三竹申請~~ —— 已完成（2026-08-22）

三竹已回覆，細節在 [`mitake-reply-api-provisioned.md`](mitake-reply-api-provisioned.md)。結論：

- **API 發送權限已開通**，帳密與網頁登入相同（G1、G2 的外部依賴解除）
- **正式端點確定**：`https://smsb2c.mitake.com.tw/b2c/mtk` —— 是 B2C 站，路徑就是 `/b2c/mtk/`
- **IP `103.1.221.67` 已登記**（WEB 與 API 防火牆都登記了）
- **300 點免費試用**就是測試點數；**沒有測試環境／沙盒**
- `clientid` 與 `SmQuery` 隨 API 權限一併可用，不需另外申請
- 日後 IP 異動要**提前一個工作天**申請

兩件因此變得更要小心的事：

1. **沒有 stage，所有測試都打正式端點、扣真點數。** 所以第 3 步的餘額查詢驗證不能跳過。
2. **API 密碼就是網頁登入密碼。** 在三竹後台改密碼會直接讓正式站發不出簡訊（`statuscode=e`），
   而且毫無預警。改了就要同步更新 `docs/sagon-deploy/.env.production`、`scp` 上主機並重建 `web` 容器。

還沒問到、下次接洽要補的：中文簡訊單則字數上限、本帳號有沒有長簡訊權限
（沒有的話超長內容會被**靜默截斷後照樣送出**，驗證碼被切掉是無聲故障）。

### ~~第 2 步：改程式~~ —— 已完成（2026-08-22）

依 [落差清單](../mitake-sms-integration.html) 的 G1～G8，已實作的部分：

| 項目 | 做了什麼 |
|---|---|
| **G1** | 端點抽成 `MITAKE_ENDPOINT`（[`src/lib/env.ts`](../../src/lib/env.ts)），預設 `https://smsb2c.mitake.com.tw/b2c/mtk` |
| **G3** | 帶 `clientid`。每次 `requestOtp()` 產一個新 UUID 並傳進 provider —— 使用者主動重送必須換新的，否則三竹會回 `Duplicate=Y` 而不真的發第二則 |
| **G4** | `MitakeError` 帶 `statusCode` 與 `retryable`（可重試只有 `a`/`b`/`r`/`l`）；`requestOtp()` 回 `{ ok: false, reason: 'sms_failed' }`，route 回 **503** 而不是 500 |
| **G5** | `AccountPoint` 帶進 `SmsSendResult`，低於 100 點時 `console.warn` |
| **G6** | `msgid` 解析時剝掉 `#` 前綴 |
| **G8** | `formatSmsBody()` 把換行轉成 ASCII Code 6 |
| **G7** | **刻意未做。** callback 需要一支公開無認證的 endpoint，OTP 場景的收益撐不起那個攻擊面。等有訂單／出貨通知簡訊再評估 |

測試：[`src/lib/sms/mitake.test.ts`](../../src/lib/sms/mitake.test.ts)（38 條，含每個狀態碼的可重試分類）
＋ [`test/integration/auth-otp.test.ts`](../../test/integration/auth-otp.test.ts) 補了
clientid 唯一性、`sms_failed`、失敗不寫 DB 三條。

實作時發現研究文件的建議程式碼有一個 bug：`AccountPoint=`（空值）會被 `Number('')`
解成 `0`，誤判成點數歸零並誤觸低餘額警告。已在 `parseMitakeResponse()` 補上空字串判斷。

環境變數只多一個，`src/lib/env.ts` 原本已有 `SMS_PROVIDER` / `MITAKE_USERNAME` / `MITAKE_PASSWORD`：

```
MITAKE_ENDPOINT=https://smsb2c.mitake.com.tw/b2c/mtk
```

給了預設值（研究文件原本建議不給、缺了就報錯）—— 當時網域未知，現在值已確定，
寫成預設值就不必再多一個必填變數穿過 Dockerfile、CI 與測試環境。
帳密仍然沒有預設值，`MitakeSmsProvider` 缺帳密會直接拋錯。

> 正式站的 `.env.production` 正本在本機的 `docs/sagon-deploy/.env.production`，
> 改那份再 `scp` 上主機 —— 見 [CLAUDE.md](../../CLAUDE.md)。
> **這個變數有預設值，不填也能跑**，只有要換站台時才需要寫進去。

### 第 3 步：驗證連線（最便宜的一步）

**用不花點數的餘額查詢驗證 IP 與權限**，不要拿真的發送去試。
不帶 `msgid` 的 `SmQuery` 就是餘額查詢，這是驗證 IP 有沒有登記成功的最省方式。

三竹沒有測試環境，這 300 點就是正式點數 —— 更沒有理由拿發送去試錯。

在**正式站主機上**跑（本機跑沒有意義，IP 不一樣）：

```bash
ssh root@103.1.221.67 'curl -sS -X POST "https://smsb2c.mitake.com.tw/b2c/mtk/SmQuery" -d "username=<帳號>" -d "password=<密碼>"'
```

判讀：

| 回應 | 意思 |
|---|---|
| `AccountPoint=300` | 通了，IP 與權限都 OK（300 是免費試用點數），可以往第 4 步 |
| `statuscode=k` | IP 沒登記成功 —— 三竹說已設定完成，若出現這個就回頭找窗口確認 |
| `statuscode=p` | API 權限沒開 —— 同上，三竹說已開通 |
| `statuscode=e` | 帳密錯。注意 API 密碼就是網頁登入密碼，被改過就會這樣 |
| HTTP 404 | 網域或路徑錯，確認是 `smsb2c.mitake.com.tw` 且路徑為 `/b2c/mtk/` |

通了之後，才對自己的手機發一則真的簡訊，確認中文沒亂碼、驗證碼沒被截斷。

### 第 4 步：切換與觀察

1. 本機 `docs/sagon-deploy/.env.production` 設 `SMS_PROVIDER=mitake`、填 `MITAKE_USERNAME` 與 `MITAKE_PASSWORD`
2. `scp` 上主機，補 `chmod 600`，再 `docker compose -f docker-compose.prod.yml up -d --force-recreate web`
3. 用真手機走一次登入流程
4. 看 log 裡的 `AccountPoint` 有沒有正常遞減

`SMS_PROVIDER` 保留 `console` 這條路，出問題可以立刻切回去（但手機登入就等於停用）。

---

## 踩雷備忘

規格與範例文件裡最容易寫錯的幾點，集中放這裡：

- **預設編碼是 Big5**，不是 UTF-8。`SmSend` 靠 `CharsetURL`、`SmBulkSend` 靠 `Encoding_PostIn` 宣告，
  只設 `Content-Type` 的 charset 沒用
- **PDF 範例的 `smbody` 沒做 URL Encode，是錯的**，不要照抄（`URLSearchParams` 會自動處理）
- **逾時之後不可以直接重送**。規格書第 4 頁明寫：重送可能重複發送、不重送可能漏送。
  正解是帶 `clientid` 讓三竹端去重，或事後用 `SmQuery` 查
- `clientid` 必須**全域唯一**，不是 12 小時內唯一。PDF 範例用 `001`/`002` 會誤判成重複發送
- 三竹**回 HTTP 200 但 `statuscode` 是錯誤碼**是常態，不能只看 `res.ok`
- **沒有測試環境。** 300 點免費試用就是正式帳號的點數，測試發送會真的扣點、真的送到手機
- **API 密碼就是網頁登入密碼。** 在三竹後台改密碼會讓正式站直接發不出簡訊（`statuscode=e`）
- `SmQuery` 回覆的順序**與查詢順序無關**，要用 `msgid` 對回去
- callback 必須回 `text/plain` 與 `magicid=sms_gateway_rpack[LF]msgid=...[LF]`，回錯格式三竹會重試
- 併發連線上限 15 條，OTP 用不到，但日後做批次通知簡訊要留意
