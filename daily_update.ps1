<#
.SYNOPSIS
  Windows 日更入口。与 macOS / Linux 统一运行 refresh.py。
.DESCRIPTION
  刷新基金、独立指数、股票、筛选规则与策略实验，最后生成数据质量报告。
  失败或超时具有非零退出码；旧观测日期保留。不执行 git add、commit 或 push。
  本文件不会创建或修改任何系统调度任务。
#>
[CmdletBinding()]
param(
    [switch]$Offline,
    [string]$Datasets = 'funds,indices,stocks,screening,strategy,quality',
    [int]$Timeout = 180,
    [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
$arguments = @((Join-Path $PSScriptRoot 'refresh.py'), '--datasets', $Datasets, '--timeout', "$Timeout")
if ($Offline) { $arguments += '--offline' }
& python @arguments
exit $LASTEXITCODE
