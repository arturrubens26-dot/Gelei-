@echo off
rem Liga o banco de dados local e o site da Geleio e abre o navegador.
rem Dois cliques neste arquivo. Para desligar, use parar.bat.
setlocal
cd /d "%~dp0"

echo.
echo === Geleio: iniciando ===
echo.
echo [1/3] Ligando o banco de dados local...
rem Desliga antes, se ja estiver ligado: o banco embutido perde uma das suas 10 "vagas" de conexao
rem cada vez que o site e fechado no meio de uma consulta, e religar devolve todas. Os dados ficam.
call npx prisma dev stop geleio >nul 2>&1
rem Logo depois de desligar (aqui ou no parar.bat), a trava da pasta de dados leva de 15 segundos
rem a 1 minuto para soltar ("Lock file is already being held"): tenta de novo a cada 15 segundos.
set TENTATIVAS=0
:ligar_banco
call npx prisma dev --name geleio --detach --port 51213 --db-port 51214 --shadow-db-port 51215
if not errorlevel 1 goto banco_ligado
set /a TENTATIVAS+=1
if %TENTATIVAS% geq 6 goto banco_falhou
echo O banco ainda esta se desligando (pode levar ate 1 minuto); tentando de novo em 15 segundos...
timeout /t 15 /nobreak >nul
goto ligar_banco
:banco_falhou
echo.
echo Nao foi possivel ligar o banco de dados. Feche esta janela e de dois cliques em iniciar.bat de novo.
pause
exit /b 1
:banco_ligado

echo.
echo [2/3] Ligando o site (uma nova janela vai abrir; deixe-a aberta)...
start "Geleio - Site (feche esta janela para desligar o site)" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo [3/3] Abrindo o navegador em instantes...
timeout /t 15 /nobreak >nul
start "" http://localhost:3000

echo.
echo Pronto! Se a pagina demorar, aguarde: na primeira visita o site leva uns 30 segundos.
echo Login do admin: veja o arquivo ACESSO-LOCAL.txt
echo.
pause
