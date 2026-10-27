$ErrorActionPreference = "Stop"

$ProjectPath = "C:\Users\rovax\Documents\github\ctrl-b"
$SessionName = "ctrl-b (opus)"
$Model = "opus"    # resolves through THIS machine's ~/.claude/settings.json env.ANTHROPIC_DEFAULT_OPUS_MODEL (the owner-tested pin, ISS-100; Opus 5.5 as of 2026-09-23 = the workforce seat, Fable = the main seat); a missing key floats to Claude Code's latest Opus
$Effort = "high"
$PermissionMode = "bypassPermissions"

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "Claude Code CLI not found in PATH." -ForegroundColor Red
    Write-Host "Install it first with:"
    Write-Host 'irm https://claude.ai/install.ps1 | iex' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $ProjectPath)) {
    Write-Host "Project folder not found: $ProjectPath" -ForegroundColor Red
    exit 1
}

Set-Location $ProjectPath

Write-Host "Starting Claude Code Remote Control for:" -ForegroundColor Cyan
Write-Host $ProjectPath
Write-Host ""
Write-Host "Permission mode: $PermissionMode"
Write-Host "Model: $Model"
Write-Host "Effort: $Effort"
Write-Host "Remote UI: https://claude.ai/code"
Write-Host ""

$ClaudeArgs = @(
  "--remote-control", $SessionName,
  "--permission-mode", $PermissionMode,
  "--model", $Model,
  "--effort", $Effort
)

& claude @ClaudeArgs
