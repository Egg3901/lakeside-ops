[CmdletBinding()]
param([switch]$Preview)
$ErrorActionPreference = 'Stop'

$package = Join-Path $PSScriptRoot 'lakesidegamedev-code-0.1.1.tgz'
if (-not (Test-Path -LiteralPath $package)) { throw 'Keep this installer beside the bundled .tgz package.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12 or later for Windows, then run this installer again.' }
$nodeVersion = (& node --version).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') { throw 'Lakeside Code requires Node.js 22.12 or later.' }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
& $npm install --global $package --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Package installation failed. Check the npm output above.' }
$prefix = (& $npm prefix --global | Select-Object -Last 1).Trim()
$launcher = Join-Path $prefix 'lakeside.cmd'
& $launcher code doctor
if ($LASTEXITCODE -ne 0) { throw 'The startup check failed. Keep the doctor output for diagnosis.' }
Write-Host "Installed Lakeside Code. Start coding with: lakeside code C:\path\to\project"
Write-Host 'Use /connect for your model provider. Keir skills, including Ponytail, are built in.'
if ($Preview) { & $launcher code --preview }
