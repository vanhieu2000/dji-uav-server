#!/usr/bin/env python3
"""Create only missing local secret files; never print secrets or overwrite existing values."""
import os,secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'deploy'/'secrets'
root.mkdir(mode=0o700,parents=True,exist_ok=True)
for name in ['mysql_root_password','mysql_app_password','jwt_secret','s3_access_key','s3_secret_key','vision_secret','smtp_password','backup_password']:
    file=root/name
    try:
        fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(secrets.token_hex(32)+'\n')
        # Compose secrets are readable by the unprivileged node container UID.
        # Directory remains 0700 on host; individual bind-mounted files are read-only.
        if name!='backup_password':os.chmod(file,0o644)
    except FileExistsError:pass
print('Đã chuẩn bị file bí mật trong deploy/secrets; không thay đổi file đã tồn tại.')
