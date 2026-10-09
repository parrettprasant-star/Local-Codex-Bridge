param(
    [string]$ReadyUrl,
    [string]$StatusUrl,
    [string]$StatusPageUrl,
    [string]$ProfileName,
    [string]$TunnelExecutable,
    [string]$RuntimeKeyFile,
    [string]$LogDirectory,
    [string]$ProjectionPath,
    [string]$CheckpointDirectory
)

$canonicalImplementation = Join-Path $PSScriptRoot 'LocalCodexBridgeTray.ps1'
& $canonicalImplementation @PSBoundParameters
if ($null -ne $LASTEXITCODE) {
    exit $LASTEXITCODE
}
