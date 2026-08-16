@AGENTS.md

# 正式站部署的檔案來源

環境變數檔分兩份，**各自只有一個地方是正本**，不要互相複製：

| 檔案 | 位置 | 給誰用 |
|---|---|---|
| `.env` | repo 根目錄 | 本機開發（`npm run dev`、`npm run build`、dev compose） |
| `.env.production` | `docs/sagon-deploy/.env.production` | **正式站專用**，只會出現在這裡與主機上 |

**根目錄不要放 `.env.production`。** Next.js 在 `NODE_ENV=production` 時會自動載入它，
本機建置就會意外吃到正式站的網域與資料庫連線字串。正式站那份固定放在 `docs/sagon-deploy/`。

其餘主機檔案以 repo 根目錄的版本為正本：

| 主機檔案 | 正本 |
|---|---|
| `/srv/sagon/docker-compose.prod.yml` | `docker-compose.prod.yml` |
| `/srv/sagon/Caddyfile` | `Caddyfile` |
| `/srv/sagon/.env.production` | `docs/sagon-deploy/.env.production` |
| `/srv/sagon/.env` | 只存在主機（`IMAGE_PREFIX`、`SITE_DOMAIN`、`POSTGRES_*`） |
| `/usr/local/bin/sagon-backup` | `scripts/backup.sh` |

要改主機的設定，改正本再送上去，**不要直接在主機上用 nano 改** ——
那樣下次部署會被覆蓋，而且本機看不到主機的真實狀態。

`docs/sagon-deploy/` 已列入 `.gitignore`（內含資料庫密碼、`AUTH_SECRET`、綠界與黑貓金鑰）。

## `docs/sagon-deploy/.env.production` 的關鍵值

改動時特別注意這幾個，錯了會整組壞掉而且不容易看出原因：

| 欄位 | 必須是 |
|---|---|
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | `https://chenkuanyi.com.tw` —— 綠界 callback 與 Auth.js 導向都由它組出來 |
| `DATABASE_URL` | 密碼要等於主機 `/srv/sagon/.env` 的 `POSTGRES_PASSWORD` |
| `AUTH_SECRET` | 沿用主機現有值，換掉會把所有登入中的使用者踢出 |
| `AUTH_URL` | **不能存在**。設了會讓中文站無限轉址，理由寫在 `.env.production` 該行的註解。callback 網址靠 `AUTH_TRUST_HOST=true` 從 `x-forwarded-*` 推導就夠了 |
| `ECPAY_ENV` / `TCAT_ENV` | 用測試金鑰時必須是 `stage`，配 `production` 會把測試帳號送到正式環境 |
| `SEED_ADMIN_EMAIL` / `SHOP_SERVICE_EMAIL` | 收得到信的真信箱 |

## 送檔流程

主機先備份，`scp` 之後一定要補 `chmod 600`（scp 會把權限重設成 644）：

```bash
cd /srv/sagon && for f in .env .env.production docker-compose.prod.yml; do cp -a "$f" "$f.bak-$(date +%m%d-%H%M)"; done
scp docker-compose.prod.yml docs/sagon-deploy/.env.production root@103.1.221.67:/srv/sagon/
ssh root@103.1.221.67 'cd /srv/sagon && chmod 600 .env .env.production && docker compose -f docker-compose.prod.yml up -d'
```

程式碼的更新不走這條路 —— 推上 `main` 由 CI 建 image，主機只 `pull` + `up -d`，
完整說明見 [docs/deploy.md](docs/deploy.md)。
