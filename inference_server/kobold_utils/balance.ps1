$min = 1
$max = 100
$exitCode = 0

if ($args.Length -lt 2) {
    Write-Host "Usage: .\balance.ps1 <model> <contextSize>"
    exit 1
}

$model = $args[0]
$contextSize = $args[1]

if (-not (Test-Path $model)) {
    Write-Host "Model file does not exist: $model"
    exit 1
}

while ($min -lt $max) {
    $mid = [Math]::Floor(($min + $max) / 2)
    $command = ".\koboldcpp.exe --model $model --usecublas --contextsize $contextSize --flashattention --quantkv 2 --benchmark --gpulayers $mid"
    Write-Host "Running command: $command"
    $process = Start-Process -FilePath powershell.exe -ArgumentList "-Command", $command -PassThru -Wait
    $exitCode = $process.ExitCode
    Write-Host "Exit code: $exitCode"

    if ($exitCode -eq 0) {
        $min = $mid + 1
    } else {
        $max = $mid
    }
}

Write-Host "============================================"
Write-Host "Maximum possible value for --gpulayers: $($min - 1)"
