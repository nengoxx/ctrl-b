#!/bin/bash
#Run WoL when phone connects to Local.
#Cron command (crontab -e): * * * * * /path/to/your/script/ping&wol.sh

# IP address of your phone
PHONE_IP="your_phone_ip"

# IP address of your computer
COMPUTER_IP="your_computer_ip"

# MAC address of your computer
COMPUTER_MAC="your_computer_mac"

# Broadcast address (usually the router's IP address with the last octet changed to 255)
BROADCAST="your_broadcast_address"

# Ping your phone
ping -c 1 $PHONE_IP > /dev/null

# If the ping was successful, check if the computer is offline
if [ $? -eq 0 ]
then
    # Ping your computer
    ping -c 1 $COMPUTER_IP > /dev/null

    # If the ping was unsuccessful, send a WoL magic packet
    if [ $? -ne 0 ]
    then
        #echo "Phone is online and computer is offline. Sending WoL magic packet to computer."
        wakeonlan -i $BROADCAST $COMPUTER_MAC
    #else
    #    echo "Phone is online and computer is already online."
    fi
#else
#    echo "Phone is offline."
fi