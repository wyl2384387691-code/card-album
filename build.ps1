#requires -Version 5.1
param(
    [string]$Sdk = "",
    [string]$Jdk = "",
    [string]$VersionName = "0.6.0",
    [int]$VersionCode = 10
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not $Sdk) {
    if ($env:ANDROID_HOME) { $Sdk = $env:ANDROID_HOME }
    elseif (Test-Path "C:\Android\sdk\platforms\android-35\android.jar") { $Sdk = "C:\Android\sdk" }
    else { throw "Android SDK not found. Pass -Sdk or set ANDROID_HOME." }
}
if (-not $Jdk) {
    if (Test-Path "C:\develop\java\jdk17\bin\javac.exe") { $Jdk = "C:\develop\java\jdk17" }
    elseif ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\javac.exe")) { $Jdk = $env:JAVA_HOME }
    else { throw "JDK 17+ not found. Pass -Jdk or set JAVA_HOME." }
}

$androidJar = Join-Path $Sdk "platforms\android-35\android.jar"
$buildTools = Join-Path $Sdk "build-tools\35.0.0"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$aapt = Join-Path $buildTools "aapt.exe"
$d8 = Join-Path $buildTools "d8.bat"
$zipalign = Join-Path $buildTools "zipalign.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"
$javac = Join-Path $Jdk "bin\javac.exe"
$keytool = Join-Path $Jdk "bin\keytool.exe"
$jar = Join-Path $Jdk "bin\jar.exe"

foreach ($tool in @($androidJar, $aapt2, $aapt, $d8, $zipalign, $apksigner, $javac, $keytool, $jar)) {
    if (-not (Test-Path $tool)) { throw "Missing build tool: $tool" }
}

$env:JAVA_HOME = $Jdk
$env:Path = (Join-Path $Jdk "bin") + ";" + $buildTools + ";" + $env:Path

$build = Join-Path $root "build"
$dist = Join-Path $root "dist"
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build, (Join-Path $build "gen"), (Join-Path $build "classes"), (Join-Path $build "dex"), $dist | Out-Null

Write-Host "==> Compiling resources"
$aapt2Args = @("compile", "--dir", "res", "-o", (Join-Path $build "res.zip"))
& $aapt2 @aapt2Args
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

Write-Host "==> Linking resources and assets"
$aapt2LinkArgs = @(
    "link",
    "-o", (Join-Path $build "unsigned.apk"),
    "-I", $androidJar,
    "--manifest", "AndroidManifest.xml",
    "-A", "assets",
    "--java", (Join-Path $build "gen"),
    "--min-sdk-version", "24",
    "--target-sdk-version", "34",
    "--version-code", "$VersionCode",
    "--version-name", $VersionName,
    "--auto-add-overlay",
    (Join-Path $build "res.zip")
)
& $aapt2 @aapt2LinkArgs
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

Write-Host "==> Compiling Java"
$sources = @()
$sources += Get-ChildItem -Path (Join-Path $root "src") -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
$sources += Get-ChildItem -Path (Join-Path $build "gen") -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
& $javac --release 8 -encoding UTF-8 -classpath $androidJar -d (Join-Path $build "classes") @sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

Write-Host "==> Dexing"
& $jar --create --file (Join-Path $build "classes.jar") -C (Join-Path $build "classes") .
if ($LASTEXITCODE -ne 0) { throw "jar failed" }
& $d8 --release --lib $androidJar --min-api 24 --output (Join-Path $build "dex") (Join-Path $build "classes.jar")
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

Write-Host "==> Packaging classes.dex"
Push-Location (Join-Path $build "dex")
try {
    & $aapt add (Join-Path $build "unsigned.apk") "classes.dex"
    if ($LASTEXITCODE -ne 0) { throw "aapt add failed" }
} finally {
    Pop-Location
}

Write-Host "==> Aligning"
& $zipalign -f -p 4 (Join-Path $build "unsigned.apk") (Join-Path $build "aligned.apk")
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$keystore = Join-Path $root "keystore.jks"
$storePass = "cardalbum2026"
$keyAlias = "cardalbum"
if (-not (Test-Path $keystore)) {
    Write-Host "==> Creating signing key"
    & $keytool -genkeypair -keystore $keystore -storepass $storePass -keypass $storePass `
        -alias $keyAlias -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=Card Album, OU=Personal, O=CardAlbum, L=Shanghai, C=CN"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

$final = Join-Path $dist ("CardAlbum-v" + $VersionName + ".apk")
Write-Host "==> Signing"
& $apksigner sign --ks $keystore --ks-key-alias $keyAlias --ks-pass ("pass:" + $storePass) `
    --key-pass ("pass:" + $storePass) --v1-signing-enabled true --v2-signing-enabled true `
    --v3-signing-enabled true --out $final (Join-Path $build "aligned.apk")
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

Write-Host "==> Verifying"
& $apksigner verify --verbose --print-certs $final
if ($LASTEXITCODE -ne 0) { throw "signature verification failed" }
& $aapt dump badging $final | Select-Object -First 5

$hash = (Get-FileHash -Algorithm SHA256 $final).Hash
$size = (Get-Item $final).Length
Write-Host ""
Write-Host "APK: $final"
Write-Host ("Size: {0:N0} bytes" -f $size)
Write-Host "SHA256: $hash"
