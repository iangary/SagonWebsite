#!/usr/bin/env bash
#
# 比對主機 /srv/sagon 的四個設定檔與 repo 現況，找出「repo 改了但主機沒更新」的漂移。
#
# 存在的理由：docker-compose.prod.yml 在 2026-08-15 加了 labels volume
# （黑貓託運單 PDF 的共用儲存），主機上的副本卻停在舊版，中間沒有任何步驟
# 會發現。少了那個 volume，worker 寫出的 PDF web 讀不到，而黑貓的下載連結
# 只有 24 小時 —— 失敗時完全沒有錯誤訊息，只有出不了貨。
#
# 用法（在 repo 根目錄，本機執行）：
#   scripts/check-drift.sh
#   SSH_TARGET=root@103.1.221.67 scripts/check-drift.sh
#
# 只讀不寫，不會動主機上的任何東西。

set -uo pipefail

SSH_TARGET=${SSH_TARGET:-root@103.1.221.67}
STACK_DIR=${STACK_DIR:-/srv/sagon}
drift=0

say() { printf '\n%s\n' "$1"; }

# --- 1. 從 repo 複製過去的兩個檔案，內容必須逐位元組相同 ---
say "== 設定檔內容比對 =="
for f in Caddyfile docker-compose.prod.yml; do
  local_sum=$(sha256sum "$f" | cut -d' ' -f1)
  remote_sum=$(ssh "$SSH_TARGET" "sha256sum $STACK_DIR/$f 2>/dev/null | cut -d' ' -f1" || true)
  if [ -z "$remote_sum" ]; then
    printf '  ✗ %-26s 主機上不存在\n' "$f"
    drift=$((drift + 1))
  elif [ "$local_sum" = "$remote_sum" ]; then
    printf '  ✓ %-26s 一致\n' "$f"
  else
    printf '  ✗ %-26s 不一致 —— 主機是舊版，需要 scp 更新\n' "$f"
    drift=$((drift + 1))
  fi
done

# --- 2. 環境變數只比對「變數名稱」，不碰值。
#     值本來就該不一樣（金鑰、密碼），會出事的是「程式新增了必填變數、主機沒補」。
#
#     基準取自 src/lib/env.ts 而不是範本檔：範本本身也會過時，而 env.ts 是
#     容器啟動時真正做驗證的地方 —— 它說必填就是必填。 ---
say "== 環境變數欄位比對（只看名稱，不讀值）=="

required_keys() {
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync("src/lib/env.ts", "utf8");
    const body = src.slice(src.indexOf("z.object("), src.indexOf("function load"));
    for (const m of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*(.*)$/gm)) {
      // 有 default / optional / intFromString 的都不算必填 —— 缺了也起得來
      if (!/\.default\(|\.optional\(|intFromString\(/.test(m[2])) console.log(m[1]);
    }
  ' | sort -u
}

remote_keys=$(ssh "$SSH_TARGET" "grep -oE '^[A-Z][A-Z0-9_]*=' $STACK_DIR/.env.production 2>/dev/null" | tr -d '=' | sort -u || true)

if [ -z "$remote_keys" ]; then
  echo "  ✗ .env.production 主機上不存在"
  drift=$((drift + 1))
else
  missing=$(comm -23 <(required_keys) <(echo "$remote_keys") | tr '\n' ' ')
  if [ -z "${missing// /}" ]; then
    echo "  ✓ .env.production 必填欄位齊全"
  else
    printf '  ✗ .env.production 主機缺少必填：%s\n' "$missing"
    echo "    （web 啟動時 src/lib/env.ts 會 throw，容器起不來）"
    drift=$((drift + 1))
  fi

  # 主機上有、但程式已經不讀的欄位。不算錯，但留著會誤導 ——
  # 例如架構從綠界 B2C 宅配換成黑貓之後，ECPAY_LOGISTICS_C2C_* 就成了死欄位。
  known=$(node -e '
    const fs = require("fs");
    const src = fs.readFileSync("src/lib/env.ts", "utf8");
    const body = src.slice(src.indexOf("z.object("), src.indexOf("function load"));
    for (const m of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)) console.log(m[1]);
  ' | sort -u)
  # AUTH_TRUST_HOST 由 Auth.js 直接讀，不經 env.ts，不算多餘
  stale=$(comm -13 <(echo "$known") <(echo "$remote_keys") | grep -v '^AUTH_TRUST_HOST$' | tr '\n' ' ')
  [ -n "${stale// /}" ] && printf '  ! .env.production 主機多出已廢棄欄位：%s\n' "$stale"
fi

# .env 沒有範本檔（內容太少且全是主機專屬），這裡直接列必要欄位
say "== .env 必要欄位 =="
for k in IMAGE_PREFIX IMAGE_TAG SITE_DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  if ssh "$SSH_TARGET" "grep -q '^$k=' $STACK_DIR/.env" 2>/dev/null; then
    printf '  ✓ %s\n' "$k"
  else
    printf '  ✗ %s 缺少 —— compose 會直接噴 required\n' "$k"
    drift=$((drift + 1))
  fi
done

# --- 3. 資料庫 migration 是否已套用到最新 ---
say "== Migration 狀態 =="
if ssh "$SSH_TARGET" "cd $STACK_DIR && docker compose -f docker-compose.prod.yml run --rm migrate npx prisma migrate status" 2>/dev/null |
  grep -q 'up to date'; then
  echo "  ✓ 已套用至最新"
else
  echo "  ✗ 有未套用的 migration —— 執行 docker compose run --rm migrate npx prisma migrate deploy"
  drift=$((drift + 1))
fi

# --- 4. 檔案權限。scp 覆蓋後會回到 644，等於同機器上其他程序都讀得到金鑰 ---
say "== 權限 =="
for f in .env .env.production; do
  mode=$(ssh "$SSH_TARGET" "stat -c %a $STACK_DIR/$f 2>/dev/null" || true)
  if [ "$mode" = "600" ]; then
    printf '  ✓ %-18s %s\n' "$f" "$mode"
  else
    printf '  ✗ %-18s %s —— 應為 600，執行 chmod 600 %s/%s\n' "$f" "${mode:-不存在}" "$STACK_DIR" "$f"
    drift=$((drift + 1))
  fi
done

echo
if [ "$drift" -gt 0 ]; then
  echo "發現 $drift 項漂移，處理完再部署"
  exit 1
fi
echo "主機與 repo 同步"
