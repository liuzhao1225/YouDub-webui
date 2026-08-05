#requires -Version 5.1

[CmdletBinding()]
param(
    [int]$ApiPort = 0,
    [int]$WebPort = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AppRoot {
    if (Test-Path (Join-Path $PSScriptRoot "backend")) {
        return (Resolve-Path $PSScriptRoot).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Test-PortOpen {
    param([Parameter(Mandatory = $true)][int]$Port)

    $client = New-Object Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        return $result.AsyncWaitHandle.WaitOne(250) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-Port {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$Name
    )

    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($Process.HasExited) {
            throw "$Name exited before port $Port became available. See data\logs for details."
        }
        if (Test-PortOpen $Port) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not become available on port $Port. See data\logs for details."
}

function Quote-ProcessArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

$appRoot = Get-AppRoot
$manifestPath = Join-Path $appRoot "release-manifest.json"
$builtApiPort = 8000
if (Test-Path $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($null -ne $manifest.api_port) {
        $builtApiPort = [int]$manifest.api_port
    }
}
if ($ApiPort -eq 0) {
    $ApiPort = $builtApiPort
} elseif ($ApiPort -ne $builtApiPort) {
    throw "This frontend was built to proxy the API on port $builtApiPort. Rebuild the package with -ApiPort $ApiPort before using another API port."
}
if ($ApiPort -lt 1 -or $ApiPort -gt 65535 -or $WebPort -lt 1 -or $WebPort -gt 65535) {
    throw "ApiPort and WebPort must be between 1 and 65535."
}
if ($ApiPort -eq $WebPort) {
    throw "ApiPort and WebPort must be different."
}
$envFile = Join-Path $appRoot ".env"
if (-not (Test-Path $envFile)) {
    throw "Missing .env. Run setup-youdub.bat once before starting the app."
}

$pythonCommand = Join-Path $appRoot "runtime\python\python.exe"
$pythonArguments = @()
if (-not (Test-Path $pythonCommand)) {
    $pythonCommand = Join-Path $appRoot ".venv\Scripts\python.exe"
}
if (-not (Test-Path $pythonCommand)) {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        $pythonCommand = $launcher.Source
        $pythonArguments = @("-3.12")
    } else {
        $python = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($null -eq $python) {
            throw "Python 3.12 was not found. Run setup-youdub.bat or install Python."
        }
        $pythonCommand = $python.Source
    }
}

$nodeCommand = Join-Path $appRoot "runtime\node\node.exe"
if (-not (Test-Path $nodeCommand)) {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $node) {
        throw "Node.js 20 or newer was not found. Install it or provide runtime\node\node.exe."
    }
    $nodeCommand = $node.Source
}

$standaloneRoot = Join-Path $appRoot "apps\web\.next\standalone"
$server = Get-ChildItem -Path $standaloneRoot -Filter "server.js" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $server) {
    throw "Next standalone server is missing. Run setup-youdub.bat or build-package.ps1 first."
}

$ffmpegBin = Join-Path $appRoot "runtime\ffmpeg\bin"
$bundledFfmpeg = Test-Path (Join-Path $ffmpegBin "ffmpeg.exe")
$bundledFfprobe = Test-Path (Join-Path $ffmpegBin "ffprobe.exe")
if ($bundledFfmpeg -and $bundledFfprobe) {
    $env:FFMPEG_PATH = Join-Path $ffmpegBin "ffmpeg.exe"
    $env:FFPROBE_PATH = Join-Path $ffmpegBin "ffprobe.exe"
    $env:PATH = "$ffmpegBin;$env:PATH"
} else {
    if ($bundledFfmpeg -or $bundledFfprobe) {
        throw "Bundled FFmpeg is incomplete. Provide both runtime\ffmpeg\bin\ffmpeg.exe and ffprobe.exe."
    }
    if ($null -eq (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or $null -eq (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
        throw "FFmpeg and ffprobe were not found. Install them or provide runtime\ffmpeg\bin."
    }
}

if (Test-PortOpen $ApiPort) {
    throw "API port $ApiPort is already in use. Stop the existing service or choose -ApiPort."
}
if (Test-PortOpen $WebPort) {
    throw "Web port $WebPort is already in use. Stop the existing service or choose -WebPort."
}

$logDirectory = Join-Path $appRoot "data\logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$backendOut = Join-Path $logDirectory "windows-backend.out.log"
$backendErr = Join-Path $logDirectory "windows-backend.err.log"
$webOut = Join-Path $logDirectory "windows-web.out.log"
$webErr = Join-Path $logDirectory "windows-web.err.log"

$env:NEXT_SERVER_API_BASE_URL = "http://127.0.0.1:$ApiPort"
$env:HOSTNAME = "127.0.0.1"
$env:PORT = "$WebPort"
$env:PYTHONUNBUFFERED = "1"

$backendArguments = $pythonArguments + @(
    "-m", "uvicorn", "backend.app.main:app",
    "--host", "127.0.0.1", "--port", "$ApiPort"
)
$webArguments = @(
    (Quote-ProcessArgument $server.FullName)
)

$processes = @()
try {
    $backend = Start-Process -FilePath $pythonCommand -ArgumentList $backendArguments -WorkingDirectory $appRoot -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -PassThru
    $processes += $backend
    Wait-Port $ApiPort $backend "FastAPI"

    $web = Start-Process -FilePath $nodeCommand -ArgumentList $webArguments -WorkingDirectory $server.DirectoryName -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
    $processes += $web
    Wait-Port $WebPort $web "Next.js"

    Write-Host "YouDub is running at http://127.0.0.1:$WebPort" -ForegroundColor Green
    Write-Host "Backend log: $backendOut"
    Write-Host "Web log:     $webOut"
    if (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:$WebPort"
    }
    Wait-Process -Id $web.Id
} finally {
    foreach ($process in $processes) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
