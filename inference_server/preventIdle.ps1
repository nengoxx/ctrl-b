<# # Import the necessary assembly for SendKeys
Add-Type -AssemblyName System.Windows.Forms

# Define the IP address or hostname of your phone
$phoneIP = "192.168.1.100"  # Replace with your phone's actual IP address

# Set the maximum number of ping attempts
$pingAttempts = 3

# Function to test if the phone is connected to the network
function Test-PhoneConnection {
    $pingResult = Test-Connection -ComputerName $phoneIP -Count $pingAttempts -Quiet
    return $pingResult
}

# Function to prevent the server from idling
function Set-PreventIdle {
    # Simulate a keypress (e.g., CAPS LOCK key) to keep the server awake
    [System.Windows.Forms.SendKeys]::SendWait("{CAPSLOCK}")
    [System.Windows.Forms.SendKeys]::SendWait("{CAPSLOCK}")
}

# Check if the phone is connected
if (Test-PhoneConnection) {
    Write-Output "Phone is connected. Preventing idle state..."
    Set-PreventIdle
} else {
    Write-Output "Phone is not connected. No action taken."
}
#---- #>

$interval = 60 # Check every 60 seconds when no connections
$longInterval = 1800 # Check every 30 minutes when connections are detected
$portsToCheck = @(8000, 7860, 5000, 5001, 80) # List of ports to check for connections
$originalTimeout = 3600 # Original sleep timeout in seconds (1 hour)

while ($true) {
    $activity = 0

    foreach ($port in $portsToCheck) {
        $activity += (Get-NetTCPConnection -State Established | Where-Object { $_.LocalPort -eq $port }).Count
    }

    Write-Output "Connections detected: $activity"

    if ($activity -gt 0) {
        # Disable the sleep timer
        powercfg /change standby-timeout-ac 0
        Write-Output "Sleep timer disabled. Waiting for 30 minutes."
        # Wait for 30 minutes
        Start-Sleep -Seconds $longInterval
    } else {
        # Revert to the original sleep timer
        powercfg /change standby-timeout-ac $originalTimeout
        Write-Output "No connections detected. Sleep timer reverted to original. Waiting for 60 seconds."
        # Wait for 60 seconds
        Start-Sleep -Seconds $interval
    }
}
