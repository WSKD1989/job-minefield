# 应聘避坑小工具 · DeepSeek Harness CLI 插件安装脚本
# 作用:
#   1. 把技能(yingpin-bikeng)安装到 $DSH_HOME\skills（DSH 会在所有工作区发现它）;
#   2. 生成 $DSH_HOME\bin\yingpin.cmd 命令包装器（可选加入 PATH）;
#   3. 运行自检并给出验证步骤。
# 用法: powershell -ExecutionPolicy Bypass -File install.ps1
# 卸载: powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param(
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$cliRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliFile = Join-Path $cliRoot "cli.mjs"
$toolsDir = Join-Path $cliRoot "tools"
$skillTpl = Join-Path $cliRoot "skills\yingpin-bikeng\SKILL.md.tpl"
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$skillDir = Join-Path $dshHome "skills\yingpin-bikeng"
$skillFile = Join-Path $skillDir "SKILL.md"
$binDir = Join-Path $dshHome "bin"
$cmdFile = Join-Path $binDir "yingpin.cmd"

if (-not (Test-Path $cliFile)) { Write-Host "错误: 找不到 cli.mjs（$cliFile）" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $skillTpl)) { Write-Host "错误: 找不到技能模板（$skillTpl）" -ForegroundColor Red; exit 1 }

if ($Uninstall) {
  if (Test-Path $skillDir) { Remove-Item $skillDir -Recurse -Force; Write-Host "已移除技能: $skillDir" -ForegroundColor Green }
  if (Test-Path $cmdFile) { Remove-Item $cmdFile -Force; Write-Host "已移除命令: $cmdFile" -ForegroundColor Green }
  Write-Host "卸载完成。新的 DSH 会话将不再加载该技能。"
  exit 0
}

# 1) 安装技能（替换 {{CLI_PATH}} / {{TOOLS_DIR}} 为实际绝对路径）
New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
$skill = Get-Content $skillTpl -Raw -Encoding UTF8
$cliPathForSkill = $cliFile.Replace('\', '/')
$toolsPathForSkill = $toolsDir.Replace([string][char]92, "/")
$skill = $skill.Replace("{{CLI_PATH}}", $cliPathForSkill).Replace("{{TOOLS_DIR}}", $toolsPathForSkill)
[System.IO.File]::WriteAllText($skillFile, $skill, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "==> 技能已安装: $skillFile" -ForegroundColor Cyan
if (Test-Path $toolsDir) {
  Write-Host "==> 配套工具可用: $toolsDir（boss-capture.user.js / import-capture.mjs）" -ForegroundColor Cyan
}

# 2) 生成 yingpin.cmd 包装器
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$nl = "`r`n"
$cmd = "@echo off" + $nl + "chcp 65001 >nul" + $nl + "node `"$cliFile`" %*" + $nl
[System.IO.File]::WriteAllText($cmdFile, $cmd, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "==> 命令包装器: $cmdFile" -ForegroundColor Cyan
$onPath = ($env:PATH -split ";") | Where-Object { $_ -and $_.TrimEnd('\') -eq $binDir.TrimEnd('\') } | Select-Object -First 1
if (-not $onPath) {
  Write-Host "提示: $binDir 不在 PATH 中；直接调用: node $cliFile（技能内已使用该方式，无需 PATH）" -ForegroundColor Yellow
  Write-Host "       如希望使用 yingpin 短命令，请手动把 $binDir 加入系统 PATH 后重开终端。" -ForegroundColor Yellow
}

# 3) 自检
Write-Host ""
Write-Host "==> 运行自检 ..." -ForegroundColor Cyan
& node $cliFile doctor
if ($LASTEXITCODE -ne 0) { Write-Host "自检失败（退出码 $LASTEXITCODE）" -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "==> 安装完成。请完全退出并重启 DSH Desktop，新会话即可自动加载技能。" -ForegroundColor Green
Write-Host "    验证: 重启后在新会话中让 AI 执行「列出应聘避坑小工具里的公司」或直接运行: node $cliFile list --json" -ForegroundColor Green