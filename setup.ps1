#Requires -Version 5.1
<#
.SYNOPSIS
    Installation et configuration de Setting Engine sur Windows.
.DESCRIPTION
    - Vérifie / installe les prérequis (Node 22 LTS, Rust optionnel)
    - Installe les dépendances npm et le navigateur Playwright
    - Crée les fichiers .env à partir de .env.example
.EXAMPLE
    .\setup.ps1            # Installation standard (dashboard web)
    .\setup.ps1 -WithTauri # Inclut Rust pour l'app de bureau (npm run ui)
#>

param(
    [switch]$WithTauri  # Installe aussi Rust + Build Tools pour l'app de bureau Tauri
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Write-Step($msg)  { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  [ERR]  $msg" -ForegroundColor Red }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Setting Engine - Installation Windows" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# ---------------------------------------------------------------------------
# 1. winget
# ---------------------------------------------------------------------------
Write-Step "Verification de winget"
$hasWinget = Test-Command winget
if ($hasWinget) {
    Write-Ok "winget disponible"
} else {
    Write-Warn2 "winget introuvable. Les outils manquants devront etre installes a la main."
}

# ---------------------------------------------------------------------------
# 2. Node.js 22 LTS
# ---------------------------------------------------------------------------
Write-Step "Verification de Node.js (22 LTS requis)"
$needNode = $true
if (Test-Command node) {
    $nodeVer = (node --version).TrimStart("v")
    $major = [int]($nodeVer.Split(".")[0])
    if ($major -eq 22) {
        Write-Ok "Node $nodeVer detecte"
        $needNode = $false
    } elseif ($major -gt 22) {
        Write-Warn2 "Node $nodeVer est TROP RECENT. better-sqlite3 ne compile pas au-dela de la v22 LTS."
        Write-Warn2 "Installez Node 22 LTS (winget install OpenJS.NodeJS.LTS) puis relancez ce script."
    } else {
        Write-Warn2 "Node $nodeVer est trop ancien. Installez Node 22 LTS."
    }
}
if ($needNode) {
    if ($hasWinget) {
        Write-Host "  Installation de Node.js 22 LTS via winget..." -ForegroundColor Gray
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
        Write-Warn2 "Node vient d'etre installe : FERMEZ et ROUVREZ PowerShell, puis relancez .\setup.ps1"
        exit 0
    } else {
        Write-Err "Installez Node 22 LTS manuellement : https://nodejs.org/  puis relancez."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 3. Rust + Build Tools (optionnel, app de bureau Tauri)
# ---------------------------------------------------------------------------
if ($WithTauri) {
    Write-Step "Verification de Rust (app de bureau Tauri)"
    if (Test-Command cargo) {
        Write-Ok "Rust detecte : $(cargo --version)"
    } elseif ($hasWinget) {
        Write-Host "  Installation de Rust + Build Tools C++..." -ForegroundColor Gray
        winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
        winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements
        Write-Warn2 "Rust installe : rouvrez PowerShell avant 'npm run ui'."
    } else {
        Write-Warn2 "Rust absent. Installez rustup + VS Build Tools (C++) pour 'npm run ui'."
    }
}

# ---------------------------------------------------------------------------
# 4. Dependances npm
# ---------------------------------------------------------------------------
Write-Step "Installation des dependances npm (compile better-sqlite3)"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Err "npm install a echoue."
    Write-Warn2 "Causes frequentes : Node != 22 LTS, ou Visual Studio Build Tools (C++) manquants."
    Write-Warn2 "Installez : winget install Microsoft.VisualStudio.2022.BuildTools  (composant Desktop C++)"
    exit 1
}
Write-Ok "Dependances installees"

# ---------------------------------------------------------------------------
# 5. Navigateur Playwright
# ---------------------------------------------------------------------------
Write-Step "Installation du navigateur Playwright (Chromium)"
npx playwright install chromium
if ($LASTEXITCODE -eq 0) { Write-Ok "Chromium installe" } else { Write-Warn2 "Echec de l'installation Playwright (a refaire : npx playwright install chromium)" }

# ---------------------------------------------------------------------------
# 6. Fichiers .env
# ---------------------------------------------------------------------------
Write-Step "Creation des fichiers .env"
$example = Join-Path $PSScriptRoot ".env.example"
if (-not (Test-Path $example)) {
    Write-Warn2 ".env.example introuvable, etape ignoree."
} else {
    $targets = @(
        (Join-Path $PSScriptRoot ".env"),
        (Join-Path $PSScriptRoot "agents\collector\.env"),
        (Join-Path $PSScriptRoot "agents\outreach\.env"),
        (Join-Path $PSScriptRoot "agents\dmresponder\.env")
    )
    foreach ($t in $targets) {
        $dir = Split-Path $t -Parent
        if (-not (Test-Path $dir)) { continue }
        if (Test-Path $t) {
            Write-Ok "Existe deja (conserve) : $t"
        } else {
            Copy-Item $example $t
            Write-Ok "Cree : $t"
        }
    }
    Write-Warn2 "EDITEZ ces .env : renseignez OPENAI_API_KEY (et vos identifiants si souhaite)."
}

# ---------------------------------------------------------------------------
# Fin
# ---------------------------------------------------------------------------
Write-Host "`n============================================" -ForegroundColor Green
Write-Host "  Installation terminee !" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host @"

Prochaines etapes :
  1. Ouvrez .env et collez votre cle OPENAI_API_KEY
  2. Lancez le dashboard web :
        npm run ui:web        ->  http://localhost:3000
"@ -ForegroundColor White
if ($WithTauri) {
    Write-Host "  3. Ou l'application de bureau (Tauri) :`n        npm run ui" -ForegroundColor White
} else {
    Write-Host "  (Pour l'app de bureau Tauri, relancez : .\setup.ps1 -WithTauri)" -ForegroundColor Gray
}
Write-Host "`nAu 1er lancement Instagram : connexion manuelle dans le navigateur (session sauvegardee).`n" -ForegroundColor Gray
