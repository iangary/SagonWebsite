#!/usr/bin/env bash
#
# 部署後的煙霧測試。任何一條路由不是預期狀態碼就以非零值結束。
#
# 存在的理由：原本的驗證只有 `curl -I https://…`，而首頁是少數不走 ISR 的頁面。
# 2026-08 有一次 /category/* 與 /product/[slug] 全部 500，首頁卻正常，
# 整整一週沒被發現。清單裡每加一條，就少一種「只有客人會遇到」的壞法。
#
# 用法：
#   scripts/smoke.sh                          # 測正式站
#   BASE=http://localhost:3000 scripts/smoke.sh   # 測本機
#
# 需要一個實際存在的商品與分類 slug 才測得到動態路由。沒給的話會自己去
# 資料庫撈第一筆；撈不到就跳過那兩條並提醒（空資料庫不該讓部署失敗）。
#   PRODUCT_SLUG=xxx CATEGORY_SLUG=yyy scripts/smoke.sh

set -uo pipefail

BASE=${BASE:-https://chenkuanyi.com.tw}
STACK_DIR=${STACK_DIR:-/srv/sagon}
COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"
TIMEOUT=${TIMEOUT:-20}

pass=0
fail=0

# 從資料庫撈一筆真實 slug。只在主機上跑得動，本機測試請自己帶環境變數進來。
db_query() {
  [ -f "$COMPOSE_FILE" ] || return 1
  docker compose -f "$COMPOSE_FILE" exec -T db \
    psql -U "${POSTGRES_USER:-sagon}" -d "${POSTGRES_DB:-sagon}" -tAc "$1" 2>/dev/null
}

if [ -f "$STACK_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a && . "$STACK_DIR/.env" && set +a
fi

PRODUCT_SLUG=${PRODUCT_SLUG:-$(db_query "select slug from products where status='ACTIVE' limit 1" || true)}
CATEGORY_SLUG=${CATEGORY_SLUG:-$(db_query "select slug from categories limit 1" || true)}

# 第四個參數是要帶的 Cookie，給語系檢查用（見下面 NEXT_LOCALE 那兩條）
check() {
  local path=$1 expect=$2 label=${3:-$1} cookie=${4:-}
  local code
  if [ -n "$cookie" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" -H "Cookie: $cookie" "$BASE$path" || echo 000)
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$BASE$path" || echo 000)
  fi
  if [ "$code" = "$expect" ]; then
    printf '  ✓ %-42s %s\n' "$label" "$code"
    pass=$((pass + 1))
  else
    printf '  ✗ %-42s %s（預期 %s）\n' "$label" "$code" "$expect"
    fail=$((fail + 1))
  fi
}

echo
echo "煙霧測試：$BASE"
echo

# --- 靜態與一般頁面 ---
check /                       200
check /about                  200
check /product/all            200
check /api/health             200

# --- 語系。localePrefix 是 never：英文沒有自己的網址，語言在 NEXT_LOCALE cookie 上。
#     第一條抓「cookie 沒被讀到」，第二條抓「舊的 /en 連結死掉」——
#     2026-08 之前英文站在 /en，那批連結已經散出去了，不能變成 404。 ---
check /       200 "/（NEXT_LOCALE=en 也要 200）" "NEXT_LOCALE=en"
check /en/about 307 "/en/about（舊連結應導回 /about）"

# --- 走 ISR 的動態路由。這兩條是最容易壞又最不容易被發現的 ---
if [ -n "${CATEGORY_SLUG:-}" ]; then
  check "/category/$CATEGORY_SLUG" 200 "/category/<實際分類>"
else
  echo "  - 略過 /category/<slug>（資料庫沒有分類，或不在主機上執行）"
fi

if [ -n "${PRODUCT_SLUG:-}" ]; then
  check "/product/$PRODUCT_SLUG" 200 "/product/<實際商品>"
else
  echo "  - 略過 /product/<slug>（資料庫沒有上架商品，或不在主機上執行）"
fi

# --- 找不到的資源要回 404，不是 500 ---
# 這組會抓到「例外被拋到 notFound() 之前」這類問題，正是上述那次事故的樣態。
check /category/__no_such_category__ 404
check /product/__no_such_product__   404
check /__no_such_page__              404

# --- 商品圖。圖片是掛在 uploads volume 上的執行期檔案，
#     Next.js 只在啟動時掃描 public/，所以這條專門抓「上傳完忘了重啟 web」。 ---
IMAGE_URL=$(db_query "select url from product_images limit 1" || true)
if [ -n "${IMAGE_URL:-}" ]; then
  check "$IMAGE_URL" 200 "商品圖（$(basename "$IMAGE_URL")）"
else
  echo "  - 略過商品圖（資料庫沒有圖片紀錄）"
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "失敗 $fail 項、通過 $pass 項 —— 部署不算成功，先查 docker compose logs web"
  exit 1
fi
echo "全部通過（$pass 項）"
