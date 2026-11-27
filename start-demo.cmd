@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   知识星图 · 本地演示启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

if not exist "proxy\.env" (
  echo AI 判分默认走云端代理，无需任何配置。
  echo 如想同时启用本地代理作为兜底，可粘贴自己的 DeepSeek Key；直接回车跳过。
  echo.
  set /p INPUTKEY=请粘贴 DeepSeek API Key（直接回车跳过）:
  if defined INPUTKEY (
    > "proxy\.env" echo DEEPSEEK_API_KEY=%INPUTKEY%
    echo 已保存到 proxy\.env（该文件不会提交到仓库）
  ) else (
    echo 已跳过。AI 判分仍使用云端代理。
  )
  echo.
)

echo 正在启动网页服务（8891）与本地 AI 代理（8893，兜底用）...
start "知识星图-网页" cmd /k node serve.mjs
timeout /t 2 >nul
start "知识星图-AI代理" cmd /k node proxy\local-proxy.mjs
timeout /t 2 >nul
start "" http://localhost:8891/index.html

echo.
echo 已启动。浏览器应已打开。
echo 手机访问：看「网页服务」窗口里打印的 局域网访问 地址。
echo.
pause