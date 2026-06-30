#!/bin/bash

# IP address of your phone
PHONE_IP="your_phone_ip"

# Username and IP address of your target computer
TARGET_USER="your_target_username"
TARGET_IP="your_target_ip"

# Number of minutes to wait before shutting down the target computer
SHUTDOWN_DELAY=30

# Counter file to keep track of the number of minutes the phone has been offline
COUNTER_FILE="/tmp/phone_offline_counter.txt"

# If the counter file doesn't exist, create it and initialize it to 0
if [ ! -f $COUNTER_FILE ]
then
    echo 0 > $COUNTER_FILE
fi

# Read the counter value from the file
OFFLINE_COUNTER=$(cat $COUNTER_FILE)

# Ping your phone
ping -c 1 $PHONE_IP > /dev/null

# If the ping was successful, reset the counter
if [ $? -eq 0 ]
then
    OFFLINE_COUNTER=0
    echo "Phone is online. Sending WoL magic packet to computer."
    wakeonlan -i $BROADCAST $COMPUTER_MAC
else
    # If the ping failed, increment the counter
    OFFLINE_COUNTER=$((OFFLINE_COUNTER+1))
    echo "Phone is offline. Counter: $OFFLINE_COUNTER"

    # If the phone has been offline for the specified number of minutes,
    # check for active file transfers on the target computer and shut it down if necessary
    if [ $OFFLINE_COUNTER -eq $SHUTDOWN_DELAY ]
    then
        echo "Phone has been offline for $SHUTDOWN_DELAY minutes. Checking for active file transfers on the target computer."

        # Check for active jobs on the target computer
        JOBS=$(pssh -h $TARGET_IP -l $TARGET_USER -t 5 "tasklist /nh")

        # If there are no active file transfers, shut down the target computer
        if [ -z "$JOBS" ]
        then
            echo "No active file transfers found on the target computer. Shutting down."
            ssh $TARGET_USER@$TARGET_IP "shutdown /s"
        else
            echo "Active file transfers found on the target computer. Not shutting down."
        fi
    fi
fi

# Write the counter value to the file
echo $OFFLINE_COUNTER > $COUNTER_FILE