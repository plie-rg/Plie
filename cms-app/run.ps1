param([int]$Port = 8766, [switch]$Open)
$ErrorActionPreference = 'Stop'
$cmsRoot = $PSScriptRoot
$cmsWorkspace = Split-Path (Split-Path $cmsRoot -Parent) -Parent
$cmsPython = Join-Path $cmsWorkspace '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $cmsPython)) { $cmsPython = (Get-Command python -ErrorAction Stop).Source }
$cmsUrl = "http://127.0.0.1:$Port"
$cmsData = Join-Path $cmsRoot 'data'
New-Item -ItemType Directory -Path $cmsData -Force | Out-Null
$cmsRunning = $false
try {
    $cmsStatus = Invoke-RestMethod -Uri "$cmsUrl/api/session" -TimeoutSec 2
    $cmsRunning = ($cmsStatus.app -eq 'plie-content-cms')
} catch {}
if (-not $cmsRunning) {
    $cmsProcess = Start-Process -FilePath $cmsPython -ArgumentList @(('"{0}"' -f (Join-Path $cmsRoot 'app.py')), '--port', [string]$Port) -WorkingDirectory $cmsRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $cmsData 'server.out.log') -RedirectStandardError (Join-Path $cmsData 'server.err.log') -PassThru
    Set-Content -LiteralPath (Join-Path $cmsData 'server.pid') -Value $cmsProcess.Id -Encoding ascii
    for ($cmsAttempt=0; $cmsAttempt -lt 30; $cmsAttempt++) {
        Start-Sleep -Milliseconds 200
        try { $cmsStatus = Invoke-RestMethod -Uri "$cmsUrl/api/session" -TimeoutSec 2; $cmsRunning=($cmsStatus.app -eq 'plie-content-cms'); if ($cmsRunning) { break } } catch {}
        if ($cmsProcess.HasExited) { break }
    }
    if (-not $cmsRunning) { throw 'CMS 실행에 실패했습니다. cms-app/data/server.err.log를 확인해 주세요.' }
}
$cmsOpenUrl = "$cmsUrl/cms/"
$cmsSetupFile = Join-Path $cmsData '.setup-key'
if (-not $cmsStatus.configured -and (Test-Path -LiteralPath $cmsSetupFile)) {
    $cmsSetupKey = (Get-Content -LiteralPath $cmsSetupFile -Raw).Trim()
    $cmsOpenUrl += '#setup=' + [Uri]::EscapeDataString($cmsSetupKey)
}
Write-Output "Plie CMS: $cmsUrl/cms/"
Write-Output "Homepage preview: $cmsUrl/index.html"
if ($Open) { Start-Process -FilePath $cmsOpenUrl }
