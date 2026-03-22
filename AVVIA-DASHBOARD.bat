@echo off
title Scalping Dashboard
color 0A
echo.
echo  ================================================
echo   SCALPING DASHBOARD - Avvio in corso...
echo  ================================================
echo.

:: Vai nella cartella del progetto (stessa cartella del .bat)
cd /d "%~dp0"

:: Controlla se Node.js e' installato
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  ERRORE: Node.js non trovato!
    echo  Scaricalo da https://nodejs.org
    pause
    exit /b
)

:: Controlla se le dipendenze sono installate
if not exist "node_modules" (
    echo  Prima installazione - scarico dipendenze...
    npm install
    echo.
)

:: Apri il browser dopo 3 secondi
echo  Apertura browser tra 3 secondi...
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: Avvia il server
echo  Server avviato! Puoi chiudere questa finestra per fermarlo.
echo  ================================================
echo.
npm start

:: Se il server si ferma, mostra messaggio
echo.
echo  Server fermato. Premi un tasto per chiudere.
pause >nul
