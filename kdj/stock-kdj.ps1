# KDJ(9,3,3) 计算器（与通达信/同花顺 SMA(X,N,1) 初始化一致：K0=D0=RSV0）
# 用法: pwsh -NoProfile -ExecutionPolicy Bypass -File stock-kdj.ps1 -JsonPath kdj-600519.json
# 输入 JSON: {"data":{"name":"...","klines":["date,open,close,high,low,vol",...]}}  （东财 push2his 原始格式即可）
param([Parameter(Mandatory=$true)][string]$JsonPath)
$ErrorActionPreference = 'Stop'
$raw = Get-Content -Raw -Encoding UTF8 -Path $JsonPath
$k = $raw | ConvertFrom-Json
$name = $k.data.name
$bars = @()
foreach ($line in $k.data.klines) {
  $p = $line -split ','
  $bars += [pscustomobject]@{ Date = $p[0]; Close = [double]$p[2]; High = [double]$p[3]; Low = [double]$p[4] }
}
$Kv = 0.0; $Dv = 0.0; $Jv = 0.0; $first = $true; $res = @()
for ($i = 0; $i -lt $bars.Count; $i++) {
  $n = $i + 1; if ($n -gt 9) { $n = 9 }
  $llv = 1000000.0; $hhv = -1000000.0
  for ($j = $i - $n + 1; $j -le $i; $j++) {
    if ($bars[$j].Low -lt $llv) { $llv = $bars[$j].Low }
    if ($bars[$j].High -gt $hhv) { $hhv = $bars[$j].High }
  }
  if ($hhv - $llv -ne 0) { $rsv = ($bars[$i].Close - $llv) / ($hhv - $llv) * 100.0 } else { $rsv = 50.0 }
  if ($first) { $Kv = $rsv; $Dv = $rsv; $Jv = $rsv; $first = $false }
  else {
    $Kv = 2.0 / 3.0 * $Kv + 1.0 / 3.0 * $rsv
    $Dv = 2.0 / 3.0 * $Dv + 1.0 / 3.0 * $Kv
    $Jv = 3.0 * $Kv - 2.0 * $Dv
  }
  $res += [pscustomobject]@{ Date = $bars[$i].Date; Close = $bars[$i].Close; K = $Kv; D = $Dv; J = $Jv }
}
"== $name KDJ(9,3,3) latest 6 bars =="
$res | Select-Object -Last 6 | ForEach-Object {
  '{0}  close={1,9:F2}  K={2,6:F2}  D={3,6:F2}  J={4,7:F2}' -f $_.Date, $_.Close, $_.K, $_.D, $_.J
}
