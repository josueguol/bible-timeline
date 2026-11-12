[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$NoWait
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "scripts\Invoke-BibleTimelineCompose.ps1") -Environment dev -Action up -NoBuild:$NoBuild -NoWait:$NoWait
