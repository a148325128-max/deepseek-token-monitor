@echo off
chcp 65001 >nul
echo ============================================
echo   DeepSeek 监控助手 - 修复版测试脚本
echo ============================================
echo.
cd /d C:\tmp\deepseek-token-monitor-main

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)

echo.
echo [2/3] 生成 Windows 图标...
node scripts/package-mac.js --ico-only
if %errorlevel% neq 0 (
    echo 图标生成失败
    pause
    exit /b 1
)

echo.
echo [3/3] 启动修复版应用...
echo.
echo 测试要点：
echo   - 托盘图标是否显示（之前不显示）
echo   - 余额是否正常
echo   - 点击「开始监控」是否报 sqlite3 错误
echo   - 命令框是否显示 set / $env: 命令
echo.
echo 关闭此窗口即可停止应用。
echo ============================================
start "" /B npx electron .

echo.
pause
