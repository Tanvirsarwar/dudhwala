@echo off
REM Dudhwala local client demo (Windows). Starts mock API :4010, storefront :3100, admin :3101 (127.0.0.1 only).
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo ERROR: Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (echo ERROR: Node.js 22 or newer is required & pause & exit /b 1)
where pnpm >nul 2>nul || call corepack enable
where pnpm >nul 2>nul || (echo ERROR: pnpm not found. Run: corepack enable  or  npm install -g pnpm@9.15.9 & pause & exit /b 1)

set NEXT_PUBLIC_API_URL=/v1
set API_PROXY_TARGET=http://127.0.0.1:4010
set API_INTERNAL_URL=http://127.0.0.1:4010/v1
set NEXT_TELEMETRY_DISABLED=1

if not exist node_modules (
  echo == Installing dependencies - first run only, needs internet ==
  call pnpm install --frozen-lockfile --filter "@dudhwala/web..." --filter "@dudhwala/admin..." || (pause & exit /b 1)
)
if not exist apps\web\.next\BUILD_ID goto build
if not exist apps\admin\.next\BUILD_ID goto build
goto run
:build
echo == Building storefront and admin - first run only, a few minutes ==
call pnpm --filter @dudhwala/shared build || (pause & exit /b 1)
set NEXT_PUBLIC_PREVIEW_LABEL=Demo preview - sample data only, not real products or prices. No orders or money are taken.
call pnpm --filter @dudhwala/web build || (pause & exit /b 1)
set NEXT_PUBLIC_PREVIEW_LABEL=Admin demo - login: admin@demo.local / demo1234 (view only)
call pnpm --filter @dudhwala/admin build || (pause & exit /b 1)
:run
start "Dudhwala demo - mock API" cmd /k node demo\mock-api\server.mjs
start "Dudhwala demo - storefront" cmd /k pnpm --filter @dudhwala/web exec next start -H 127.0.0.1 -p 3100
start "Dudhwala demo - admin" cmd /k pnpm --filter @dudhwala/admin exec next start -H 127.0.0.1 -p 3101
echo.
echo  Dudhwala DEMO is starting (sample data only). Wait about 10 seconds, then open:
echo    Storefront : http://127.0.0.1:3100
echo    Admin      : http://127.0.0.1:3101   login: admin@demo.local / demo1234
echo  To stop: close the three "Dudhwala demo" windows (or run stop-demo.bat).
timeout /t 10 >nul
start http://127.0.0.1:3100
