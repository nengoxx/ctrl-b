param (
    [string]$DriveLetter,
    [string]$User = "computer\user"
)
 
$shareName = "USBShare"
$description = "Auto-shared USB drive"
 
# Create the share with full access for the local user
New-SmbShare -Name $shareName -Path "${DriveLetter}\" -FullAccess $User -Description $description


# XML Event Filter
 
# Create a Task in Task Scheduler:
# Open Task Scheduler and create a new task.
# Name the task (e.g., “Auto Share USB Drive”).
# Go to the Triggers tab and create a new trigger:
# Set the trigger to “On an event”.
# Choose “Custom” and click “New Event Filter”.
# In the XML tab, paste the following code to trigger on USB connection events:
 
# The XML event filter is designed to trigger on USB connection events. Here’s the XML again:
 
# XML
 
# <QueryList>
#   <Query Id="0" Path="System">
#     <Select Path="System">
#       *[System[Provider[@Name='Microsoft-Windows-DriverFrameworks-UserMode'] and (EventID=2003)]]
#     </Select>
#   </Query>
# </QueryList>

# Go to the Actions tab and create a new action:
# Set the action to “Start a program”.
# In the “Program/script” field, enter powershell.exe.
# In the “Add arguments” field, enter -File "C:\Path\To\AutoShareUSB.ps1" -DriveLetter $env:DriveLetter.
# Adjust the Script Path: Make sure to replace "C:\Path\To\AutoShareUSB.ps1" with the actual path to your script.
 
# This setup will ensure that the PowerShell script runs only when a USB drive is connected, automatically sharing it with full access for the user computer\user.