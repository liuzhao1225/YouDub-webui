#requires -Version 5.1

[CmdletBinding()]
param(
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

Stop-PortProcess $WebPort
Stop-PortProcess $ApiPort
