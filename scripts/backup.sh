#!/usr/bin/env bash
#
# 每日備份 PostgreSQL 與商品圖，並上傳異地。
#
# 遠振 TW-VPS-S 沒有主機層備份（方案的 Backup 欄位是「否」），資料庫是 Docker
# named volume，機器掛掉就沒了。這支腳本是唯一的防線，請務必排進 cron 並且
# 真的做過一次還原演練 —— 沒還原過的備份不算備份。
#
# 安裝：
#   sudo install -m 755 scripts/backup.sh /usr/local/bin/sagon-backup
#   sudo crontab -e
#   15 4 * * * /usr/local/bin/sagon-backup >> /var/log/sagon-backup.log 2>&1
#
# 還原（會覆蓋現有資料，確認清楚再執行）：
#   gunzip -c /srv/sagon/backups/db-2026-08-09.sql.gz \
#     | docker compose -f /srv/sagon/docker-compose.prod.yml exec -T db \
#         psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

set -euo pipefail

STACK_DIR=${STACK_DIR:-/srv/sagon}
COMPOSE_FILE="$STACK_DIR/docker-compose.prod.yml"
BACKUP_DIR=${BACKUP_DIR:-$STACK_DIR/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
STAMP=$(date +%F)

# POSTGRES_* 放在 compose 用的 .env 裡
# shellcheck disable=SC1091
set -a && . "$STACK_DIR/.env" && set +a

mkdir -p "$BACKUP_DIR"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "[$(date -Is)] 開始備份"

# --- 資料庫 ---------------------------------------------------------------
# 先寫到 .partial，成功才改名。中斷時不會留下一個看似完整的壞檔案。
DB_OUT="$BACKUP_DIR/db-$STAMP.sql.gz"
compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$DB_OUT.partial"
mv "$DB_OUT.partial" "$DB_OUT"
echo "  資料庫 → $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"

# --- 商品圖 ---------------------------------------------------------------
# 圖片還放在本機 volume 時才需要。搬到 R2/S3 之後這段可以拿掉。
UPLOADS_OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"
if docker volume inspect sagon-prod_uploads >/dev/null 2>&1; then
  docker run --rm \
    -v sagon-prod_uploads:/data:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine:latest \
    tar czf "/backup/uploads-$STAMP.tar.gz.partial" -C /data .
  mv "$UPLOADS_OUT.partial" "$UPLOADS_OUT"
  echo "  商品圖 → $UPLOADS_OUT ($(du -h "$UPLOADS_OUT" | cut -f1))"
fi

# --- 異地 -----------------------------------------------------------------
# 本機備份擋得住「誤刪資料」，擋不住「機器整台不見」。
# 設定好 rclone（remote 名稱用 RCLONE_REMOTE 指定）才會真的上傳。
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "*-$STAMP.*" --quiet
  echo "  已上傳異地 → $RCLONE_REMOTE"
else
  echo "  ⚠ 未設定 RCLONE_REMOTE，備份只存在本機 —— 機器掛掉就一起沒了"
fi

# --- 清理 -----------------------------------------------------------------
find "$BACKUP_DIR" -name '*.gz' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete

echo "[$(date -Is)] 備份完成"
