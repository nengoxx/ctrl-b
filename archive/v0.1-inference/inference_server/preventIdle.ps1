<# # Function to load IP addresses from the clients file
function Load-Clients {
    param (
        [string]$filePath
    )
    return Get-Content -Path $filePath
}

# Load IP addresses from the clients file
$clientsFilePath = "$PSScriptRoot\..\clients"
$deviceIPs = Load-Clients -filePath $clientsFilePath #>

$interval = 60 # Check every 60 seconds when no connections
#$shortInterval = 30 # Check every 30 seconds when the device is reachable
$longInterval = 1800 # Check every 30 minutes when connections are detected
$portsToCheck = @(8000, 7860, 5000, 5001, 80) # List of ports to check for connections
$originalTimeout = 30 # Original sleep timeout in minutes
$sleepTimerDisabled = $false

# Default to checking every 60 seconds since ping functionality is commented out
$checkInterval = $interval

while ($true) {
<#     $deviceReachable = $false

    foreach ($deviceIP in $deviceIPs) {
        $pingResult = Test-Connection -ComputerName $deviceIP -Count 1 -Quiet
        if ($pingResult) {
            Write-Output "Device $deviceIP is reachable."
            $deviceReachable = $true
            break
        } else {
            Write-Output "Device $deviceIP is not reachable."
        }
    }

    if ($deviceReachable) {
        Write-Output "Device is reachable. Checking connections every 30 seconds."
        $checkInterval = $shortInterval
    } else {
        Write-Output "Device is not reachable. Checking connections every 60 seconds."
        $checkInterval = $interval
    } #>



    $activity = 0

    foreach ($port in $portsToCheck) {
        $activity += (Get-NetTCPConnection -State Established | Where-Object { $_.LocalPort -eq $port }).Count
    }

    Write-Output "Connections detected: $activity"

    if ($activity -gt 0) {
        if (!$sleepTimerDisabled) {
            # Disable the sleep timer
            powercfg /change standby-timeout-ac 0
            $sleepTimerDisabled = $true
            Write-Output "Sleep timer disabled. Waiting for 30 minutes."
        }
        # Wait for 30 minutes
        Start-Sleep -Seconds $longInterval
    } else {
        if ($sleepTimerDisabled) {
            # Revert to the original sleep timer
            powercfg /change standby-timeout-ac $originalTimeout
            $sleepTimerDisabled = $false
            Write-Output "No connections detected. Sleep timer reverted to original."
        }
        Write-Output "Waiting for $checkInterval seconds."
        # Wait for the specified interval
        Start-Sleep -Seconds $checkInterval
    }
}
