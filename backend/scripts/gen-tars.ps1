# Generate TARS Node.js bindings for CCS agent integration.
$ErrorActionPreference = "Stop"
# PSScriptRoot = <repo>\OmniAgent\backend\scripts → 上移 3 层到仓库根 <repo>
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$Include = Join-Path $Root "Include\tars"
$Out = Join-Path $Root "OmniAgent\backend\src\integrations\ccs\tars"
$AiqcOut = Join-Path $Root "OmniAgent\backend\src\integrations\aiqc\tars"
$AsrOut = Join-Path $Root "OmniAgent\backend\src\integrations\asr\tars"
$T2N = "C:\tars\cpp\tools\tars2node.exe"

if (-not (Test-Path $T2N)) {
    Write-Error "tars2node not found at $T2N"
}
if (-not (Test-Path $Include)) {
    Write-Error "TARS include dir not found at $Include"
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
New-Item -ItemType Directory -Force -Path $AiqcOut | Out-Null
New-Item -ItemType Directory -Force -Path $AsrOut | Out-Null

& $T2N --include=$Include --dir=$Out --r "$Include\base.tars" "$Include\agent_struct.tars"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $T2N --include=$Include --dir=$Out --client --r "$Include\ccs.tars"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $T2N --include=$Include --dir=$Out --server --r "$Include\agent.tars"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $T2N --include=$Include --dir=$AiqcOut --client --r "$Include\aiqc.tars"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $T2N --include=$Include --dir=$AsrOut --client --r "$Include\asr.tars"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "TARS codegen written to $Out"
