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

## 2. 建立管理帳號與 SSH 金鑰

用 VNC 主控台以 root 登入後：

```bash
adduser deploy
usermod -aG sudo deploy
```

在**你自己的電腦**上產生金鑰並上傳：

```bash
ssh-keygen -t ed25519 -C "sagon-deploy"
ssh-copy-id deploy@103.1.221.67
```

確認金鑰能登入之後，關掉密碼登入與 root 直登。編輯 `/etc/ssh/sshd_config`：

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

> 先確認新終端機能用金鑰登入，再關密碼登入。順序反了會把自己鎖在門外
> （還好有 VNC 可以救，但別依賴它）。

## 3. 防火牆

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> **注意 Docker 與 UFW 的交互作用**：Docker 發佈連接埠時會把 iptables 規則寫進
> `DOCKER-USER` 鏈，順序在 ufw 之前，所以 `ports: '0.0.0.0:3000:3000'` 這種寫法
> **ufw 擋不住**。這也是為什麼 compose 裡 web 綁的是 `127.0.0.1:3000:3000`，
> 對外只有 Caddy 發佈 80/443。

## 4. Swap

4GB 沒有 swap，尖峰時 OOM killer 會直接殺掉某個容器（通常是吃最多的 PostgreSQL）。

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 資料庫機器不該積極換出，降低 swappiness
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system
```

## 5. 安裝 Docker

用官方套件庫，不要用 Ubuntu 內建的舊版：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
newgrp docker
docker compose version
```

限制 log 大小，否則 JSON log 會慢慢吃掉 50GB：

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

## 6. 目錄與環境檔

```bash
sudo mkdir -p /srv/sagon && sudo chown deploy:deploy /srv/sagon
cd /srv/sagon
```

把 `docker-compose.prod.yml` 與 `Caddyfile` 放進來（`scp` 或 `git clone` 皆可）。

**需要兩個環境變數檔，缺一不可：**

`/srv/sagon/.env` —— 給 compose 做 `${VAR}` 替換。`env_file:` 不會被拿來做替換，這是最常踩的坑：

```bash
IMAGE_PREFIX=ghcr.io/ian890711/sagonwebsite
IMAGE_TAG=latest
SITE_DOMAIN=chenkuanyi.com.tw
POSTGRES_USER=sagon
POSTGRES_PASSWORD=<openssl rand -base64 24>
POSTGRES_DB=sagon
```

`/srv/sagon/.env.production` —— 給容器內的應用程式。**直接複製 repo 的 `.env.production.example`**，把所有 `__CHANGE_ME__` 填掉即可（網域與運費已預先填好）。重點欄位：

| 變數 | 正式站要設成 |
|---|---|
| `APP_URL` | `https://chenkuanyi.com.tw`（綠界所有 callback 由此組出，**必須是 https**）|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://sagon:<密碼>@db:5432/sagon?schema=public` |
| `REDIS_URL` | `redis://redis:6379` |
| `AUTH_SECRET` | 重新產生：`openssl rand -base64 32` |
| `ECPAY_ENV` | `production`，且所有 `ECPAY_*` 換成正式商店代號與金鑰 |
| `SMS_PROVIDER` | `mitake`，並填入 `MITAKE_USERNAME` / `MITAKE_PASSWORD` |
| `SMTP_*` | 外部寄信服務（見下）|
| `SHOP_SERVICE_EMAIL` | 收得到信的真信箱 —— 通知信頁尾會印出來，客戶會直接回信到這裡 |
| `SEED_SOURCE` | 留空 |
| `SEED_ADMIN_PASSWORD` | 改掉，別留 `admin1234` |

```bash
chmod 600 /srv/sagon/.env /srv/sagon/.env.production
```

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
而**訂單流程本身不會報錯**（金流／發票／物流都是獨立 job）。上線後要盯著這個數字，
量起來就升級方案或換一家沒有日上限的服務。

## 7. GitHub Secrets 與首次部署

在 repo 的 Settings → Secrets and variables → Actions 設定：

| Secret | 值 |
|---|---|
| `SSH_HOST` | `103.1.221.67` |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | 部署用私鑰（建議另外產一把，只給這台用）|
| `GHCR_USER` | GitHub 帳號 |
| `GHCR_TOKEN` | PAT，**只勾 `read:packages`** |

推上 master 後 Actions 會自動 build 三個 image（web / worker / migrate）並 SSH 觸發部署。

手動跑第一次：

```bash
cd /srv/sagon
echo "<GHCR_TOKEN>" | docker login ghcr.io -u <帳號> --password-stdin
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

`migrate` 是一次性容器，會先跑完 `prisma migrate deploy` 才放行 web 與 worker。

驗證：

```bash
curl -I https://chenkuanyi.com.tw          # 應該 200 且是有效憑證
docker compose -f docker-compose.prod.yml logs -f worker   # 應看到「已就緒，concurrency=4」
```

## 8. 備份（必做）

```bash
sudo install -m 755 scripts/backup.sh /usr/local/bin/sagon-backup
```

設定 rclone 指向異地（Cloudflare R2 免費 10GB 夠用）：

```bash
sudo apt install -y rclone
rclone config          # 建一個 remote，例如 r2
echo 'RCLONE_REMOTE=r2:sagon-backups' | sudo tee -a /etc/environment
```

排程每天凌晨 4:15：

```bash
sudo crontab -e
# 15 4 * * * RCLONE_REMOTE=r2:sagon-backups /usr/local/bin/sagon-backup >> /var/log/sagon-backup.log 2>&1
```

**上線前做一次還原演練。** 沒還原過的備份不算備份 —— 指令在 `scripts/backup.sh` 開頭的註解裡。

## 9. 日常維護

```bash
# 每週清 Docker 殘留（50GB 磁碟撐不了幾十次部署）
sudo crontab -e
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
| 憑證簽不到 | DNS 未生效、80 埠被擋、或 Cloudflare 橘色雲開著 |
| 綠界回調沒反應 | `APP_URL` 是否為 https 正式網域；綠界後台的回調網址是否同步更新 |
| 訂單付款成功但沒開發票 | `docker compose logs worker`；確認 Redis 活著、worker 沒掛 |
| 磁碟滿 | `docker system prune -af`；檢查 `/srv/sagon/backups` 是否堆積 |
