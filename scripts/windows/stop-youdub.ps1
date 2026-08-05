#requires -Version 5.1

[CmdletBinding()]
param(
    [int]$ApiPort = 0,
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AppRoot {
    if (Test-Path (Join-Path $PSScriptRoot "backend")) {
        return (Resolve-Path $PSScriptRoot).Path
    }
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Stop-PortProcess {
    param([Parameter(Mandatory = $true)][int]$Port)

    $connections = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            Stop-Process -Id $process.Id -Force
            Write-Host "Stopped $($process.ProcessName) on port $Port."
        }
    }
}

if ($ApiPort -eq 0) {
    $ApiPort = 8000
    $manifestPath = Join-Path (Get-AppRoot) "release-manifest.json"
    if (Test-Path $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($null -ne $manifest.api_port) {
            $ApiPort = [int]$manifest.api_port
        }
    }
}

Stop-PortProcess $WebPort
Stop-PortProcess $ApiPort
