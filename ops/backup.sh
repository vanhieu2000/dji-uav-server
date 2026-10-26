#!/usr/bin/env bash
# Run on deployment host, during maintenance. Never echoes secrets.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
backup_output=${1:?Usage: ops/backup.sh /secure/backups/date.uavbackup}
backup_key=${BACKUP_KEY_FILE:-deploy/secrets/backup_password}
[[ ! -e "$backup_output" ]] || { echo 'File đích đã tồn tại' >&2; exit 1; }
backup_tmp=$(mktemp -d)
backup_paused=0
backup_cleanup(){ if [[ "$backup_paused" == 1 ]]; then docker compose start minio backend proxy >/dev/null; fi; rm -rf "$backup_tmp"; }
trap backup_cleanup EXIT
# Freeze both callbacks and direct S3 writes before snapshot.
backup_paused=1
docker compose stop proxy backend minio
docker compose exec -T mysql sh -c 'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysqldump -u root --single-transaction --no-tablespaces --set-gtid-purged=OFF dji_uav_management' > "$backup_tmp/database.sql"
backend_container=$(docker compose ps -aq backend)
minio_container=$(docker compose ps -aq minio)
backend_image=$(docker inspect --format '{{.Image}}' "$backend_container")
docker run --rm --user root --volumes-from "$backend_container:ro" --mount "type=bind,src=$backup_tmp,dst=/backup" "$backend_image" tar -czf /backup/files.tar.gz -C /app uploads tiles data
docker run --rm --user root --volumes-from "$minio_container:ro" --mount "type=bind,src=$backup_tmp,dst=/backup" "$backend_image" tar -czf /backup/objects.tar.gz -C / data
tar --exclude=backup_password -czf "$backup_tmp/secrets.tar.gz" -C deploy secrets
cp docker-compose.yml deploy/Caddyfile "$backup_tmp/"
if [[ -f .env ]]; then cp .env "$backup_tmp/deployment.env"; fi
git rev-parse HEAD > "$backup_tmp/revision.txt"
tar -cf "$backup_tmp/snapshot.tar" -C "$backup_tmp" database.sql files.tar.gz objects.tar.gz secrets.tar.gz docker-compose.yml Caddyfile revision.txt $(if [[ -f "$backup_tmp/deployment.env" ]]; then echo deployment.env; fi)
node ops/archive.js encrypt "$backup_tmp/snapshot.tar" "$backup_output" "$backup_key"
echo 'Đã sao lưu có mã hóa/xác thực. Giữ khóa ở nơi riêng và thử khôi phục trên máy độc lập.'
