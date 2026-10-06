param([Parameter(Mandatory=$true)][string]$DemoOutput)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$demoChapters=(Get-Content -LiteralPath (Join-Path $DemoOutput 'walkthrough.json') -Raw -Encoding UTF8 | ConvertFrom-Json).chapters
$demoAudioDir=Join-Path $DemoOutput 'narration'
New-Item -ItemType Directory -Path $demoAudioDir -Force | Out-Null
$demoVoice=New-Object System.Speech.Synthesis.SpeechSynthesizer
$demoVoice.SelectVoice('Microsoft Zira Desktop')
$demoVoice.Rate=1
try {
 for($demoIndex=0;$demoIndex -lt $demoChapters.Count;$demoIndex++) {
  $demoVoice.SetOutputToWaveFile((Join-Path $demoAudioDir ("chapter-{0}.wav" -f $demoIndex)))
  $demoVoice.Speak([string]$demoChapters[$demoIndex].detail)
 }
} finally {$demoVoice.Dispose()}
