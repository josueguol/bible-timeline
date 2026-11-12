[CmdletBinding()]
param([switch]$RemoveData)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "scripts\Invoke-BibleTimelineCompose.ps1") -Environment dev -Action down -RemoveData:$RemoveData
