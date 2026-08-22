# 正式站部署（遠振 TW-VPS-S）

主機規格：Ubuntu 24.04 LTS / 2 Core / 4GB RAM / 50GB Disk / 4000GB 流量
主機 IP：`103.1.221.67`　·　VNC 主控台：`103.1.221.4:5977`（頻外管理，SSH 進不去時才用）

> **這台沒有主機層備份**（方案 Backup 欄位為「否」）。資料庫在 Docker volume 裡，
> 機器掛了就沒了。第 8 節的備份不是選配。

架構：CI 建 image → GHCR → 主機 pull。**不在主機上 build** —— `next build` 尖峰要 3–4GB，這台 4GB 撐不住。

---

## 1. 網域與 DNS

正式網域：`chenkuanyi.com.tw`

> **`.com.tw` 屬於 TWNIC 的屬性型網域，註冊需要公司或商業登記證明（統一編號）。**
> 個人身分只能註冊 `.tw` 或 `.idv.tw`。若手上沒有登記證明，請改用 `.tw`
> 並同步修改 `Caddyfile`、`.env`、`.env.production` 與綠界後台的回調網址。

需要兩筆 A 記錄，都指向 `103.1.221.67`：

| 主機名稱 | 類型 | 值 |
|---|---|---|
| `@`（或 `chenkuanyi.com.tw`） | A | `103.1.221.67` |
| `www` | A | `103.1.221.67` |

確認生效（兩筆都要有回應才往下走）：

```bash
dig +short chenkuanyi.com.tw
dig +short www.chenkuanyi.com.tw
```

Caddy 申請憑證走 ACME HTTP-01 挑戰，**DNS 沒生效就簽不到憑證**，這一步要先做完。

若暫時不打算開 `www`，請把 `Caddyfile` 最上面的 `www.{$SITE_DOMAIN}` 那段註解掉，
否則 Caddy 會反覆嘗試簽發失敗並洗版 log。

若要掛 Cloudflare，第一次簽憑證時請先關閉橘色雲（DNS only），簽發成功後再打開。

## 2. SSH 金鑰登入

> **本文件全程以 root 操作**，所以指令都沒有 `sudo`，也不另建管理帳號。
> 代價是少了 `sudo` 那層緩衝 —— 執行 `rm -rf` 之前多看一眼路徑。

在**你自己的電腦**上產生金鑰並上傳：

```bash
ssh-keygen -t ed25519 -C "sagon-deploy"
ssh-copy-id root@103.1.221.67
```

確認金鑰能登入之後，關掉密碼登入。編輯 `/etc/ssh/sshd_config`：

```
PermitRootLogin prohibit-password
PasswordAuthentication no
```

`prohibit-password` 的意思是「root 可以用金鑰登入，但不能用密碼」。
**不要寫成 `PermitRootLogin no`** —— 這台沒有別的帳號，那樣寫等於封掉唯一的入口。

```bash
systemctl restart ssh
```

> 先開一個新終端機確認金鑰登得進去，再改 `sshd_config`。順序反了會把自己鎖在門外
> （還好有 VNC 可以救，但別依賴它）。

## 3. 防火牆

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

> **注意 Docker 與 UFW 的交互作用**：Docker 發佈連接埠時會把 iptables 規則寫進
> `DOCKER-USER` 鏈，順序在 ufw 之前，所以 `ports: '0.0.0.0:3000:3000'` 這種寫法
> **ufw 擋不住**。這也是為什麼 compose 裡 web 綁的是 `127.0.0.1:3000:3000`，
> 對外只有 Caddy 發佈 80/443。

## 4. Swap

4GB 沒有 swap，尖峰時 OOM killer 會直接殺掉某個容器（通常是吃最多的 PostgreSQL）。

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 資料庫機器不該積極換出，降低 swappiness
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl --system
```

## 5. 安裝 Docker

用官方套件庫，不要用 Ubuntu 內建的舊版：

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

root 本來就在 docker 群組的權限範圍內，不需要 `usermod -aG docker`。

限制 log 大小，否則 JSON log 會慢慢吃掉 50GB：

```bash
tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
```

## 6. 目錄與環境檔

伺服器上**不需要原始碼** —— `src/` 那些已經被 CI 打進 image 了。這個目錄最後只有四個檔案：
兩個從 repo 複製過來的設定檔，兩個環境變數檔（含密碼，不進 git —— 正本在本機的 `docs/sagon-deploy/`）。

### 6.1 建目錄

```bash
mkdir -p /srv/sagon
```

`/srv/sagon` 是絕對路徑，跟你在哪個目錄下執行無關。

### 6.2 把兩個設定檔傳上來

在**你自己的電腦**上，於 repo 根目錄執行：

```bash
scp docker-compose.prod.yml Caddyfile scripts/smoke.sh scripts/backup.sh root@103.1.221.67:/srv/sagon/
```

`smoke.sh` 是部署後的驗證腳本（§7.5），`backup.sh` 是備份（§8）—— 主機上沒有原始碼，
這兩支要跟設定檔一起傳。repo 裡改過它們之後記得重傳。

> 不建議用 `git clone`：會把整份原始碼與歷史搬上主機（用不到），而且私有 repo
> 得在主機上放金鑰或 token，多開一個沒必要的權限缺口。

環境變數檔沒有範本可抄（範本會跟程式脫節，反而誤導）。必填清單以
[src/lib/env.ts](../src/lib/env.ts) 為準 —— 那是容器啟動時真正做驗證的地方。
用這行把當下的必填欄位列出來，當作 6.4 的檢查表：

```bash
node -e 'const s=require("fs").readFileSync("src/lib/env.ts","utf8"),b=s.slice(s.indexOf("z.object("),s.indexOf("function load"));for(const m of b.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*(.*)$/gm))if(!/\.default\(|\.optional\(|intFromString\(/.test(m[2]))console.log(m[1])'
```

`scripts/check-drift.sh` 用的是同一份推導，所以文件不會跟程式脫節。

### 6.3 建 `/srv/sagon/.env`

這個檔給 **compose 本身**做 `${VAR}` 替換。`env_file:` 指定的檔案不會被拿來做替換，
這是最常踩的坑 —— 少了這個檔，`docker compose` 會直接噴 `required` 而不是啟動。

先產生資料庫密碼並存進 shell 變數，等下兩個檔都要用到同一組：

```bash
PGPASS=$(openssl rand -hex 24)
```

> 用 `-hex` 而不是 `-base64`：base64 會產生 `+` `/` `=`，這些字元在
> `DATABASE_URL` 這種 URL 裡有特殊意義，不做百分號編碼的話連線會失敗，
> 而且錯誤訊息完全看不出是密碼的問題。hex 只有 0-9a-f，貼到哪裡都安全。

接著寫檔（`EOF` 不加引號，`$PGPASS` 才會被展開成實際密碼）：

```bash
cat > /srv/sagon/.env <<EOF
IMAGE_PREFIX=ghcr.io/iangary/sagonwebsite
IMAGE_TAG=latest
SITE_DOMAIN=chenkuanyi.com.tw
POSTGRES_USER=sagon
POSTGRES_PASSWORD=$PGPASS
POSTGRES_DB=sagon
EOF
```

把密碼印出來，6.4 要貼進 `DATABASE_URL`：

```bash
echo "$PGPASS"
```

這個檔是在主機上生出來的（密碼要在主機產），**但正本歸本機**。
建完立刻拉回來，之後就只改本機那份：

```bash
scp root@103.1.221.67:/srv/sagon/.env docs/sagon-deploy/.env
```

### 6.4 填 `/srv/sagon/.env.production`

這個檔給**容器內的應用程式**。**正本在本機的 `docs/sagon-deploy/.env.production`**，
在自己電腦上編輯，填完再 `scp` 上去 —— 不要 SSH 進主機用 nano 改，那樣下次上傳就被蓋掉。
照 6.2 列出的必填清單逐項填：

```bash
nano docs/sagon-deploy/.env.production
```

填完上傳並套用（`chmod` 與 `--force-recreate` 都不能省，理由見
[docs/sagon-deploy/README.md](sagon-deploy/README.md)）：

```bash
scp docs/sagon-deploy/.env.production root@103.1.221.67:/srv/sagon/ && ssh root@103.1.221.67 'cd /srv/sagon && chmod 600 .env.production && docker compose -f docker-compose.prod.yml up -d --force-recreate web'
```

先產生 Auth.js 的簽章金鑰（開另一個終端機或先跑再編輯）：

```bash
openssl rand -base64 32
```

重點欄位：

| 變數 | 正式站要設成 |
|---|---|
| `DATABASE_URL` | `postgresql://sagon:<6.3 印出的密碼>@db:5432/sagon?schema=public` |
| `AUTH_SECRET` | 上面 `openssl rand -base64 32` 的輸出 |
| `SEED_ADMIN_EMAIL` | 你的信箱（會用它建第一個管理員帳號）|
| `SEED_ADMIN_PASSWORD` | 自己想一組，至少 6 碼；登入後立刻從後台改掉 |
| `SHOP_SERVICE_EMAIL` | 收得到信的真信箱 —— 通知信頁尾會印出來，客戶會直接回信到這裡 |
| `SHOP_TAX_ID` | 公司統一編號 |
| `ECPAY_*` | 綠界後台核發的**正式**商店代號與金鑰（三組：金流／物流／電子收據）|
| `ECPAY_SENDER_*` | 寄件人資訊，要和綠界後台登記的一致 |
| `TCAT_CUSTOMER_ID` | 黑貓契客代號 |
| `TCAT_CUSTOMER_TOKEN` | 黑貓印單 API 授權碼，在[契客專區](https://www.takkyubin.com.tw/YMTContract/aspx/Login.aspx)選「正式站台」申請，會用簡訊發送 |
| `TCAT_SENDER_ZIP` | ⚠️ 見下 |
| `MITAKE_*` | 三竹簡訊的帳號密碼（OTP 用）|
| `SMTP_PASS` | 寄信服務的 API key（見下）|

**`TCAT_SENDER_ZIP` 不是郵遞區號**，是黑貓自己的六碼郵碼，一定要查出來：

```bash
npx tsx --env-file-if-exists=.env scripts/tcat-parse-address.ts "正式的出貨地址"
```

把輸出的 `TCAT_SENDER_ZIP=...` 整行貼進 `.env.production`。填錯或沿用測試站的值，
宅配建單會被 E057「寄件人地址查到的郵號和寄件人郵碼不相同」退件。
**改寄件地址時要重查一次。**

主機名稱用 compose 的服務名 `db` / `redis`，**不是 `localhost`** —— 容器之間走的是
compose 建的內部網路，`localhost` 會指到容器自己。

**哪些 placeholder 會讓容器起不來，哪些不會**（[src/lib/env.ts](../src/lib/env.ts) 啟動時強驗證）：

- **會直接 throw**：`AUTH_SECRET`（要 ≥16 字元，`__CHANGE_ME__` 只有 13）、
  `SEED_ADMIN_EMAIL` 與 `SHOP_SERVICE_EMAIL`（要通得過 email 格式）。
- **會直接 throw**：`TCAT_SENDER_ZIP` 必須剛好 6 個字元，`__CHANGE_ME__` 過不了。
- **不會 throw 但會壞在執行時**：所有 `ECPAY_*`、`TCAT_*` 與 `MITAKE_*` 只檢查
  「有沒有填」，不檢查「填得對不對」。留著 `__CHANGE_ME__` 的話網站照常啟動，
  但客人一結帳就失敗。
  綠界正式帳號還沒下來的話，先把 `ECPAY_ENV` 設成 `stage` 並填測試金鑰，
  等正式金鑰到手再改 —— **不要讓正式站掛著 `production` + 假金鑰**。
  黑貓同理（`TCAT_ENV`），但注意黑貓測試站與正式站的授權碼**是分開申請的兩組**。

改完確認沒有漏掉的（沒有輸出才算過）：

```bash
grep -n __CHANGE_ME__ /srv/sagon/.env.production
```

### 6.5 收權限並檢查

兩個檔都有密碼，不要讓其他人讀到：

```bash
chmod 600 /srv/sagon/.env /srv/sagon/.env.production
```

最後確認四個檔案都在（`.env` 開頭是點，要 `-a` 才列得出來）：

```bash
ls -la /srv/sagon/
```

應該有 `docker-compose.prod.yml`、`Caddyfile`、`.env`、`.env.production`，
後兩個的權限是 `-rw-------`。

**SMTP**：機房幾乎都封鎖 25 埠，`nodemailer` 不能直接對外送信。用 Resend（免費 3,000 封/月）或 Amazon SES：

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<API key>
MAIL_FROM="莎岡選品店 <no-reply@mail.chenkuanyi.com.tw>"
```

寄件位址用子網域 `mail.` 是刻意的：日後若做 EDM，行銷信被檢舉不會拖累訂單信的網域信譽。

DNS 要有三筆記錄才寄得進 Gmail／Yahoo —— Resend 會給 SPF 與 DKIM，**DMARC 要自己加**
（`_dmarc.mail.chenkuanyi.com.tw`，先 `p=none` 觀察兩週再收緊到 `quarantine`）。三者缺一就進垃圾桶。

⚠️ Resend 免費方案是 **100 封/日的硬上限**，不是超額計費。以每張訂單約 2.5 封計，
日訂單超過 ~35 張就會撞頂；撞頂後 `send-email` job 會不斷重試並累積到死信佇列，
而**訂單流程本身不會報錯**（金流／收據／物流都是獨立 job）。上線後要盯著這個數字，
量起來就升級方案或換一家沒有日上限的服務。

## 7. 首次部署（手動）

主機端只 `pull` 不 `build`。**不要在這台跑 `docker compose build`** ——
`next build` 尖峰要 3–4GB，這台總共 4GB 還要同時養 db／redis，會被 OOM killer 砍掉，
而且失敗訊息通常只是 `exit code 137`，看不出是記憶體問題。

所以 image 一定要在別的地方 build 好，推到 GHCR，主機再拉下來。兩種做法選一種：

### 7.1（選項 A，目前採用）讓 GitHub Actions 只負責 build

推上 `main` 後 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)
會建好三個 image（web / worker / migrate）推到 GHCR，然後就結束 ——
**它不會碰你的主機**，自動 SSH 部署那個 job 已經移除了。

**這個 workflow 不需要設定任何 secret**：它用的 `GITHUB_TOKEN` 是 Actions 自動提供的。
`SSH_HOST` / `SSH_USER` / `SSH_KEY` / `GHCR_USER` / `GHCR_TOKEN` 這些 repo secret
一個都不用建。

好處是編譯在 GitHub 的機器上跑，不吃你的頻寬也不佔你電腦。
Actions 跑完會在最後一步印出主機端要執行的指令，以及可以用來回退的 commit SHA tag。

### 7.2（選項 B）完全不用 GitHub Actions

在**你自己的電腦**上 build 並推上 GHCR（需要 Docker Desktop 開著）：

```bash
echo "<PAT>" | docker login ghcr.io -u iangary --password-stdin
docker build -t ghcr.io/iangary/sagonwebsite-web:latest     --target runner  .
docker build -t ghcr.io/iangary/sagonwebsite-worker:latest  --target worker  .
docker build -t ghcr.io/iangary/sagonwebsite-migrate:latest --target migrate .
docker push ghcr.io/iangary/sagonwebsite-web:latest
docker push ghcr.io/iangary/sagonwebsite-worker:latest
docker push ghcr.io/iangary/sagonwebsite-migrate:latest
```

這裡的 PAT 需要 `write:packages`（比主機用的那把權限大，別混用）。
三個 image 是同一份 [Dockerfile](../Dockerfile) 的不同 stage，`--target` 決定建哪一個。

### 7.3 主機登入 GHCR

image 是私有的，沒登入 `pull` 會拿到 `denied`。在 GitHub 產一個 PAT，
**只勾 `read:packages`**（主機只需要讀，別放有寫入權的）：

```bash
echo "<PAT>" | docker login ghcr.io -u iangary --password-stdin
```

登入資訊會存到 `/root/.docker/config.json`，只要做一次，之後 `pull` 都不用再登入。

### 7.4 拉起來

```bash
cd /srv/sagon
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

啟動有依賴順序，不是同時亮的，整段大約一兩分鐘：

1. `db` 與 `redis` 先起來，等健康檢查通過
2. `migrate` 跑 `prisma migrate deploy`，跑完就結束
   —— **它顯示 `Exited (0)` 是正常的，不是掛掉**
3. `web` 與 `worker` 啟動（web 的健康檢查有 40 秒寬限期）
4. `web` 健康之後 `caddy` 才啟動，然後才開始向 Let's Encrypt 要憑證

### 7.5 驗證

**只 curl 首頁不算驗證。** 首頁是少數不走 ISR 的頁面 —— 2026-08 有一次
`/category/*` 與 `/product/[slug]` 全部 500，首頁照樣 200，整整一週沒被發現。

跑煙霧測試，它會把每一類路由都打一次，包含「找不到的資源要回 404 而不是 500」：

```bash
cd /srv/sagon && bash smoke.sh
```

非零結束就是部署失敗，先看 log 再說：

```bash
docker compose -f docker-compose.prod.yml logs --tail=60 web
```

確認 migration 真的套用了（`Exited (0)` 只代表容器結束，不代表 schema 是最新的）：

```bash
docker compose -f docker-compose.prod.yml run --rm migrate npx prisma migrate status
```

worker 有沒有起來：

```bash
docker compose -f docker-compose.prod.yml logs --tail=20 worker   # 應看到「已就緒，concurrency=4」
```

憑證沒簽出來就看 caddy 的日誌：

```bash
docker compose -f docker-compose.prod.yml logs caddy
```

### 7.6 之後要更新版本

固定五步，不要跳：

**1. 推上 `main`，等 Actions 三個 job 全綠。** tag 是 `latest`，太早 pull 會拿到舊版，
而且因為 tag 名稱沒變，`up -d` 會判定「沒變化」而什麼都不做 —— 看起來像部署成功了。

**2. 檢查主機設定檔有沒有漂移**（本機執行，只讀不寫）：

```bash
bash scripts/check-drift.sh
```

repo 改過 `Caddyfile` / `docker-compose.prod.yml`，或 `src/lib/env.ts`
新增了必填變數時，這步會擋下來。`docker-compose.prod.yml` 就曾經在主機上停留舊版
一週而沒人發現。有漂移就先 `scp` 更新再往下走。

**3. 拉新版並重啟**：

```bash
cd /srv/sagon && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

**4. 驗證**（見 §7.5，非零結束就是失敗）：

```bash
cd /srv/sagon && bash smoke.sh
```

**5. 清掉舊 image**：

```bash
docker image prune -af --filter "until=168h"
```

最後這步是必要的，不是選配 —— 舊 image 會累積，50GB 的磁碟撐不了幾十次部署。

> **上架商品圖之後要重啟 web。** Next.js 只在伺服器啟動時掃描一次 `public/`
> （見 `node_modules/next/dist/server/lib/router-utils/filesystem.js` 的
> `publicFolderItems`），執行期新增的檔案一律 404。後台上傳完圖片要跑
> `docker compose -f docker-compose.prod.yml restart web`，`smoke.sh` 的商品圖那條會抓到漏掉的情況。

`.env` 裡的 `IMAGE_TAG=latest` 表示每次都拉最新。想要能明確回退的話，
把 tag 改成 commit SHA（CI 會同時推 `latest` 和 `<sha>` 兩個 tag），
出事就把 `IMAGE_TAG` 改回上一個 SHA 再 `up -d`。

### 7.7 上線前檢查清單

站跑起來 ≠ 可以開賣。下面每一項都是「不做就會在真實訂單上出事」的，
按風險排序 —— 前三項在接第一筆真實訂單**之前**必須完成。

| # | 項目 | 不做的後果 | 章節 |
|---|---|---|---|
| 1 | 設定備份並做一次還原演練 | 這台沒有主機層備份，volume 掛了訂單全沒 | §8 |
| 2 | 建立 swap | 4GB 無 swap，尖峰時 OOM killer 會砍掉 PostgreSQL | §4 |
| 3 | 綠界後台的 callback 網址指向正式網域 | 客人付了錢但訂單停在未付款，且不會有錯誤訊息 | — |
| 4 | `ECPAY_*` / `TCAT_*` 換成正式金鑰，`ECPAY_ENV=production` | 金流走測試站，等於沒收到錢 | §6.4 |
| 5 | 填 `SMTP_PASS` 並設定 SPF / DKIM / DMARC | 訂單通知信寄不出去或進垃圾桶 | §6 |
| 6 | 填 `SHOP_TAX_ID` | 電子收據上的統編是錯的 | §6.4 |
| 7 | `SMS_PROVIDER=mitake` 並填三竹帳密 | 手機 OTP 發不出去，新會員卡在驗證 | §6.4 |
| 8 | 停用 seed 建立的 demo 優惠券、刪掉測試會員 | `WELCOME100` 之類的代碼客人猜得到就能用 | §7.8 |
| 9 | 換掉爬蟲來的商品素材 | 他人著作權，不得對外營運 | README |
| 10 | 設定監控 | 站掛了要等客人告訴你 | §9 |

### 7.8 清掉 seed 的測試資料

`prisma/seed.ts` 除了管理員之外還會建三張**立即可用**的優惠券和一個測試會員，
而那個測試會員的密碼跟管理員是同一組。跑過 seed 就要清：

```bash
docker compose -f docker-compose.prod.yml exec db psql -U sagon -d sagon -c "update coupons set \"isActive\"=false where code in ('WELCOME100','SPRING10','FREESHIP');"
```

```bash
docker compose -f docker-compose.prod.yml exec db psql -U sagon -d sagon -c "delete from users where email='customer@sagon.local';"
```

優惠券用停用而不是刪除 —— 保留紀錄，日後想用再開。

## 8. 備份（必做）

```bash
install -m 755 scripts/backup.sh /usr/local/bin/sagon-backup
```

> 備份涵蓋資料庫與 `uploads`（商品圖片）。**不含** `labels`（黑貓託運單 PDF）——
> 託運單貼上包裹之後就沒有保存價值，而黑貓的下載連結只有 24 小時，
> 過期本來就補印不回來。真的需要重印又逾期的話只能重新建單（會拿到新單號）。
> 但 `labels` volume 本身**一定要掛**，且 web 與 worker 要掛同一個 —— 見
> `docker-compose.prod.yml`，少掛的話 worker 寫的 PDF 後台永遠讀不到。

設定 rclone 指向異地（Cloudflare R2 免費 10GB 夠用）：

```bash
apt install -y rclone
rclone config          # 建一個 remote，例如 r2
echo 'RCLONE_REMOTE=r2:sagon-backups' >> /etc/environment
```

> `rclone config` 存到 `/root/.config/rclone/rclone.conf`。因為備份也是用 root 跑的
> crontab，兩邊一致沒問題 —— 但別在其他帳號下設定 rclone，那樣 cron 讀不到。

排程每天凌晨 4:15（root 的 crontab）：

```bash
crontab -e
# 15 4 * * * RCLONE_REMOTE=r2:sagon-backups /usr/local/bin/sagon-backup >> /var/log/sagon-backup.log 2>&1
```

**上線前做一次還原演練。** 沒還原過的備份不算備份 —— 指令在 `scripts/backup.sh` 開頭的註解裡。

## 9. 日常維護

```bash
# 每週清 Docker 殘留（50GB 磁碟撐不了幾十次部署）
crontab -e
# 30 5 * * 0 docker system prune -af --filter "until=168h" >> /var/log/docker-prune.log 2>&1
```

監控：UptimeRobot 免費版監看 `https://chenkuanyi.com.tw/api/health`，5 分鐘一次。

看資源用量：

```bash
docker stats --no-stream
free -h
df -h
```

記憶體長期高於 3.2GB 或 CPU 持續 80% 以上，就該升級到 TW-VPS-M（4 核 8GB），遠振可線上升級不用搬家。

## 10. 疑難排解

| 症狀 | 檢查 |
|---|---|
| `required` 錯誤 | `/srv/sagon/.env` 沒建或少變數（不是 `.env.production`）|
| web 反覆重啟 | `docker compose logs web`。多半是 `.env.production` 少了必填變數 —— `src/lib/env.ts` 啟動時強驗證，缺一個就 throw |
| 中文站 `ERR_TOO_MANY_REDIRECTS`（`/en` 正常）| `src/proxy.ts` 用 `auth()` 包住了 next-intl，讓 `AUTH_URL` 的 origin 汙染語系 rewrite。徵兆是 `curl -D - https://chenkuanyi.com.tw/` 出現兩個 `Via: 1.1 Caddy` 與絕對網址的 `X-Middleware-Rewrite`；正常時 rewrite 是相對路徑 `/zh-TW`。**不要靠刪 `AUTH_URL` 解決**，那會改壞 SSO 登入，見下一列 |
| Google／LINE 登入被 `redirect_uri_mismatch` 擋下 | `.env.production` 少了 `AUTH_URL`。用 `curl -s https://chenkuanyi.com.tw/api/auth/providers` 看 `callbackUrl`，出現 `0.0.0.0:3000` 就是它。補回去再 `up -d --force-recreate web` |
| 憑證簽不到 | DNS 未生效、80 埠被擋、或 Cloudflare 橘色雲開著 |
| 綠界回調沒反應 | `APP_URL` 是否為 https 正式網域；綠界後台的回調網址是否同步更新 |
| 訂單付款成功但沒開電子收據 | `docker compose logs worker`；確認 Redis 活著、worker 沒掛 |
| 磁碟滿 | `docker system prune -af`；檢查 `/srv/sagon/backups` 是否堆積 |
