@echo off
rem BLOCKFIRE for Windows: opens the game in its own window (no tabs, no address bar).
rem Uses Microsoft Edge (built into Windows 10 and 11) or Google Chrome, and falls back to the default browser.
rem The flags ask for the fast graphics card (not the processor's built-in one) and allow WebGL on every card; the
rem game then picks its Ultra preset by itself on a desktop card. They only take effect when the browser was closed.
setlocal
set "GAME=%~dp0..\index.html"
set "URL=file:///%GAME:\=/%"
set "FLAGS=--force_high_performance_gpu --ignore-gpu-blocklist --enable-gpu-rasterization --start-maximized"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%EDGE%" start "" "%EDGE%" --app="%URL%" %FLAGS% & goto :eof
if exist "%CHROME%" start "" "%CHROME%" --app="%URL%" %FLAGS% & goto :eof
start "" "%GAME%"
