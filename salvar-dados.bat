@echo off
rem Salva uma copia dos dados na pasta dados, com historico num Git so deste computador.
rem Dois cliques neste arquivo. O parar.bat tambem salva o banco local antes de desligar.
setlocal
cd /d "%~dp0"

echo.
echo === Geleio: salvar dados ===
echo.
echo [1/2] Banco deste computador...
node scripts\dados.mjs salvar --commit

echo.
if exist .env.producao (
  echo [2/2] Banco do site no ar...
  node scripts\dados.mjs salvar --producao --commit
) else (
  echo [2/2] Site no ar: ainda nao configurado ^(falta o arquivo .env.producao^).
)

echo.
echo As copias ficam na pasta dados. Historico: git -C dados log --oneline
echo.
pause
