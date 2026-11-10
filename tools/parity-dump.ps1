# Regenerates packages/physics/test/parity.jsonl from the Sound System plugin's headers at its v1 tag.
# Needs the plugin repo beside this one and Visual Studio 2022 (C++). Refuses to run if the plugin's Source differs
# from the tag, so the committed reference always means "plugin v1".
param(
    [string]$Plugin = (Join-Path $PSScriptRoot '..\..\SoundSystem'),
    [string]$Tag = 'good-2026-11-09-v1'
)
$ErrorActionPreference = 'Stop'

# FactoryPresets.h is data (preset values), not part of what the dump evaluates, so a preset-only change does not matter here
git -C $Plugin diff --quiet $Tag -- Source ':!Source/FactoryPresets.h'
if ($LASTEXITCODE -ne 0) { throw "Plugin Source differs from $Tag (or the tag is missing). Check out the tag first." }

$vcvars = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\2022' -Recurse -Filter vcvars64.bat | Select-Object -First 1 -ExpandProperty FullName
if (-not $vcvars) { throw 'vcvars64.bat not found (Visual Studio 2022 C++ tools).' }

$build = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force $build | Out-Null
$src = Join-Path $PSScriptRoot 'parity_dump.cpp'
$exe = Join-Path $build 'parity_dump.exe'
cmd /c "`"$vcvars`" >nul 2>nul && cl /nologo /std:c++17 /EHsc /O2 /fp:precise /I `"$Plugin\Source`" /Fo`"$build\\`" /Fe`"$exe`" `"$src`""
if ($LASTEXITCODE -ne 0) { throw "compile failed ($LASTEXITCODE)" }

$out = Join-Path $PSScriptRoot '..\packages\physics\test\parity.jsonl'
$lines = & $exe
if ($LASTEXITCODE -ne 0) { throw "parity_dump failed ($LASTEXITCODE)" }
[IO.File]::WriteAllText($out, (($lines -join "`n") + "`n"))
"wrote $($lines.Count) cases to $out"
