#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy the NotYetDone plugin into the global OpenCode plugin directory.

.DESCRIPTION
  Default mode copies index.mjs, policy.mjs and gate.mjs into
  %USERPROFILE%\.config\opencode\plugins\task-continuity and leaves the
  existing node_modules in place.

  -Mode junction replaces the target with a directory junction to this
  repository, so the repository becomes the only copy. Use only when the
  target contains nothing worth keeping: the junction replaces the folder.

.PARAMETER Mode
  copy (default) or junction.

.EXAMPLE
  pwsh -NoProfile -File scripts/install.ps1
  pwsh -NoProfile -File scripts/install.ps1 -Mode junction
#>
[CmdletBinding()]
param(
  [ValidateSet('copy', 'junction')]
  [string]$Mode = 'copy'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:USERPROFILE '.config\opencode\plugins\task-continuity'

foreach ($file in 'index.mjs', 'policy.mjs', 'gate.mjs') {
  if (-not (Test-Path (Join-Path $repo $file))) {
    throw "Missing $file in $repo"
  }
}

if ($Mode -eq 'junction') {
  if (Test-Path $target) {
    $existing = Get-Item $target -Force
    if ($existing.LinkType -eq 'Junction') {
      Write-Host "Removing existing junction $target"
      (Get-Item $target -Force).Delete()
    } else {
      throw "$target exists and is not a junction. Move it away first; refusing to delete user files."
    }
  }
  New-Item -ItemType Junction -Path $target -Target $repo | Out-Null
  Write-Host "Linked $target -> $repo"
} else {
  New-Item -ItemType Directory -Force $target | Out-Null
  foreach ($file in 'index.mjs', 'policy.mjs', 'gate.mjs') {
    Copy-Item (Join-Path $repo $file) (Join-Path $target $file) -Force
  }
  $pluginPackage = Join-Path $target 'package.json'
  if (-not (Test-Path $pluginPackage)) {
    Copy-Item (Join-Path $repo 'package.json') $pluginPackage -Force
  }
  if (-not (Test-Path (Join-Path $target 'node_modules\@opencode\plugin'))) {
    Write-Host "Installing plugin dependencies in $target"
    Push-Location $target
    try { npm install --no-audit --no-fund } finally { Pop-Location }
  }
  Write-Host "Copied plugin sources to $target"
}

Write-Host ''
Write-Host 'Restart OpenCode to load the plugin.'
Write-Host 'Then, in a session: enable task_continuity for a Markdown checklist.'
