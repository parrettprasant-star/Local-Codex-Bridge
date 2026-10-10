[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DocumentationDirectory)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $DocumentationDirectory).Path.TrimEnd('\')
$required=@('README.md','TUNNEL-SETUP.md','START-HERE.zh-CN.md','USER-GUIDE.zh-CN.md',
    'CHATGPT-PROMPTS.zh-CN.md','PRIVACY-RELEASE.zh-CN.md','projects.json.example')
# Older immutable v6.2.0 ZIPs predate the online screenshot guide. Validate it
# whenever present; new README/START-HERE links also make omission fail below.
$screenshotGuide=Join-Path $root 'SCREENSHOT-GUIDE.zh-CN.md'
if(Test-Path -LiteralPath $screenshotGuide -PathType Leaf){$required+='SCREENSHOT-GUIDE.zh-CN.md'}
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
if($start.Contains('SCREENSHOT-GUIDE.zh-CN.md')){
    foreach($needle in @('npm.cmd install -g @openai/codex','codex.cmd --version','codex.cmd','ExecutionPolicy')){
        if(-not $start.Contains($needle)){throw ('Missing safe npm/PowerShell instruction: '+$needle)}
    }
}
if(Test-Path -LiteralPath $screenshotGuide -PathType Leaf){
    $screenshotText=[IO.File]::ReadAllText($screenshotGuide)
    foreach($needle in @('草稿未发送','历史真实只读调用','独立演示数据','没有连接真实 Tunnel','旧 ZIP 内没有本次新图解')){
        if(-not $screenshotText.Contains($needle)){throw ('Missing screenshot provenance boundary: '+$needle)}
    }
    $images=Get-Content -Raw -LiteralPath (Join-Path $root 'docs\images\quickstart\SCREENSHOTS.json') | ConvertFrom-Json
    $expected=@('01-chatgpt-select-bridge.jpg','02-chatgpt-readonly-prompt.jpg','02-chatgpt-agent-result.jpg',
        '03-bridge-overview-demo.jpg','04-bridge-native-detail-demo.jpg','05-bridge-native-scroll-demo.jpg',
        '06-bridge-agents-demo.jpg','07-bridge-diagnostics-demo.jpg')
    if($images.images.Count -ne $expected.Count){throw 'Screenshot inventory must contain exactly eight reviewed images.'}
    $seenImages=@{}
    foreach($image in $images.images){
        if($image.file -notin $expected -or $seenImages.ContainsKey($image.file) -or
            $image.privacy_review -ne 'passed' -or [string]::IsNullOrWhiteSpace($image.provenance)){
            throw 'Unreviewed, duplicate or unexpected screenshot.'
        }
        $seenImages[$image.file]=$true
        $imagePath=Join-Path $root ('docs\images\quickstart\'+$image.file)
        $bytes=[IO.File]::ReadAllBytes($imagePath)
        $digest=[Security.Cryptography.SHA256]::Create()
        try{$actualHash=[BitConverter]::ToString($digest.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}
        finally{$digest.Dispose()}
        if($bytes.Length -ne $image.bytes -or $bytes.Length -lt 200 -or
            $bytes[0] -ne 255 -or $bytes[1] -ne 216 -or $actualHash -ne $image.sha256){
            throw ('Screenshot integrity mismatch: '+$image.file)
        }
        if(-not $screenshotText.Contains('docs/images/quickstart/'+$image.file)){
            throw ('Unlinked screenshot: '+$image.file)
        }
    }
    Write-Output 'SCREENSHOT_GUIDE=PASS images=8 provenance=explicit integrity=verified'
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
