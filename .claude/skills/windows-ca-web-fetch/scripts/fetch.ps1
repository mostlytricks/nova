param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [string]$Method = "GET",
  [string]$CaCert,
  [string[]]$Header = @(),
  [string]$Cookie,
  [string]$CookieFile,
  [string]$CookieJar,
  [string]$Body,
  [string]$OutFile,
  [switch]$VerboseCurl
)

$ErrorActionPreference = "Stop"

$curl = Get-Command curl.exe -ErrorAction Stop
$args = @(
  "--fail-with-body",
  "--location",
  "--show-error",
  "--silent",
  "--request", $Method
)

if ($VerboseCurl) {
  $args = $args | Where-Object { $_ -ne "--silent" }
  $args += "--verbose"
}

if ($CaCert) {
  if (-not (Test-Path -LiteralPath $CaCert)) {
    throw "CA certificate not found: $CaCert"
  }
  $args += @("--cacert", $CaCert)
}

foreach ($h in $Header) {
  $args += @("--header", $h)
}

if ($Cookie) {
  $args += @("--cookie", $Cookie)
}

if ($CookieFile) {
  if (-not (Test-Path -LiteralPath $CookieFile)) {
    throw "Cookie file not found: $CookieFile"
  }
  $args += @("--cookie", $CookieFile)
}

if ($CookieJar) {
  $args += @("--cookie-jar", $CookieJar)
}

if ($Body) {
  $args += @("--data-raw", $Body)
}

if ($OutFile) {
  $parent = Split-Path -Parent $OutFile
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $args += @("--output", $OutFile)
}

$args += $Url

& $curl.Source @args
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  throw "curl.exe failed with exit code $exit"
}

if ($OutFile) {
  Write-Output "Saved response to $OutFile"
}
