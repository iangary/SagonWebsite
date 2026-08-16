@AGENTS.md

# 正式站部署的檔案來源

環境變數檔分兩份，**各自只有一個地方是正本**，不要互相複製：

| 檔案 | 正本位置 | 給誰用 |
|---|---|---|
| `.env` | repo 根目錄 | 本機開發（`npm run dev`、`npm run build`、dev compose） |
| `.env.production` | **主機 `/srv/sagon/.env.production`**，在主機上手寫 | 正式站容器（compose 的 `env_file:`） |

`docs/sagon-deploy/.env.production` 只是主機那份的**工作副本**，不是正本。
兩邊會各自漂移，而且方向不固定 —— 2026-08-16 比對時，本機有 `AUTH_LINE_*` 而主機是空的，
兩邊的 `SMTP_PASS` 則都還是 `__CHANGE_ME__`。所以**兩個方向的覆蓋都要先 diff**，
流程見 [docs/sagon-deploy/README.md](docs/sagon-deploy/README.md) 的「從主機拉回來」；
無腦 `scp` 上去會靜靜地清掉只有主機才有的金鑰。主機那份怎麼填見 [docs/deploy.md](docs/deploy.md) §6.4。

只比對「有沒有這個欄位、值是不是空的」而不印出值：

```bash
comm -3 <(grep -E '^[A-Z_]+=' .env.production | sort) <(grep -E '^[A-Z_]+=' .env.production.fromhost | sort) | sed -E 's/^\s*//; s/=.*//' | sort -u
```

**根目錄不要放 `.env.production`。** Next.js 在 `NODE_ENV=production` 時會自動載入它，
本機建置就會意外吃到正式站的網域與資料庫連線字串。

其餘主機檔案以 repo 根目錄的版本為正本：

| 主機檔案 | 正本 |
|---|---|
| `/srv/sagon/docker-compose.prod.yml` | `docker-compose.prod.yml` |
| `/srv/sagon/Caddyfile` | `Caddyfile` |
| `/srv/sagon/.env.production` | 只存在主機，手寫（含真實金鑰） |
| `/srv/sagon/.env` | 只存在主機（`IMAGE_PREFIX`、`SITE_DOMAIN`、`POSTGRES_*`） |
| `/usr/local/bin/sagon-backup` | `scripts/backup.sh` |

正本在 repo 的那幾個，要改就改 repo 再送上去，**不要直接在主機上用 nano 改** ——
那樣下次部署會被覆蓋，而且本機看不到主機的真實狀態。

兩個 `.env*` 不在此列：它們的正本本來就在主機，直接改主機才是對的。
改完記得 `chmod 600`、重建吃到它的容器，並把 `docs/sagon-deploy/` 的副本同步回來。

`docs/sagon-deploy/` 已列入 `.gitignore`（內含資料庫密碼、`AUTH_SECRET`、綠界與黑貓金鑰）。

## `/srv/sagon/.env.production` 的關鍵值

改動時特別注意這幾個，錯了會整組壞掉而且不容易看出原因：

| 欄位 | 必須是 |
|---|---|
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | `https://chenkuanyi.com.tw` —— 綠界 callback 與 Auth.js 導向都由它組出來 |
| `DATABASE_URL` | 密碼要等於主機 `/srv/sagon/.env` 的 `POSTGRES_PASSWORD` |
| `AUTH_SECRET` | 沿用主機現有值，換掉會把所有登入中的使用者踢出 |
| `AUTH_URL` | `https://chenkuanyi.com.tw`，**必須有**。少了它 Auth.js 會拿容器內部網址算 OAuth 的 `redirect_uri`（`https://0.0.0.0:3000/api/auth/callback/google`），Google／LINE 直接擋下，而站台其他部分完全正常、沒有任何錯誤訊息。`AUTH_TRUST_HOST` 救不了這格，它只影響 `createActionURL`。代價是 `src/proxy.ts` **不能用 `auth()` 包住 next-intl**，理由見該檔檔頭 |
| `ECPAY_ENV` / `TCAT_ENV` | 用測試金鑰時必須是 `stage`，配 `production` 會把測試帳號送到正式環境 |
| `SEED_ADMIN_EMAIL` / `SHOP_SERVICE_EMAIL` | 收得到信的真信箱 |

## 送檔流程

正本在 repo 的設定檔 —— 主機先備份再 `scp`：

```bash
ssh root@103.1.221.67 'cd /srv/sagon && for f in Caddyfile docker-compose.prod.yml; do cp -a "$f" "$f.bak-$(date +%m%d-%H%M)"; done'
scp Caddyfile docker-compose.prod.yml scripts/smoke.sh root@103.1.221.67:/srv/sagon/
ssh root@103.1.221.67 'cd /srv/sagon && docker compose -f docker-compose.prod.yml up -d'
```

**環境變數不走 `scp`。** `.env` 與 `.env.production` 的正本在主機，直接改主機、
改完補 `chmod 600`（任何寫入都可能把權限變回 644），再重建吃到它的容器：

```bash
ssh root@103.1.221.67 'cd /srv/sagon && cp -a .env.production ".env.production.bak-$(date +%m%d-%H%M)" && nano .env.production && chmod 600 .env.production && docker compose -f docker-compose.prod.yml up -d --force-recreate web'
```

改完把 `docs/sagon-deploy/` 的副本同步回來（README 的「從主機拉回來」），
再跑 `scripts/check-drift.sh` 與 `scripts/smoke.sh` 確認。

程式碼的更新不走這條路 —— 推上 `main` 由 CI 建 image，主機只 `pull` + `up -d`，
完整說明見 [docs/deploy.md](docs/deploy.md)。
