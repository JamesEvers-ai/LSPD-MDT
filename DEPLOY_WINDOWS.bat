@echo off
setlocal
cd /d "%~dp0"
echo LSPD MDT - Cloudflare Pages deployment
where node >nul 2>nul || (echo Node.js fehlt. Installiere Node.js LTS und starte erneut.& pause & exit /b 1)
call npx wrangler login
if errorlevel 1 (echo Cloudflare login fehlgeschlagen.& pause & exit /b 1)
call npx wrangler pages deploy public --project-name=fib-mdt
if errorlevel 1 (echo Deployment fehlgeschlagen.& pause & exit /b 1)
echo Deployment wurde an Cloudflare uebergeben.
pause
