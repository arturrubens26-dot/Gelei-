@echo off
rem Volta o banco DESTE COMPUTADOR para a ultima copia salva (dados\local.json).
rem Para o site no ar, ou para uma copia mais antiga, peca ajuda: e uma troca de todos os dados.
setlocal
cd /d "%~dp0"

echo.
echo === Geleio: restaurar o banco deste computador ===
echo.
echo Isto TROCA todos os dados do banco local (pedidos, despesas, producao, clientes)
echo pelos da ultima copia salva em dados\local.json.
echo Antes, os dados atuais sao guardados em dados\copias-de-seguranca.
echo.
set /p RESPOSTA=Para continuar, digite SIM e aperte Enter:
if /i not "%RESPOSTA%"=="SIM" (
  echo Nada foi alterado.
  echo.
  pause
  exit /b 0
)
node scripts\dados.mjs restaurar dados\local.json --confirmar

echo.
pause
