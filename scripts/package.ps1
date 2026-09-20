$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'Manifest and package versions differ.' }
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected version format.' }

# Explicit allowlist: no repository history, test data, credentials or older archives.
$files = @(
    'manifest.json', 'background.js', 'direct.js',
    'popup/popup.html', 'popup/popup.css', 'popup/popup.js',
    'privacy.html', 'privacy.css', 'PRIVACY.md',
    'icons/corn.svg', 'icons/corn-48.png', 'icons/corn-96.png', 'icons/corn-128.png',
    'LICENSE', 'README.md', 'REVIEWER_NOTES.md'
)
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $file) -PathType Leaf)) {
        throw "Missing package file: $file"
    }
}
$archiveDir = Join-Path $projectRoot 'Archive'
[IO.Directory]::CreateDirectory($archiveDir) | Out-Null
$archivePath = Join-Path $archiveDir "CornDownloader-$($manifest.version).zip"
Add-Type -AssemblyName System.IO.Compression
$output = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::Write)
$archive = [IO.Compression.ZipArchive]::new($output, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entry = $archive.CreateEntry($file, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $destination = $entry.Open()
        $source = [IO.File]::OpenRead((Join-Path $projectRoot $file))
        try { $source.CopyTo($destination) }
        finally { $source.Dispose(); $destination.Dispose() }
    }
} finally { $archive.Dispose(); $output.Dispose() }

# Read back every entry and compare bytes against source before calling it ready.
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $files.Count) { throw 'Archive file count mismatch.' }
    foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        $copy = [IO.MemoryStream]::new()
        try {
            $stream.CopyTo($copy)
            $expected = [IO.File]::ReadAllBytes((Join-Path $projectRoot $entry.FullName))
            if ([Convert]::ToBase64String($copy.ToArray()) -ne [Convert]::ToBase64String($expected)) {
                throw "Archive content mismatch: $($entry.FullName)"
            }
        } finally { $stream.Dispose(); $copy.Dispose() }
    }
} finally { $archive.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  CornDownloader-$($manifest.version).zip" | Set-Content -LiteralPath "$archivePath.sha256" -Encoding ascii
Write-Output "Verified $($files.Count) files: $archivePath"
Write-Output "SHA256: $hash"
