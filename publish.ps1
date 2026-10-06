<#
.SYNOPSIS
  Build, test, and publish a LightSage release to GitHub.

.DESCRIPTION
  Checks that the committed version is new and the Git tree is clean, runs
  the simulated tests, builds the NSIS installer, tests the packaged app,
  checks the build for credentials, pushes the current commit and version
  tag, then creates a public GitHub release with the installer. The app's
  updater reads releases/latest. After the new release is confirmed live,
  older releases and their tags are deleted, as in the other Sage apps.

  Set the version first and commit it:
    npm version patch --no-git-tag-version
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Invoke-Native {
  <#
  .SYNOPSIS
    Run a native command (git, gh, npm, node) safely under Windows PowerShell 5.1.

  .DESCRIPTION
    Windows PowerShell 5.1 turns a native command's stderr output into
    errors when the host is not a console. With $ErrorActionPreference set
    to Stop, the first stderr line would abort the script even when the
    command succeeded. This wrapper fails on the exit code instead.
  #>
  param(
    [Parameter(Mandatory = $true, Position = 0)] [scriptblock] $Command,
    [string] $FailureMessage,
    [switch] $AllowFailure
  )
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $global:LASTEXITCODE = 0
  try { & $Command }
  finally { $ErrorActionPreference = $previousPreference }
  if (-not $AllowFailure -and $LASTEXITCODE -ne 0) {
    if (-not $FailureMessage) { $FailureMessage = "Command failed with exit code ${LASTEXITCODE}: $Command" }
    throw $FailureMessage
  }
}

function Read-Version {
  <#
  .SYNOPSIS
    Read the first "version" value. Windows PowerShell 5.1 cannot parse
    package-lock.json with ConvertFrom-Json (it has an empty key), so use
    a text match.
  #>
  param([string] $Path)
  $match = [regex]::Match((Get-Content $Path -Raw), '(?m)"version"\s*:\s*"([^"]+)"')
  if (-not $match.Success) { throw "Could not read version from $Path" }
  return $match.Groups[1].Value
}

$version = Read-Version "package.json"
$lockVersion = Read-Version "package-lock.json"
if ($lockVersion -ne $version) { throw "Version mismatch: package.json=$version, package-lock.json=$lockVersion. Run npm version $version --no-git-tag-version --allow-same-version." }
$tag = "v$version"
$assetName = "LightSage-Setup-$version.exe"
$assetPath = "dist/$assetName"

$builder = Get-Content "electron-builder.json" -Raw | ConvertFrom-Json
if ($builder.win.artifactName -ne 'LightSage-Setup-${version}.${ext}') { throw "electron-builder.json win.artifactName must stay LightSage-Setup-`${version}.`${ext}; the updater looks for that name." }
if (@($builder.files) -notcontains "desktop/updater.cjs") { throw "electron-builder.json must package desktop/updater.cjs." }

$dirtyFiles = Invoke-Native -FailureMessage "Could not read the Git working tree status." { git status --porcelain }
if ($dirtyFiles) { throw "The working tree must be clean before publishing. Commit the version change first." }

$origin = Invoke-Native -AllowFailure { git remote get-url origin }
if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'github\.com[/:]rmirabelle/LightSage(?:\.git)?$') {
  throw "The origin remote must be the public rmirabelle/LightSage GitHub repository."
}

Invoke-Native -FailureMessage "GitHub CLI is not authenticated. Run: gh auth login -h github.com" { gh auth status *> $null }
Invoke-Native -AllowFailure { gh release view $tag *> $null }
if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists. Raise the version first." }

Write-Host "==> Running tests ..." -ForegroundColor Cyan
foreach ($script in @("test:service-controls", "test:frontend-watch", "test:installation", "test:restore", "test:message-dialog", "test:updater")) {
  Invoke-Native -FailureMessage "Test failed: $script" { npm run -s $script }
}
foreach ($script in @("test:management", "test:scenes", "test:schedules")) {
  Invoke-Native -FailureMessage "Test failed: $script" { npm --prefix tools/matter-probe run -s $script }
}
foreach ($file in @("tools/matter-probe/test-h6159.mjs", "tools/matter-probe/test-ui-connection.mjs")) {
  Invoke-Native -FailureMessage "Test failed: $file" { node $file }
}

Write-Host "==> Building LightSage $tag ..." -ForegroundColor Cyan
Invoke-Native -FailureMessage "Installer build failed" { npm run dist:win }
if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf) -or (Get-Item -LiteralPath $assetPath).Length -le 0) { throw "Installer not found or empty: $assetPath" }
if (-not (Test-Path -LiteralPath "dist/win-unpacked/resources/elevate.exe" -PathType Leaf)) { throw "elevate.exe is missing from the build; the updater needs it to install." }

Write-Host "==> Testing the packaged app ..." -ForegroundColor Cyan
Invoke-Native -FailureMessage "Packaged app test failed" { node desktop/test-packaged.cjs }
Invoke-Native -FailureMessage "The build contains a credential. Do not publish it." { node desktop/check-secrets.cjs $assetPath }

Write-Host "==> Pushing source and tag $tag ..." -ForegroundColor Cyan
Invoke-Native -FailureMessage "Could not push the release commit" { git push origin HEAD }
Invoke-Native -FailureMessage "Could not create tag $tag" { git tag -a $tag -m "LightSage $tag" }
Invoke-Native -FailureMessage "Could not push tag $tag" { git push origin $tag }

Write-Host "==> Publishing GitHub release $tag ..." -ForegroundColor Cyan
Invoke-Native -FailureMessage "Could not create GitHub release $tag" { gh release create $tag $assetPath --verify-tag --title "LightSage $tag" --generate-notes --latest }

$publishedRelease = (Invoke-Native -FailureMessage "Could not verify GitHub release $tag" { gh release view $tag --json tagName,isDraft,isPrerelease,assets }) | ConvertFrom-Json
$publishedAssets = @($publishedRelease.assets | ForEach-Object { $_.name })
if ($publishedRelease.tagName -ne $tag -or $publishedRelease.isDraft -or $publishedRelease.isPrerelease -or $publishedAssets -notcontains $assetName) {
  throw "GitHub release $tag did not pass post-publish verification. Older releases were kept."
}
$latestRelease = (Invoke-Native -FailureMessage "Could not read releases/latest. Older releases were kept." { gh api repos/rmirabelle/LightSage/releases/latest }) | ConvertFrom-Json
if ($latestRelease.tag_name -ne $tag -or @($latestRelease.assets | ForEach-Object { $_.name }) -notcontains $assetName) {
  throw "GitHub's releases/latest does not point to the new installer. Older releases were kept."
}

Write-Host "==> Removing older releases ..." -ForegroundColor Cyan
$priorReleases = @(Invoke-Native -FailureMessage "Could not list GitHub releases" { gh release list --limit 100 --json tagName -q '.[].tagName' })
foreach ($priorTag in $priorReleases) {
  if ($priorTag -and $priorTag -ne $tag) {
    Write-Host "    - deleting $priorTag"
    Invoke-Native -FailureMessage "Could not delete older release $priorTag" { gh release delete $priorTag --yes --cleanup-tag }
  }
}

Write-Host "==> Published https://github.com/rmirabelle/LightSage/releases/tag/$tag" -ForegroundColor Green
