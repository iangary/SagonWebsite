# 三竹簡訊 API 發送權限＋IP 鎖定 申請信（草稿）

寄件對象：service@mitake.com.tw
狀態：**已寄出，並於 2026-08-22 獲三竹回覆 —— 三個問題都答了，API 權限與 IP 都已開通。
回覆內容與後續影響見 [`三竹/mitake-reply-api-provisioned.md`](三竹/mitake-reply-api-provisioned.md)。
以下保留原信內容供追溯，不需再寄。**

---

## 待填欄位

| 欄位 | 值 | 從哪來 |
|---|---|---|
| 三竹帳號 | `__________` | 註冊 sms.mitake.com.tw 時的帳號 |
| 發送主機對外 IP | `103.1.221.67`（**待實測確認**） | 見本檔最後一節 |
| 登入網頁介面的 IP | `__________` | 你平常開瀏覽器登入三竹後台那台電腦的對外 IP |
| 聯絡人姓名／手機 | `__________` | |

---

## 信件內容

**主旨：** 申請開通 API 發送權限與 IP 鎖定（帳號：__________ ／ 莎岡選品店）

```
三竹簡訊 客服團隊 您好：

我們是「莎岡選品店」（統一編號 93124857，網站 https://chenkuanyi.com.tw），
目前已註冊貴公司簡訊服務，帳號為 __________。

我們預計以「三竹格式 API（HTTP）」串接發送簡訊，依 B2C API 規格書 v2.14 第 4 頁
所載之前置條件，來信申請以下兩項：

一、開通 API 發送權限
    請協助為上述帳號開啟外部 HTTP 程式發送權限。
    （目前未開通，理解上會回傳 statuscode=p。）

二、IP 鎖定登記
    1. 程式發送主機 IP：__________
       （台灣機房固定 IP，Linux 主機，網站與 API 發送皆由此主機對外）
    2. 登入網頁介面主機 IP：__________
       （我們登入 sms.mitake.com.tw 後台所使用的對外 IP）

補充我們的使用情況，供貴司評估：

  用途        會員登入與註冊的一次性驗證碼（OTP），單筆、即時觸發
  簡訊內容    純中文＋6 位數字驗證碼，單則長度在 70 字以內
  預估量      初期每日約 __________ 則，尖峰不超過 __________ 則
  介接端點    https://smsapi.mitake.com.tw/api/mtk/SmSend
  字元編碼    UTF-8（以 CharsetURL=UTF-8 指定）
  TLS         Node.js 執行環境，預設使用 TLS 1.2 以上
  併發連線    OTP 為單筆發送，併發數遠低於規格所述 15 條上限

另有幾個問題想請教：

  1. 是否可提供測試帳號或測試點數，讓我們先在非正式環境驗證串接？
  2. 規格書提醒「網路異常後不可直接重送」，我們規劃以 clientid 讓貴司端去重、
     並以 SmQuery 查詢發送結果。請問這兩項功能是否需另外申請開通，
     或帳號開通 API 權限後即可使用？
  3. IP 若日後異動（例如更換主機），變更流程與所需工作天為何？

麻煩協助處理，謝謝！若需要補充任何文件或資料請隨時告知。

順頌 商祺

莎岡選品店
聯絡人：__________
電話：__________
Email：ian890711@gmail.com
```

---

## 「對外 IP」要怎麼看

三竹鎖的是**我們主機連出去時、對方看到的來源 IP**，不是網域的 A 紀錄、
也不是「別人連進來的 IP」。單網卡的 VPS 這兩個通常一樣，但**不保證**——
有些機房出去走另一組 NAT 位址，所以要實測。

### 1. 主機本身的對外 IP

```bash
ssh root@103.1.221.67 'curl -s https://api.ipify.org; echo'
```

### 2. 容器內的對外 IP（這個才是真正發簡訊的來源）

網站跑在 Docker 裡。容器出去會經過 host 的 NAT，理論上等於第 1 項，
但既然要拿去登記，就直接從發簡訊的那個 process 量：

先 ssh 進主機：

```bash
ssh root@103.1.221.67
```

再跑：

```bash
docker compose -f /srv/sagon/docker-compose.prod.yml exec -T web node -e 'fetch("https://api.ipify.org").then(r=>r.text()).then(console.log)'
```

**不要**寫成 `ssh host '... node -e "..."'` 的一行版 —— Windows PowerShell 傳參數給
`ssh.exe` 時會把 `\"` 還原成 `"`，遠端 bash 收到的命令就少了外層引號而語法錯誤。
真的要一行，改成把腳本從 stdin 餵進去，遠端命令裡就沒有雙引號可以被吃掉：

```bash
'fetch("https://api.ipify.org").then(r=>r.text()).then(console.log)' | ssh root@103.1.221.67 'docker compose -f /srv/sagon/docker-compose.prod.yml exec -T web node'
```

（容器 base image 是 `node:24-bookworm-slim`，沒有 `curl` 也沒有 `wget`，所以用 Node 內建的 `fetch`。）

其實 Docker 預設 bridge 網路會 MASQUERADE 成 host 的對外位址，
所以第 1 項若已經印出 `103.1.221.67`，這項幾乎必然一樣 ——
只有在第 1 項印出意料之外的值時，才真的需要跑這步確認。

兩個指令印出來的值要一樣，而且要等於 `103.1.221.67`。
**若不一樣，登記的是第 2 項印出來的那個**，不是 `103.1.221.67`。

### 3. 你自己電腦的對外 IP（登入三竹後台用）

規格書要求連「登入網頁介面的主機」也要登記。在你自己的 Windows 上：

```bash
curl -s https://api.ipify.org
```

PowerShell 也可以用 `Invoke-RestMethod https://api.ipify.org`。

注意：**家用／辦公室的浮動 IP 會變**。如果這台不是固定 IP，
建議在信裡跟三竹說明，問是否能改用網段登記，或是接受日後不定期申請異動。

### 4. 驗證有沒有鎖成功

三竹回覆開通後，發一則測試簡訊看 `statuscode`：

| 回傳 | 意思 | 處理 |
|---|---|---|
| `k` | 無效的連線位址 | IP 沒登記到，或登記的是錯的那一個 → 回頭做第 2 項 |
| `p` | 沒有權限使用外部 Http 程式 | API 發送權限還沒開通 |
| `0`/`1`/`2`/`4` | 已受理 | 成功，`src/lib/sms/mitake.ts` 即以此判定 |

狀態碼完整對照見 [docs/mitake-sms-integration.html](docs/mitake-sms-integration.html)。
