@echo off
rem BLOCKFIRE for Windows: opens the game in its own window (no tabs, no address bar).
rem Uses Microsoft Edge (built into Windows 10 and 11) or Google Chrome, and falls back to the default browser.
rem The flags ask for the fast graphics card (not the processor's built-in one) and allow WebGL on every card; the
rem game then picks its Epic or Ultra preset by itself on a desktop card. They only take effect when the browser was closed.
setlocal EnableDelayedExpansion
rem the game folder (one up from this one), as a full path, then as a file:// address with forward slashes and no spaces
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "GAME=%ROOT%\index.html"
set "URL=file:///%GAME:\=/%"
set "URL=!URL: =%%20!"
set "FLAGS=--force_high_performance_gpu --ignore-gpu-blocklist --enable-gpu-rasterization --start-maximized"
set "B1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "B2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "B3=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "B4=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "B5=%LocalAppData%\Google\Chrome\Application\chrome.exe"
for %%B in ("!B1!" "!B2!" "!B3!" "!B4!" "!B5!") do (
  if exist "%%~B" (
    start "" "%%~B" --app="!URL!" %FLAGS%
    goto :eof
  )
)
start "" "%GAME%"
