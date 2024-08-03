# Import the necessary assembly for SendKeys
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