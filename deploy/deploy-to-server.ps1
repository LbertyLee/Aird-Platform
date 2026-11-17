# 一键部署到 124.221.222.3（Windows PowerShell）
# 用法：在项目根目录执行
#   .\deploy\deploy-to-server.ps1
#   .\deploy\deploy-to-server.ps1 -Services api
#   .\deploy\deploy-to-server.ps1 -Services api,admin,web -Prune

param(
    [string]$Services = "api,admin,web",
    [switch]$Prune,
    [switch]$SkipUpload,
    [int]$TimeoutMin = 90
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 python，请先安装 Python 3 并确保可在终端执行 python" -ForegroundColor Red
    exit 1
}

python -c "import paramiko" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "正在安装 paramiko..." -ForegroundColor Yellow
    python -m pip install paramiko
}

$argsList = @(
    "deploy/deploy-to-server.py",
    "--services", $Services,
    "--timeout-min", "$TimeoutMin"
)
if ($Prune) { $argsList += "--prune" }
if ($SkipUpload) { $argsList += "--skip-upload" }

Write-Host "执行: python $($argsList -join ' ')" -ForegroundColor Cyan
python @argsList
exit $LASTEXITCODE
