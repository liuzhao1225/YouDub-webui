#requires -Version 5.1

[CmdletBinding()]
param()

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

function Get-PythonInvocation {
    param([Parameter(Mandatory = $true)][string]$Root)

    $bundled = Join-Path $Root "runtime\python\python.exe"
    if (Test-Path $bundled -PathType Leaf) {
        return @($bundled)
    }

    $venv = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $venv -PathType Leaf) {
        return @($venv)
    }

    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        return @($launcher.Source, "-3.12")
    }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -ne $python) {
        return @($python.Source)
    }
    throw "Python 3.12 was not found. Install it or provide runtime\python\python.exe."
}

function Get-NodeCommand {
    param([Parameter(Mandatory = $true)][string]$Root)

    $bundled = Join-Path $Root "runtime\node\node.exe"
    if (Test-Path $bundled) {
        return $bundled
    }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -ne $node) {
        return $node.Source
    }
    return $null
}

function Assert-Python312 {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    $versionArguments = $Arguments + @("--version")
    $version = (& $Command @versionArguments 2>&1 | Out-String).Trim()
    if ($version -notmatch "Python 3\.12(?:\.|$)") {
        throw "Python 3.12 is required, but this interpreter reported: $version"
    }
}

function Assert-Node20 {
    param([Parameter(Mandatory = $true)][string]$Command)

    $version = (& $Command --version 2>&1 | Out-String).Trim()
    if ($version -notmatch "^v(2[0-9]|[3-9][0-9])\.") {
        throw "Node.js 20 or newer is required, but this interpreter reported: $version"
    }
}

$appRoot = Get-AppRoot
$bundledPythonPath = Join-Path $appRoot "runtime\python\python.exe"
$bundledPythonRuntime = Test-Path $bundledPythonPath
$pythonInvocation = @(Get-PythonInvocation $appRoot)
$pythonCommand = $pythonInvocation[0]
$pythonArguments = @()
if ($pythonInvocation.Count -gt 1) {
    $pythonArguments = @($pythonInvocation[1..($pythonInvocation.Count - 1)])
}

$venvRoot = Join-Path $appRoot ".venv"
$runtimePython = Join-Path $venvRoot "Scripts\python.exe"
if (-not (Test-Path $runtimePython -PathType Leaf) -and $pythonCommand -notlike "*\runtime\python\python.exe") {
    if (Test-Path $runtimePython -PathType Container) {
        # Earlier releases passed the interpreter path to "python -m venv" and created a
        # directory here. Remove it so venv can write the real python.exe.
        Remove-Item -LiteralPath $runtimePython -Recurse -Force
    }
    Invoke-Checked $pythonCommand ($pythonArguments + @("-m", "venv", $venvRoot))
    if (-not (Test-Path $runtimePython -PathType Leaf)) {
        throw "Virtual environment creation did not produce: $runtimePython"
    }
    $pythonCommand = $runtimePython
    $pythonArguments = @()
}
Assert-Python312 $pythonCommand $pythonArguments

if ($bundledPythonRuntime) {
    Write-Host "Bundled Python runtime detected; skipping pip installation." -ForegroundColor DarkGray
} else {
    $pipBase = $pythonArguments + @("-m", "pip", "install", "-U", "pip")
    Invoke-Checked $pythonCommand $pipBase
    Invoke-Checked $pythonCommand ($pythonArguments + @("-m", "pip", "install", "-r", (Join-Path $appRoot "requirements-pytorch-cu128.txt")))
    Invoke-Checked $pythonCommand ($pythonArguments + @("-m", "pip", "install", "-r", (Join-Path $appRoot "requirements.txt")))
}

$nodeCommand = Get-NodeCommand $appRoot
if ($null -eq $nodeCommand) {
    throw "Node.js 20 or newer was not found. Install it or provide runtime\node\node.exe."
}
Assert-Node20 $nodeCommand

$webDirectory = Join-Path $appRoot "apps\web"
$webPackageJson = Join-Path $webDirectory "package.json"
if (Test-Path $webPackageJson) {
    $npmCommand = Join-Path (Split-Path $nodeCommand -Parent) "npm.cmd"
    if (-not (Test-Path $npmCommand)) {
        $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($null -eq $systemNpm) {
            throw "npm.cmd was not found next to bundled Node.js or on PATH."
        }
        $npmCommand = $systemNpm.Source
    }
    Invoke-Checked $npmCommand @("--prefix", $webDirectory, "ci")
    Invoke-Checked $npmCommand @("--prefix", $webDirectory, "run", "build")
} else {
    $standaloneServer = Get-ChildItem -Path (Join-Path $webDirectory ".next\standalone") -Filter "server.js" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $standaloneServer) {
        throw "Frontend source or a prebuilt Next standalone server is required."
    }
    Write-Host "Prebuilt Next standalone server detected; skipping frontend dependency installation." -ForegroundColor DarkGray
}

$ffmpegDirectory = Join-Path $appRoot "runtime\ffmpeg\bin"
$bundledFfmpeg = Test-Path (Join-Path $ffmpegDirectory "ffmpeg.exe")
$bundledFfprobe = Test-Path (Join-Path $ffmpegDirectory "ffprobe.exe")
if (-not $bundledFfmpeg -or -not $bundledFfprobe) {
    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    $ffprobeCommand = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
    if ($null -eq $ffmpegCommand -or $null -eq $ffprobeCommand) {
        throw "FFmpeg and ffprobe were not found. Put them in runtime\ffmpeg\bin or install a shared FFmpeg build."
    }
}

$envFile = Join-Path $appRoot ".env"
if (-not (Test-Path $envFile)) {
    $example = Join-Path $appRoot ".env.example"
    if (-not (Test-Path $example)) {
        $example = Join-Path $appRoot "env.txt.example"
    }
    Copy-Item $example $envFile -Force
}

$envContent = Get-Content -LiteralPath $envFile -Raw
$existingHash = [regex]::Match($envContent, "(?m)^YOUDUB_AUTH_PASSWORD_HASH=(.*)$")
if (-not $existingHash.Success -or [string]::IsNullOrWhiteSpace($existingHash.Groups[1].Value)) {
    Write-Host "Create the local YouDub login password." -ForegroundColor Cyan
    $hashArguments = $pythonArguments + @(
        "-c",
        "from getpass import getpass; from pwdlib import PasswordHash; print(PasswordHash.recommended().hash(getpass('YouDub password: ')))"
    )
    $hashOutput = & $pythonCommand @hashArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Could not generate the authentication hash."
    }
    $hash = ($hashOutput -join "").Trim()
    if ([string]::IsNullOrWhiteSpace($hash)) {
        throw "Authentication hash generation returned an empty value."
    }
    $hashLine = "YOUDUB_AUTH_PASSWORD_HASH=$hash"
    $rewritten = New-Object Collections.Generic.List[string]
    $applied = $false
    foreach ($line in @($envContent -split "\r?\n")) {
        if ($line -match "^YOUDUB_AUTH_PASSWORD_HASH=") {
            if (-not $applied) {
                $rewritten.Add($hashLine)
                $applied = $true
            }
            continue
        }
        $rewritten.Add($line)
    }
    if (-not $applied) {
        while ($rewritten.Count -gt 0 -and [string]::IsNullOrWhiteSpace($rewritten[$rewritten.Count - 1])) {
            $rewritten.RemoveAt($rewritten.Count - 1)
        }
        $rewritten.Add($hashLine)
    }
    $envContent = ($rewritten -join "`r`n").TrimEnd() + "`r`n"
    [IO.File]::WriteAllText($envFile, $envContent, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
}

Write-Host "YouDub dependencies and local configuration are ready." -ForegroundColor Green
Write-Host "Run start-youdub.bat to start the local web console."
