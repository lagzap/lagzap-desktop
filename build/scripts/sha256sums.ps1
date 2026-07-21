param(
    [Parameter(Mandatory = $true)][string]$BinDir,
    [Parameter(Mandatory = $true)][string]$AppName,
    [Parameter(Mandatory = $true)][string]$Arch
)

$ErrorActionPreference = "Stop"
$files = @(
    Join-Path $BinDir "$AppName-windows-$Arch.zip"
    Join-Path $BinDir "$AppName-windows-$Arch-setup.exe"
)
$out = Join-Path $BinDir "SHA256SUMS"
$lines = @()
foreach ($f in $files) {
    if (-not (Test-Path $f)) {
        Write-Error "Missing artifact: $f"
    }
    $hash = (Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLowerInvariant()
    $name = Split-Path $f -Leaf
    $lines += "$hash  $name"
}
$lines | Set-Content -Path $out -Encoding ascii
Write-Host "Wrote $out"
