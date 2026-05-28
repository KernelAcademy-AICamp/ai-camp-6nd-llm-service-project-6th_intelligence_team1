$env:NODE_OPTIONS = "--use-system-ca"

Write-Host "`n=== 1. YouTube 수집 ===" -ForegroundColor Cyan
node trend/youtube.js
if (-not $?) { Write-Host "youtube.js 실패. 중단." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 2. Tavily 수집 ===" -ForegroundColor Cyan
node trend/tavily.js
if (-not $?) { Write-Host "tavily.js 실패. 중단." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 3. 병합 ===" -ForegroundColor Cyan
node trend/merge.js
if (-not $?) { Write-Host "merge.js 실패. 중단." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 4. 트렌드 분석가 ===" -ForegroundColor Cyan
node src/trend/analyze.js
if (-not $?) { Write-Host "trend/analyze.js 실패. 중단." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 5. 브랜드 분석가 ===" -ForegroundColor Cyan
node src/brand/analyze.js
if (-not $?) { Write-Host "brand/analyze.js 실패. 중단." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 6. 매칭가 ===" -ForegroundColor Cyan
node src/matching/match.js
if (-not $?) { Write-Host "match.js 실패." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 완료 ===" -ForegroundColor Green
