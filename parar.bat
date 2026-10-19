@echo off
rem Desliga o site e o banco de dados local da Geleio.
setlocal
cd /d "%~dp0"

echo.
echo === Geleio: desligando ===
echo.
echo [1/3] Desligando o site (porta 3000)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; 'ok'"

echo.
echo [2/3] Salvando uma copia dos dados do banco local (pasta dados)...
node scripts\dados.mjs salvar --commit

echo.
echo [3/3] Desligando o banco de dados local...
call npx prisma dev stop geleio

echo.
echo Tudo desligado. Para ligar de novo, use iniciar.bat
echo.
pause
