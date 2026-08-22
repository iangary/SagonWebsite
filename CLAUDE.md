@AGENTS.md

# 正式站部署的檔案來源

環境變數檔的**正本全部在本機**，主機上的那幾份是副本，改本機再 `scp` 上去：

| 檔案 | 正本位置 | 給誰用 |
|---|---|---|
| `.env` | repo 根目錄 | 本機開發（`npm run dev`、`npm run build`、dev compose） |
| `.env.production` | **`docs/sagon-deploy/.env.production`** | 正式站容器（compose 的 `env_file:`），送到 `/srv/sagon/.env.production` |
| `.env`（compose 用） | **`docs/sagon-deploy/.env`** | 主機 compose 的 `${VAR}` 替換（`IMAGE_PREFIX`、`SITE_DOMAIN`、`POSTGRES_*`），送到 `/srv/sagon/.env` |

**不要直接在主機上用 nano 改 `.env*`** —— 那樣下次 `scp` 就會把它蓋掉，而且本機看不到主機的真實狀態。
主機那份怎麼填見 [docs/deploy.md](docs/deploy.md) §6.4。

> ⚠️ **第一次 `scp` 之前一定要先把主機那份拉回來合併。**
> 兩邊過去是各自漂移的 —— 2026-08-16 比對時，本機有 `AUTH_LINE_*` 而主機是空的，
> 兩邊的 `SMTP_PASS` 則都還是 `__CHANGE_ME__`。本機這份**不保證**包含所有只在主機補過的金鑰，
> 沒合併就上傳會把它們靜靜清掉，而且站台要等到有人用到那個功能才會壞。
> 收斂流程見 [docs/sagon-deploy/README.md](docs/sagon-deploy/README.md) 的「一次性收斂」。
> 收斂完成之後，本機就是唯一真相，日後不必再 diff。

收斂時只比對「有沒有這個欄位、值是不是空的」而不印出值（在 `docs/sagon-deploy/` 裡跑）：

```bash
comm -3 <(grep -E '^[A-Z_]+=' .env.production | sort) <(grep -E '^[A-Z_]+=' .env.production.fromhost | sort) | sed -E 's/^\s*//; s/=.*//' | sort -u
```

**正本放在 `docs/sagon-deploy/`，不是 repo 根目錄。** Next.js 在 `NODE_ENV=production` 時
會自動載入根目錄的 `.env.production`，本機建置就會意外吃到正式站的網域與資料庫連線字串。
`docs/sagon-deploy/` 已在 `.gitignore` 裡，放在那裡才不會進版控。

主機上的每個檔案都有本機正本，**沒有任何一個該在主機上手改**：

| 主機檔案 | 正本 |
|---|---|
| `/srv/sagon/docker-compose.prod.yml` | `docker-compose.prod.yml` |
| `/srv/sagon/Caddyfile` | `Caddyfile` |
| `/srv/sagon/.env.production` | `docs/sagon-deploy/.env.production`（含真實金鑰，不進版控） |
| `/srv/sagon/.env` | `docs/sagon-deploy/.env`（`IMAGE_PREFIX`、`SITE_DOMAIN`、`POSTGRES_*`） |
| `/usr/local/bin/sagon-backup` | `scripts/backup.sh` |

要改就改本機正本再送上去。在主機用 nano 改的東西下次部署會被覆蓋，而且本機看不到主機的真實狀態。

兩個 `.env*` 與其他檔案的差別只在**放的位置**（`docs/sagon-deploy/` 而非 repo 根目錄，
因為含真實金鑰不能進版控）與**送上去之後要補的動作**：`chmod 600`、重建吃到它的容器。

`docs/sagon-deploy/` 已列入 `.gitignore`（內含資料庫密碼、`AUTH_SECRET`、綠界與黑貓金鑰）。
它是唯一一份正本，**沒有備份在版控裡** —— 換電腦或重灌前記得自己留一份。

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

repo 根目錄的設定檔 —— 主機先備份再 `scp`：

```bash
ssh root@103.1.221.67 'cd /srv/sagon && for f in Caddyfile docker-compose.prod.yml; do cp -a "$f" "$f.bak-$(date +%m%d-%H%M)"; done'
scp Caddyfile docker-compose.prod.yml scripts/smoke.sh root@103.1.221.67:/srv/sagon/
ssh root@103.1.221.67 'cd /srv/sagon && docker compose -f docker-compose.prod.yml up -d'
```

**環境變數同樣走 `scp`**，只是多兩個動作：`chmod 600`（`scp` 覆蓋後權限會回到 644，
等於同機器上其他程序都讀得到金鑰）與 `--force-recreate web`（`env_file` 改了不會自動生效）：

```bash
ssh root@103.1.221.67 'cd /srv/sagon && for f in .env .env.production; do cp -a "$f" "$f.bak-$(date +%m%d-%H%M)"; done'
scp docs/sagon-deploy/.env docs/sagon-deploy/.env.production root@103.1.221.67:/srv/sagon/
ssh root@103.1.221.67 'cd /srv/sagon && chmod 600 .env .env.production && docker compose -f docker-compose.prod.yml up -d --force-recreate web'
```

送完跑 `scripts/check-drift.sh` 與 `scripts/smoke.sh` 確認。
主機上留下的 `.bak-MMDD-HHMM` 是唯一的回退點 —— `scp` 覆蓋沒有 undo。

程式碼的更新不走這條路 —— 推上 `main` 由 CI 建 image，主機只 `pull` + `up -d`，
完整說明見 [docs/deploy.md](docs/deploy.md)。
