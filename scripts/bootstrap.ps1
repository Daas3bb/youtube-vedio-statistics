# 首次环境配置（Windows PowerShell）
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "已创建 .env，请编辑并填入 YOUTUBE_API_KEY（本地采集时需要）" -ForegroundColor Yellow
} else {
    Write-Host ".env 已存在，跳过创建"
}

Write-Host "`n安装 Python 依赖..."
pip install -r scripts/requirements.txt

Write-Host "`n构建静态数据..."
python scripts/build_static.py

Write-Host "`n安装前端依赖..."
Push-Location frontend
npm install
Pop-Location

Write-Host "`n完成。启动方式："
Write-Host "  python scripts/build_static.py"
Write-Host "  cd frontend && npm run dev"
