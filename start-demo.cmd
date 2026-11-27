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
  echo 没有找到 proxy\.env，AI 判分需要 DeepSeek Key。
  echo.
  set /p INPUTKEY=请粘贴你的 DeepSeek API Key（直接回车则跳过 AI）:
  if defined INPUTKEY (
    > "proxy\.env" echo DEEPSEEK_API_KEY=%INPUTKEY%
    echo 已保存到 proxy\.env（该文件不会提交到仓库）
  ) else (
    echo 已跳过。页面仍可正常使用，简答题走关键词判分。
  )
  echo.
)

echo 正在启动网页服务（8891）与 AI 代理（8893）...
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