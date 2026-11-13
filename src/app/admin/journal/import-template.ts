/** 「下載範本」給的 HTML。每一個可以寫的欄位都示範一次，刪掉不需要的就好。 */
export const IMPORT_TEMPLATE = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">

  <!-- 文章標題（必填）。沒有 <title> 的話用內文第一個 <h1> -->
  <title>秋冬睡衣穿搭指南</title>

  <!-- 以下全部選填。覆蓋既有文章時，沒寫的欄位會保留原本的值 -->

  <!-- 摘要：文章列表與分享預覽用；留白會自動取內文開頭 -->
  <meta name="description" content="天氣轉涼，三個重點挑對秋冬睡衣。">

  <!-- 標籤：逗號或頓號分隔 -->
  <meta name="keywords" content="穿搭、秋冬、睡衣">

  <!-- 網址代稱：文章網址是 /journal/這裡的值；不寫就用標題 -->
  <meta name="slug" content="autumn-pajama-guide">

  <!-- 狀態：published = 發布、draft = 草稿（不寫就是草稿） -->
  <meta name="status" content="draft">

  <!-- 發布時間（台北時間）。填未來的時間就是排程發布 -->
  <meta name="date" content="2026-11-20 20:00">

  <!-- 封面圖：網址或 base64 都可以。不寫的話，內文最前面的那張圖會變成封面 -->
  <meta property="og:image" content="https://example.com/cover.jpg">

  <!-- 搜尋引擎用的標題與描述（不寫就用標題與摘要） -->
  <meta name="seo-title" content="秋冬睡衣怎麼挑｜莎岡選品店">
  <meta name="seo-description" content="從材質、版型到保暖度，一次看懂秋冬睡衣怎麼挑。">
</head>
<body>
  <!-- 第一個 h1 就是標題，匯入時會拿掉（頁面上已經有標題） -->
  <h1>秋冬睡衣穿搭指南</h1>

  <p>天氣轉涼，換上<strong>柔軟的睡衣</strong>就是秋天最療癒的儀式。</p>

  <h2>挑選材質</h2>
  <p>羊羔絨保暖、棉質透氣……</p>

  <!--
    圖片不用另外上傳，匯入時會自動存到網站上：
      - 網址：<img src="https://…/photo.jpg">（伺服器會下載一份）
      - 內嵌：<img src="data:image/jpeg;base64,…">
    「images/photo.jpg」這種電腦上的檔案路徑伺服器拿不到，會被移除。
  -->
  <figure>
    <img src="https://example.com/photo.jpg" alt="羊羔絨睡衣">
    <figcaption>羊羔絨套裝，冬天也不怕冷</figcaption>
  </figure>

  <!-- 商品卡片：填商品的網址代稱（商品頁網址 /product/ 後面那段） -->
  <div data-product="商品網址代稱"></div>

  <!--
    譯文（選填）：一個語系一個 <article lang="…">，支援 en / ja / ko / fr。
    裡面第一個 h1 是譯文標題，data-excerpt 是譯文摘要。沒有譯文的語系會顯示中文。
  -->
  <article lang="en" data-excerpt="Three tips for choosing autumn pajamas.">
    <h1>Autumn Pajama Styling Guide</h1>
    <p>As the weather cools, slipping into soft pajamas is the coziest ritual.</p>
    <div data-product="商品網址代稱"></div>
  </article>
</body>
</html>
`
