$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Can cai Node.js 24 LTS tu https://nodejs.org roi bam chay lai.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Khong tim thay npm. Cai lai Node.js 24 LTS va mo cua so moi.' }
    $major = & node -p "process.versions.node.split('.')[0]"
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Can Node.js 24 LTS tro len.' }
    $envPath = Join-Path $projectRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        Write-Host 'Lan dau: tao cau hinh local. MySQL can duoc cai va dang chay.'
        $dataDir = Join-Path $projectRoot 'backend/data'
        [void][IO.Directory]::CreateDirectory($dataDir)
        $passwordPath = Join-Path $dataDir 'local-mysql-password'
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        if (-not (Test-Path -LiteralPath $passwordPath)) {
            $secure = Read-Host 'Nhap mat khau MySQL root (khong hien ky tu)' -AsSecureString
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
            if ([string]::IsNullOrEmpty($plain) -or $plain -match '[\r\n]' -or $plain.Trim() -ne $plain) { throw 'Mat khau can khac rong, khong xuong dong hay co khoang trang dau/cuoi. Truong hop dac biet: cau hinh .env theo huong dan.' }
            # Store exact symbols in a private file, avoiding dotenv quote/backslash parsing.
            $stream = [IO.File]::Open($passwordPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $bytes = $utf8.GetBytes($plain); $stream.Write($bytes, 0, $bytes.Length) }
            finally { $stream.Dispose(); $plain = $null; $bytes = $null }
        }
        $passwordFileForEnv = $passwordPath.Replace('\', '/')
        $content = @"
HOST_IP=auto
LOCAL_NETWORK_MODE=lan
PORT=8080
MQTT_PORT=1883
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD_FILE="$passwordFileForEnv"
MYSQL_DATABASE=dji_uav_management
BOOTSTRAP_ADMIN_USER=local-admin
JWT_SECRET=
STORAGE_MODE=local
LIVE_STREAM_ENABLED=true
DJI_LIVE_CONTROL_ENABLED=false
ENABLE_MQTT_DEBUG=false
VISION_ENABLED=false
"@
        # Exclusive create: a second click never truncates existing configuration.
        $stream = [IO.File]::Open($envPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = $utf8.GetBytes($content); $stream.Write($bytes, 0, $bytes.Length) }
        finally { $stream.Dispose(); $content = $null; $bytes = $null }
        Write-Host 'Da luu cau hinh va file mat khau rieng tren may, khong dua vao Git.'
    }
    & node (Join-Path $projectRoot 'backend/scripts/start-local.js')
    exit $LASTEXITCODE
} catch {
    Write-Host ("LOI: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Xem docs/CHAY_LOCAL.md. Khong xoa DB de thu lai.'
    exit 1
}
