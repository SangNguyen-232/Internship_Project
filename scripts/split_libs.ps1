# Split lib/ into lib_used/ and lib_unused/
# Usage: run in project root PowerShell: .\scripts\split_libs.ps1

$used = @("ArduinoJson","DHT20","LCD","ElegantOTA-master")
$unused = @("ArduinoHttpClient","PubSubClient","ThingsBoard","README")

# Create directories
$root = Get-Location
$lib = Join-Path $root "lib"
$libUsed = Join-Path $root "lib_used"
$libUnused = Join-Path $root "lib_unused"

if (-not (Test-Path $libUsed)) { New-Item -ItemType Directory -Path $libUsed | Out-Null }
if (-not (Test-Path $libUnused)) { New-Item -ItemType Directory -Path $libUnused | Out-Null }

# Move function with safety checks
function SafeMove([string]$name, [string]$destDir) {
    $src = Join-Path $lib $name
    if (Test-Path $src) {
        $dest = Join-Path $destDir $name
        if (Test-Path $dest) {
            Write-Host "Destination already exists: $dest - skipping move for $name" -ForegroundColor Yellow
        } else {
            Write-Host ("Moving {0} -> {1}" -f $src, $destDir)
            Move-Item -Path $src -Destination $destDir -Force
        }
    } else {
        Write-Host ("Not found: {0}" -f $src) -ForegroundColor Gray
    }
}

# Move used libs
foreach ($n in $used) { SafeMove $n $libUsed }

# Move unused libs
foreach ($n in $unused) { SafeMove $n $libUnused }

Write-Host "Done. Please run 'platformio run' to verify the project builds after the change." -ForegroundColor Green
Write-Host "If you need to undo, move folders from lib_used/lib_unused back into lib/ or use git to restore." -ForegroundColor Green
