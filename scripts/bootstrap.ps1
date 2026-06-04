# 首次环境配置（Windows PowerShell）
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "已创建 .env，请编辑并填入 YOUTUBE_API_KEY" -ForegroundColor Yellow
} else {
    Write-Host ".env 已存在，跳过创建"
}

Write-Host "`n安装 Python 依赖..."
pip install -r backend/requirements.txt --only-binary=:all:

Write-Host "`n安装前端依赖..."
Push-Location frontend
npm install
Pop-Location

Write-Host "`n验证 API（需已在 .env 中配置 Key）..."
python scripts/verify_api.py

Write-Host "`n完成。启动方式见 README.md"
