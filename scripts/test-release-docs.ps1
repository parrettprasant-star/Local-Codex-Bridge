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
$checkedAnchors=0
$parsedCommands=0
function Get-MarkdownAnchors([string]$text) {
    $headings=@{}
    $insideCode=$false
    foreach($line in $text -split '\r?\n') {
        if($line -match '^```'){$insideCode=-not $insideCode;continue}
        if($insideCode -or $line -notmatch '^#{1,6}\s+(.+?)\s*#*\s*$'){continue}
        $heading=[regex]::Replace($Matches[1],'\[([^\]]+)\]\([^)]*\)','$1').ToLowerInvariant()
        $heading=[regex]::Replace($heading,'[^\p{L}\p{N}\p{M}\s_-]','').Trim() -replace '\s','-'
        $duplicate=if($headings.ContainsKey($heading)){[int]$headings[$heading]}else{0}
        $headings[$heading]=$duplicate+1
        if($duplicate -eq 0){$heading}else{$heading+'-'+$duplicate}
    }
}
foreach($name in $required | Where-Object {$_ -like '*.md'}){
    $text=[IO.File]::ReadAllText((Join-Path $root $name))
    foreach($link in [regex]::Matches($text,'\]\(([^)]+)\)')){
        $target=$link.Groups[1].Value
        if($target -match '^https?://'){continue}
        $parts=$target.Split('#',2)
        $relative=$parts[0]
        $path=if($relative -eq ''){Join-Path $root $name}else{[IO.Path]::GetFullPath((Join-Path $root $relative))}
        if(-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
            -not(Test-Path -LiteralPath $path -PathType Leaf)){throw ('Broken local documentation link in '+$name)}
        if($parts.Count -eq 2 -and $parts[1] -ne ''){
            $fragment=[Uri]::UnescapeDataString($parts[1])
            $anchors=@(Get-MarkdownAnchors ([IO.File]::ReadAllText($path)))
            if($fragment -notin $anchors){throw ('Broken documentation anchor in '+$name+': '+$target)}
            $checkedAnchors++
        }
        $checkedLinks++
    }
    foreach($block in [regex]::Matches($text,'(?ms)^```powershell[^\r\n]*\r?\n(.*?)^```\s*(?:\r?\n|$)')){
        $taskTokens=$null;$taskParseErrors=$null
        $null=[Management.Automation.Language.Parser]::ParseInput($block.Groups[1].Value,[ref]$taskTokens,[ref]$taskParseErrors)
        if($taskParseErrors.Count){throw ('Invalid PowerShell example in '+$name+': '+$taskParseErrors[0].Message)}
        $parsedCommands++
    }
}
$start=[IO.File]::ReadAllText((Join-Path $root 'START-HERE.zh-CN.md'))
foreach($needle in @('install.cmd','Node.js','codex.exe','Runtime','自己的','13','BLOCKED_BEFORE_CALL')){
    if(-not $start.Contains($needle)){throw ('Missing beginner setup requirement: '+$needle)}
}
foreach($needle in @('先看这一页：安装路线','成功标志','Download ZIP','No authentication','安装完以后，每天怎么用','登录','授权')){
    if(-not $start.Contains($needle)){throw ('Missing beginner action/acceptance guidance: '+$needle)}
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
Write-Output ('BEGINNER_DOCS=PASS links='+$checkedLinks+' anchors='+$checkedAnchors+' powershell_examples='+$parsedCommands+' example=read-only')
