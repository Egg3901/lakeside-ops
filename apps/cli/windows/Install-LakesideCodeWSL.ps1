[CmdletBinding()]
param([string]$Distro = 'Ubuntu', [switch]$Preview)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'Install WSL2 with Ubuntu first: wsl --install -d Ubuntu. Restart Windows if requested, then rerun.' }
$package = Join-Path $PSScriptRoot 'lakesidegamedev-code-0.1.2.tgz'
if (-not (Test-Path -LiteralPath $package)) { throw 'Keep this installer beside the bundled .tgz package.' }
$linuxPackage = & wsl.exe -d $Distro -- wslpath -a $package
if ($LASTEXITCODE -ne 0) { throw "Could not open WSL distro '$Distro'. Run wsl --install -d Ubuntu, complete its first-run setup, then rerun." }
$installer = Join-Path $PSScriptRoot 'Install-LakesideCodeWSL.sh'
$linuxInstaller = & wsl.exe -d $Distro -- wslpath -a $installer
if ($LASTEXITCODE -ne 0) { throw 'Could not find the bundled WSL installer.' }
$mode = if ($Preview) { 'preview' } else { 'install' }
& wsl.exe -d $Distro -- bash $linuxInstaller.Trim() $linuxPackage.Trim() $mode
if ($LASTEXITCODE -ne 0) { throw 'WSL installation failed. Check the output above.' }
