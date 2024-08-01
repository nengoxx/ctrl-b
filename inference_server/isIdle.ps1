$user = 'computer\user'
$idleTime = (Get-WmiObject Win32_ComputerSystem | Select-Object -ExpandProperty UserName) -eq $user
if ($idleTime) {
    $lastInput = (Get-Process -Name explorer).StartTime
    $idleMinutes = (New-TimeSpan -Start $lastInput).TotalMinutes
    if ($idleMinutes -gt 30) {
        Write-Output "User $user has been idle for more than 30 minutes."
    } else {
        Write-Output "User $user has not been idle for more than 30 minutes."
    }
} else {
    Write-Output "User $user is not logged in."
}