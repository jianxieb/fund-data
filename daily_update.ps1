<#
.SYNOPSIS
    每个交易日 14:00 的基金数据更新入口（Windows 任务计划程序调用）。

.DESCRIPTION
    替代失效的 Codex 桌面版定时任务：桌面版会把自动化触发注入成一条缺少
    call_id 的 function_call_output，DeepSeek 的 Responses API 会直接返回
    400（missing field call_id）。本脚本改走命令行走完同样的流程：
      1. 运行 update.py（净值、历史区间、申购状态/限额、场内 ETF 快照、基准）
      2. 退出码为 0 且输出出现「FUNDS 更新 … 校验通过」才算成功
      3. 成功且数据有变化时，只提交 index.html 与 Markdown 清单，并 git push
      4. 全过程追加写入 .tmp-snap/daily-update.log
    失败、写回自检未通过、数据无变化时不提交，只记录日志。

.PARAMETER NoPush
    只做本地提交，不执行 git push（手动排障用）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File daily_update.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$repo = $PSScriptRoot
$snapDir = Join-Path $repo '.tmp-snap'
$runLog = Join-Path $snapDir 'daily-update.log'
$updateLog = Join-Path $repo '.tmp-update.log'
$dataFiles = @('index.html', '标普500与纳斯达克基金清单.md')
$pythonExe = 'python'
$resolvedPython = Get-Command python -ErrorAction SilentlyContinue
if ($resolvedPython -and $resolvedPython.Source) {
    $pythonExe = $resolvedPython.Source
}

New-Item -ItemType Directory -Force -Path $snapDir | Out-Null

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $runLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-NavLaggards {
    param([string]$HtmlPath)
    $text = [System.IO.File]::ReadAllText($HtmlPath, [System.Text.Encoding]::UTF8)
    $block = [regex]::Match($text, '(?s)/\*__DATA_FUNDS_BEGIN__\*/(.*?)/\*__DATA_FUNDS_END__\*/')
    if (-not $block.Success) {
        return @{ Mode = ''; Items = @() }
    }
    $counts = @{}
    $rows = New-Object System.Collections.ArrayList
    foreach ($line in ($block.Groups[1].Value -split "`n")) {
        $codeMatch = [regex]::Match($line, "c:'(\d{6})'")
        if (-not $codeMatch.Success) { continue }
        $dateMatch = [regex]::Match($line, "navdate:'([^']*)'")
        if (-not $dateMatch.Success -or -not $dateMatch.Groups[1].Value) { continue }
        $nameMatch = [regex]::Match($line, "n:'([^']*)'")
        $navDate = $dateMatch.Groups[1].Value
        if ($counts.ContainsKey($navDate)) { $counts[$navDate]++ } else { $counts[$navDate] = 1 }
        [void]$rows.Add([pscustomobject]@{
            Code    = $codeMatch.Groups[1].Value
            Name    = $(if ($nameMatch.Success) { $nameMatch.Groups[1].Value } else { '' })
            NavDate = $navDate
        })
    }
    if ($counts.Count -eq 0) {
        return @{ Mode = ''; Items = @() }
    }
    $mode = ($counts.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1).Key
    $items = @($rows | Where-Object { $_.NavDate -lt $mode } | ForEach-Object {
        '{0} {1}（{2}）' -f $_.Code, $_.Name, $_.NavDate
    })
    return @{ Mode = $mode; Items = $items }
}

Set-Location $repo
Write-Log '===== 每日数据更新开始 ====='

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
& $pythonExe update.py 2>&1 | Out-File -LiteralPath $updateLog -Encoding utf8
$exitCode = $LASTEXITCODE
$elapsed = [int]$stopwatch.Elapsed.TotalSeconds
$output = [System.IO.File]::ReadAllText($updateLog, [System.Text.Encoding]::UTF8)

$ok = ($exitCode -eq 0) -and ($output -match 'FUNDS 更新') -and ($output -match '校验通过')
if (-not $ok) {
    Write-Log ("update.py 未通过（exit=$exitCode，用时 $elapsed s），本次不提交；详见 .tmp-update.log")
    exit 1
}
Write-Log "update.py 通过（exit=0，用时 $elapsed s）"

$navDate = ''
$navMatch = [regex]::Match($output, '净值截至\s+(\d{4}-\d{2}-\d{2})')
if ($navMatch.Success) { $navDate = $navMatch.Groups[1].Value }
$snapText = ''
$snapMatch = [regex]::Match($output, '场内快照\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
if ($snapMatch.Success) { $snapText = $snapMatch.Groups[1].Value }

$today = Get-Date -Format 'yyyy-MM-dd'
$todaysChanges = @()
$changesPath = Join-Path $snapDir 'changes.json'
if (Test-Path -LiteralPath $changesPath) {
    $allChanges = @(Get-Content -LiteralPath $changesPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    $todaysChanges = @($allChanges | Where-Object { $_.d -eq $today })
}

$navInfo = Get-NavLaggards -HtmlPath (Join-Path $repo 'index.html')
Write-Log ("净值截至 {0}；场内快照 {1}" -f $(if ($navDate) { $navDate } else { '未知' }), $(if ($snapText) { $snapText } else { '未知' }))
Write-Log ("当日申购变动 {0} 条" -f $todaysChanges.Count)
foreach ($change in $todaysChanges) {
    $kind = if ($change.f -eq 'st') { '状态' } else { '限额' }
    Write-Log ("  · {0}（{1}）{2}：{3} → {4}" -f $change.n, $change.c, $kind, $change.a, $change.b)
}
if ($navInfo.Items.Count -gt 0) {
    Write-Log ("净值日期落后于众数（{0}）的基金：{1}" -f $navInfo.Mode, ($navInfo.Items -join '、'))
} elseif ($navInfo.Mode) {
    Write-Log ("无基金净值日期落后于众数（{0}）" -f $navInfo.Mode)
}

& git add -- $dataFiles
if ($LASTEXITCODE -ne 0) {
    Write-Log 'git add 失败，本次不提交'
    exit 1
}
& git diff --cached --quiet -- $dataFiles
if ($LASTEXITCODE -eq 0) {
    Write-Log '数据无变化，跳过提交与推送'
    exit 0
}

$navForMessage = if ($navDate) { $navDate } else { $today }
$message = '每日数据更新（{0}）：净值截至 {1}，申购变动 {2} 条' -f $today, $navForMessage, $todaysChanges.Count
& git commit -m $message -- $dataFiles | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Log 'git commit 失败，请人工检查暂存区'
    exit 1
}
Write-Log ("已提交：{0}" -f $message)

if ($NoPush) {
    Write-Log '指定了 -NoPush，跳过 git push'
    exit 0
}

& git push origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Log 'git push 失败（远端可能已有新提交）；本地提交保留，未强推，请人工处理'
    exit 1
}
Write-Log 'push 完成：origin/main'
exit 0
