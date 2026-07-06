# Tai Node.js portable vao %LOCALAPPDATA% — khong can quyen admin
$ErrorActionPreference = "Stop"
$version = "22.16.0"
$nodeDir = Join-Path $env:LOCALAPPDATA "node-portable"
$extractDir = Join-Path $nodeDir "node-v$version-win-x64"
$zip = Join-Path $nodeDir "node-v$version-win-x64.zip"
$url = "https://nodejs.org/dist/v$version/node-v$version-win-x64.zip"

if (Test-Path (Join-Path $extractDir "node.exe")) {
    Write-Host "Portable Node da co tai: $extractDir"
    exit 0
}

New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
Write-Host "Dang tai Node.js v$version..."
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $nodeDir -Force
Remove-Item $zip -Force
Write-Host "Xong. Node tai: $extractDir"
