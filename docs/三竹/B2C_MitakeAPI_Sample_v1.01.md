# 三竹資訊 API 程式範例文件 v1.01

> 本檔為 [`B2C_MitakeAPI_Sample_v1.01.pdf`](B2C_MitakeAPI_Sample_v1.01.pdf)（2020/03/24，8 頁）的 Markdown 轉錄。
> © Mitake Inc. All rights reserved.
>
> 這份 PDF 只有 Java／PHP／C# 三種語言的 `SmSend` 與 `SmBulkSend` 範例，沒有任何規格說明；
> 欄位定義請看 [`B2C_MitakeAPI_v2.14.md`](B2C_MitakeAPI_v2.14.md)。
> 本專案（TypeScript）的對應寫法見文末 [補充](#補充本專案的-typescript-對應寫法)，那一節不是 PDF 內容。

原文所有範例都以 `...` 開頭與結尾，代表只節錄核心片段（沒有 import／錯誤處理／回應解析）。

---

## 三份範例的共同結構

不管哪個語言，三竹的範例都是同一套流程：

1. 組 URL：`https://{三竹網域名稱}/b2c/mtk/SmSend` 或 `/b2c/mtk/SmBulkSend`
2. 編碼參數放 query string（`SmSend` 是 `CharsetURL`；`SmBulkSend` 是 `Encoding_PostIn`）
3. `POST`，`Content-Type: application/x-www-form-urlencoded`
4. body 以 **UTF-8 bytes** 寫入
   - `SmSend`：`username=...&password=...&dstaddr=...&smbody=...`
   - `SmBulkSend`：每列一筆、`$$` 分隔欄位、`\r\n` 換行
5. 讀回應（純文字，不是 JSON）

`SmSend` 把帳密放在 body，`SmBulkSend` 把帳密放在 query string —— 這個差異在三種語言的範例中都一致。

---

## Java

### SmSend Sample Code

```java
...
StringBuffer reqUrl = new StringBuffer();
reqUrl.append("https://{三竹網域名稱}/b2c/mtk/SmSend?CharsetURL=UTF-8");

StringBuffer params = new StringBuffer();
params.append("username=username");
params.append("&password=password");
params.append("&dstaddr=0900000000");
params.append("&smbody=簡訊SmSend測試");

URL url = new URL(reqUrl.toString());
HttpsURLConnection urlConnection = (HttpsURLConnection) url.openConnection();

urlConnection.setRequestMethod("POST");
urlConnection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
urlConnection.setDoOutput(true);
urlConnection.connect();

DataOutputStream dos = new DataOutputStream(urlConnection.getOutputStream());
dos.write(params.toString().getBytes("utf-8"));
dos.flush();
dos.close();
...
```

### SmBulkSend Sample Code

```java
...
StringBuffer reqUrl = new StringBuffer();
reqUrl.append("https://{三竹網域名稱}/b2c/mtk/SmBulkSend?");
reqUrl.append("username=username");
reqUrl.append("&password=password");
reqUrl.append("&Encoding_PostIn=UTF-8"");   // 原文如此，多了一個雙引號

StringBuffer body = new StringBuffer();
body.append("001$$0900000000$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試").append("\r\n");
body.append("002$$0900000001$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試").append("\r\n");

URL url = new URL(reqUrl.toString());
HttpsURLConnection urlConnection = (HttpsURLConnection) url.openConnection();

urlConnection.setRequestMethod("POST");
urlConnection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
urlConnection.setDoOutput(true);
urlConnection.connect();

DataOutputStream out = new DataOutputStream(urlConnection.getOutputStream());
out.write(body.toString().getBytes("UTF-8"));
out.flush();
out.close();
...
```

---

## PHP

### SmSend Sample Code

```php
...
$curl = curl_init();

// url
$url = 'https://{三竹網域名稱}/b2c/mtk/SmSend?';
$url .= 'CharsetURL=UTF-8';

// parameters
$data = 'username=username';
$data .= '&password=passowrd';   // 原文拼字如此（應為 password）
$data .= '&dstaddr=0900000000';
$data .= '&smbody=簡訊SmSend測試';

// 設定 curl 網址
curl_setopt($curl, CURLOPT_URL, $url);

// 設定 Header
curl_setopt($curl, CURLOPT_HTTPHEADER,
array("Content-type: application/x-www-form-urlencoded")
);
curl_setopt($curl, CURLOPT_POST, 1);
curl_setopt($curl, CURLOPT_POSTFIELDS, $data);
curl_setopt($curl, CURLOPT_HEADER, 0);

// 執行
$output = curl_exec($curl);
curl_close($curl);
echo $output;
...
```

### SmBulkSend Sample Code

```php
...
$curl = curl_init();

// url
$url = 'https://{三竹網域名稱}/b2c/mtk/SmBulkSend?';
$url .= 'username=username';
$url .= '&password=password';
$url .= '&Encoding_PostIn=UTF-8';

// body
$data = '001$$0900000000$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試'."\r\n";
$data .= '002$$0900000001$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試'."\r\n";

// 設定 curl 網址
curl_setopt($curl, CURLOPT_URL, $url);

// 設定 Header
curl_setopt($curl, CURLOPT_HTTPHEADER,
array("Content-type: application/x-www-form-urlencoded")
);
curl_setopt($curl, CURLOPT_POST, 1);
curl_setopt($curl, CURLOPT_POSTFIELDS, $data);
curl_setopt($curl, CURLOPT_HEADER, 0);

// 執行
$output = curl_exec($curl);
curl_close($curl);
echo $output;
...
```

---

## C#

### SmSend Sample Code

```csharp
...
StringBuilder reqUrl = new StringBuilder();
reqUrl.Append("https://{三竹網域名稱}/b2c/mtk/SmSend?CharsetURL=UTF-8");

StringBuilder params = new StringBuilder();
params.Append("username=username");
params.Append("&password=password");
params.Append("&dstaddr=0900000000");
params.Append("&smbody=簡訊SmSend測試");

HttpWebRequest request = (HttpWebRequest)WebRequest.Create(new Uri(reqUrl.ToString()));
request.Method = "POST";
request.ContentType = "application/x-www-form-urlencoded";

byte[] bs = Encoding.UTF8.GetBytes(params.ToString());
request.ContentLength = bs.Length;
request.GetRequestStream().Write(bs, 0, bs.Length);

HttpWebResponse response = (HttpWebResponse)request.GetResponse();
StreamReader sr = new StreamReader(response.GetResponseStream());
string result = sr.ReadToEnd();
...
```

### SmBulkSend Sample Code

```csharp
...
Uri uri = new Uri("https://{三竹網域名稱}/b2c/mtk/SmBulkSend?username=username&password=password&Encoding_PostIn=UTF-8");

StringBuilder body = new StringBuilder();
body.Append("001$$0900000000$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試").Append("\r\n");
body.Append("002$$0900000001$$20170101000000$$20170102000000$$$$$$簡訊SmBulkSend測試").Append("\r\n");

HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
request.Method = "POST";
request.ContentType = "application/x-www-form-urlencoded";

byte[] bs = System.Text.Encoding.UTF8.GetBytes(body.ToString());
request.ContentLength = bs.Length;
request.GetRequestStream().Write(bs, 0, bs.Length);

HttpWebResponse response = (HttpWebResponse)request.GetResponse();
StreamReader sr = new StreamReader(response.GetResponseStream());
string result = sr.ReadToEnd();
...
```

---

## 從範例讀出來的幾件事

規格書沒寫、但範例透露的細節：

| 觀察 | 意義 |
|---|---|
| `SmSend` 的 `CharsetURL` 在 query string，帳密在 body | 與規格書的欄位分類一致；`CharsetURL` 放 body 不保證有效 |
| `SmBulkSend` 的帳密與 `Encoding_PostIn` 全在 query string | 帳密會出現在 URL 裡，若有存取紀錄要注意不要留存 |
| 範例的 `smbody` 直接塞中文、沒有 URL Encode | **範例是錯的**，不要照抄。規格書明寫 `smbody` 與 `destname` 必須 URL Encode（否則內容裡的 `&` 會被當成參數分隔） |
| body 一律以 UTF-8 bytes 寫出，並用 `CharsetURL` / `Encoding_PostIn` 宣告 | 只設 `Content-Type` 的 charset 沒用，三竹是看這兩個參數決定怎麼解碼 |
| `SmBulkSend` 每筆用 `\r\n` 結尾（含最後一筆） | CRLF，不是 LF |
| 範例的 ClientID 用 `001`／`002` 這種流水號 | 規格書要求 clientid **全域唯一**、建議 GUID。範例的做法會在 12 小時內誤判成重複發送 |
| 三份範例都沒有解析回應、沒有判斷 statuscode | 錯誤處理完全要自己寫 —— 三竹回 HTTP 200 但 `statuscode=e` 是常態 |

---

## 補充：本專案的 TypeScript 對應寫法

> 以下不是 PDF 內容，是把上面三份範例翻成本專案的寫法，方便對照。
> 現行實作在 [`src/lib/sms/mitake.ts`](../../src/lib/sms/mitake.ts)。

`URLSearchParams` 會自動做 URL Encode，正好補掉範例最大的坑：

```ts
const params = new URLSearchParams({
  username, password,
  dstaddr: '0900000000',
  smbody: '簡訊SmSend測試',
  clientid: crypto.randomUUID(),   // 範例的 001/002 不能照抄
})

const res = await fetch(`${base}/b2c/mtk/SmSend?CharsetURL=UTF-8`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  body: params,                     // fetch 會自動送出 UTF-8 bytes
  signal: AbortSignal.timeout(15_000),
})
const body = await res.text()       // 純文字，不要 res.json()
```

`SmBulkSend` 的 body 不是 form-urlencoded、而是 `$$` 分隔的自訂格式，
所以 **不能** 用 `URLSearchParams`，要自己組字串並自行處理跳脫：

```ts
const rows = recipients.map(r =>
  [crypto.randomUUID(), r.phone, '', '', '', '', r.text].join('$$'),
)
const body = rows.join('\r\n') + '\r\n'
```

注意 `smbody` 裡若出現 `$$` 會破壞欄位切分，這點規格書與範例都沒有說明處理方式 ——
批次發送若要上線，需先向三竹確認跳脫規則。
