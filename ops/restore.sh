#!/usr/bin/env bash
# DESTRUCTIVE only when explicitly invoked with --confirm-restore.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
[[ ${1:-} == --confirm-restore ]] || { echo 'Usage: ops/restore.sh --confirm-restore BACKUP.uavbackup (khôi phục đè CSDL và dữ liệu stack hiện tại)' >&2; exit 1; }
restore_input=${2:?Missing archive}
restore_key=${BACKUP_KEY_FILE:-deploy/secrets/backup_password}
restore_tmp=$(mktemp -d)
trap 'rm -rf "$restore_tmp"' EXIT
# Authentication succeeds before any service is stopped or data changed.
node ops/archive.js decrypt "$restore_input" "$restore_tmp/snapshot.tar" "$restore_key"
# Archives are produced by backup.sh and authenticated. Reject unexpected top-level paths.
tar -tf "$restore_tmp/snapshot.tar" | while IFS= read -r item; do
 case "$item" in database.sql|files.tar.gz|objects.tar.gz|secrets.tar.gz|docker-compose.yml|Caddyfile|revision.txt|deployment.env) ;; *) echo 'Thành phần archive không hợp lệ' >&2; exit 1;; esac
done
tar -xf "$restore_tmp/snapshot.tar" -C "$restore_tmp"
for file in database.sql files.tar.gz objects.tar.gz; do [[ -s "$restore_tmp/$file" ]] || exit 1; done
docker compose stop proxy backend minio
backend_container=$(docker compose ps -aq backend)
minio_container=$(docker compose ps -aq minio)
backend_image=$(docker inspect --format '{{.Image}}' "$backend_container")
# Fixed directories only; no arbitrary host path deletion.
docker run --rm --user root --volumes-from "$backend_container" --mount "type=bind,src=$restore_tmp,dst=/backup,readonly" "$backend_image" sh -c 'rm -rf /app/uploads/* /app/tiles/* /app/data/*; tar -xzf /backup/files.tar.gz -C /app'
docker run --rm --user root --volumes-from "$minio_container" --mount "type=bind,src=$restore_tmp,dst=/backup,readonly" "$backend_image" sh -c 'rm -rf /data/*; tar -xzf /backup/objects.tar.gz -C /'
docker compose exec -T mysql sh -c 'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysql -u root dji_uav_management' < "$restore_tmp/database.sql"
# Active sessions and grants must not survive a rollback.
docker compose exec -T mysql sh -c 'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysql -u root dji_uav_management -e "DELETE FROM user_sessions; UPDATE api_keys SET revoked_at=NOW(); UPDATE pilot_sessions SET ended_at=COALESCE(ended_at,NOW());"'
echo 'Dữ liệu đã khôi phục. Stack còn dừng để kiểm tra revision.txt và cấu hình/bí mật từ archive trước khi khởi động.'
echo "Revision nguồn: $(cat "$restore_tmp/revision.txt")"
echo 'Dùng docker compose start minio backend proxy khi đã kiểm tra cấu hình tương thích. Secrets không tự ghi đè.'
