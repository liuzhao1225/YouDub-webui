#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [string]$PythonRuntimeDirectory = "",
    [string]$NodeRuntimeDirectory = "",
    [string]$FfmpegDirectory = "",
    [int]$ApiPort = 8000,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AppRoot {
    if (Test-Path (Join-Path $PSScriptRoot "backend")) {
        return (Resolve-Path $PSScriptRoot).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Where-Object { $_.Name -ne ".git" } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

$appRoot = Get-AppRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $appRoot "dist\YouDub"
}
$releaseRoot = [IO.Path]::GetFullPath($OutputDirectory)

if ([IO.Path]::GetFullPath($releaseRoot) -eq [IO.Path]::GetFullPath($appRoot)) {
    throw "OutputDirectory must not be the repository root."
}
if ($ApiPort -lt 1 -or $ApiPort -gt 65535) {
    throw "ApiPort must be between 1 and 65535."
}
if (Test-Path $releaseRoot) {
    if (-not $Force) {
        throw "Output directory already exists. Use -Force to replace only that directory: $releaseRoot"
    }
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if ($null -eq $npmCommand) {
    throw "npm was not found. Install Node.js 20 or newer before building the package."
}

$demucsApi = Join-Path $appRoot "submodule\demucs\demucs\api.py"
if (-not (Test-Path $demucsApi)) {
    throw "Demucs submodule is missing. Run: git submodule update --init --recursive"
}

$webDirectory = Join-Path $appRoot "apps\web"
$nodeModules = Join-Path $webDirectory "node_modules"
if (-not (Test-Path $nodeModules)) {
    Invoke-Checked $npmCommand.Source @("--prefix", $webDirectory, "ci")
}
$previousApiTarget = [Environment]::GetEnvironmentVariable("NEXT_SERVER_API_BASE_URL", [EnvironmentVariableTarget]::Process)
$env:NEXT_SERVER_API_BASE_URL = "http://127.0.0.1:$ApiPort"
try {
    Invoke-Checked $npmCommand.Source @("--prefix", $webDirectory, "run", "build")
} finally {
    if ($null -eq $previousApiTarget) {
        Remove-Item Env:NEXT_SERVER_API_BASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:NEXT_SERVER_API_BASE_URL = $previousApiTarget
    }
}

$standaloneDirectory = Join-Path $webDirectory ".next\standalone"
$standaloneServer = Get-ChildItem -Path $standaloneDirectory -Filter "server.js" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $standaloneServer) {
    throw "Next standalone build did not produce server.js."
}

Copy-DirectoryContents (Join-Path $appRoot "backend") (Join-Path $releaseRoot "backend")
Copy-DirectoryContents (Join-Path $appRoot "submodule") (Join-Path $releaseRoot "submodule")
Copy-DirectoryContents $standaloneDirectory (Join-Path $releaseRoot "apps\web\.next\standalone")

$staticDirectory = Join-Path $webDirectory ".next\static"
if (-not (Test-Path $staticDirectory)) {
    throw "Next static assets are missing: $staticDirectory"
}
Copy-DirectoryContents $staticDirectory (Join-Path $releaseRoot "apps\web\.next\standalone\.next\static")

$publicDirectory = Join-Path $webDirectory "public"
if (Test-Path $publicDirectory) {
    Copy-DirectoryContents $publicDirectory (Join-Path $releaseRoot "apps\web\.next\standalone\public")
}

Copy-Item (Join-Path $appRoot "requirements.txt") (Join-Path $releaseRoot "requirements.txt") -Force
Copy-Item (Join-Path $appRoot "requirements-pytorch-cu128.txt") (Join-Path $releaseRoot "requirements-pytorch-cu128.txt") -Force
Copy-Item (Join-Path $appRoot "env.txt.example") (Join-Path $releaseRoot ".env.example") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\start-youdub.ps1") (Join-Path $releaseRoot "start-youdub.ps1") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\start-youdub.bat") (Join-Path $releaseRoot "start-youdub.bat") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\setup-youdub.ps1") (Join-Path $releaseRoot "setup-youdub.ps1") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\setup-youdub.bat") (Join-Path $releaseRoot "setup-youdub.bat") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\stop-youdub.ps1") (Join-Path $releaseRoot "stop-youdub.ps1") -Force
Copy-Item (Join-Path $appRoot "scripts\windows\stop-youdub.bat") (Join-Path $releaseRoot "stop-youdub.bat") -Force

if (-not [string]::IsNullOrWhiteSpace($PythonRuntimeDirectory)) {
    Copy-DirectoryContents $PythonRuntimeDirectory (Join-Path $releaseRoot "runtime\python")
}
if (-not [string]::IsNullOrWhiteSpace($NodeRuntimeDirectory)) {
    Copy-DirectoryContents $NodeRuntimeDirectory (Join-Path $releaseRoot "runtime\node")
}
if (-not [string]::IsNullOrWhiteSpace($FfmpegDirectory)) {
    $ffmpegExecutable = Join-Path $FfmpegDirectory "bin\ffmpeg.exe"
    $ffprobeExecutable = Join-Path $FfmpegDirectory "bin\ffprobe.exe"
    if (-not (Test-Path $ffmpegExecutable) -or -not (Test-Path $ffprobeExecutable)) {
        throw "FfmpegDirectory must contain bin\ffmpeg.exe and bin\ffprobe.exe."
    }
    Copy-DirectoryContents $FfmpegDirectory (Join-Path $releaseRoot "runtime\ffmpeg")
}

$manifest = [ordered]@{
    format = "youdub-windows-directory"
    frontend = "next-standalone"
    api_port = $ApiPort
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    bundled_python = (-not [string]::IsNullOrWhiteSpace($PythonRuntimeDirectory))
    bundled_node = (-not [string]::IsNullOrWhiteSpace($NodeRuntimeDirectory))
    bundled_ffmpeg = (-not [string]::IsNullOrWhiteSpace($FfmpegDirectory))
    first_run = "Run setup-youdub.bat, then start-youdub.bat."
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $releaseRoot "release-manifest.json") -Encoding UTF8

Write-Host "Windows package created: $releaseRoot" -ForegroundColor Green
if ([string]::IsNullOrWhiteSpace($PythonRuntimeDirectory) -or [string]::IsNullOrWhiteSpace($NodeRuntimeDirectory) -or [string]::IsNullOrWhiteSpace($FfmpegDirectory)) {
    Write-Warning "One or more runtimes were not bundled. The launcher will require system Python, Node.js, or FFmpeg."
}
Write-Host "Next step: run setup-youdub.bat in the package directory, then start-youdub.bat."
