[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DocumentationDirectory)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $DocumentationDirectory).Path.TrimEnd('\')
$required=@('README.md','TUNNEL-SETUP.md','START-HERE.zh-CN.md','USER-GUIDE.zh-CN.md',
    'CHATGPT-PROMPTS.zh-CN.md','PRIVACY-RELEASE.zh-CN.md','projects.json.example')
foreach($name in $required){
    if(-not(Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)){throw ('Missing user documentation: '+$name)}
}
$checkedLinks=0
foreach($name in $required | Where-Object {$_ -like '*.md'}){
    $text=[IO.File]::ReadAllText((Join-Path $root $name))
    foreach($link in [regex]::Matches($text,'\]\(([^)]+)\)')){
        $target=$link.Groups[1].Value
        if($target -match '^https?://|^#'){continue}
        $relative=$target.Split('#')[0]
        $path=[IO.Path]::GetFullPath((Join-Path $root $relative))
        if(-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
            -not(Test-Path -LiteralPath $path -PathType Leaf)){throw ('Broken local documentation link in '+$name)}
        $checkedLinks++
    }
}
$start=[IO.File]::ReadAllText((Join-Path $root 'START-HERE.zh-CN.md'))
foreach($needle in @('install.cmd','Node.js','codex.exe','Runtime','自己的','13','BLOCKED_BEFORE_CALL')){
    if(-not $start.Contains($needle)){throw ('Missing beginner setup requirement: '+$needle)}
}
$guide=[IO.File]::ReadAllText((Join-Path $root 'USER-GUIDE.zh-CN.md'))
foreach($needle in @('升级回滚与卸载','真退出','Scheduled Tasks','已分页加载','DPAPI','可能','get_task_status')){
    if(-not $guide.Contains($needle)){throw ('Missing usage/safety boundary: '+$needle)}
}
$example=Get-Content -Raw -LiteralPath (Join-Path $root 'projects.json.example')|ConvertFrom-Json
if($example.schema_version -ne 1 -or $example.projects.Count -ne 1 -or
    $example.projects[0].root_path -ne 'C:\Projects\Demo' -or
    @($example.projects[0].allowed_capabilities).Count -ne 1 -or
    $example.projects[0].allowed_capabilities[0] -ne 'file_read'){throw 'Example must remain neutral and read-only.'}
Write-Output ('BEGINNER_DOCS=PASS links='+$checkedLinks+' example=read-only')
