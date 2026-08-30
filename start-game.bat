@echo off
chcp 65001 >nul
title 마법사의 시련 - 로컬 서버
cd /d "%~dp0"

echo.
echo   [마법사의 시련] 로컬 서버를 시작합니다...
echo   (브라우저 보안 정책 때문에 index.html 을 그냥 더블클릭하면 모델이 로드되지 않습니다)
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8765/index.html
  python -m http.server 8765
  goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8765/index.html
  npx --yes serve -l 8765 .
  goto :eof
)

echo   Python 또는 Node.js 가 필요합니다. 설치 후 다시 실행해 주세요.
pause
