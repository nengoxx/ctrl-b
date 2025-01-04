# AI Dashboard

Easy control over your services.

![Demo](./assets/demo.gif)

Dashboard:

- Monitor server, WOL & shutdown.
- Direct commands (preceded with '$') OR assisted with Koboldcpp backend.
- Switch models & start/stop services via assisted command execution. Provide a list of commands, read the sample_prompt.md for more info.

## To Do

- Simple chatbot
- Whisper & alltalk integration
- Auto shutdown on idle & wake on connection to local/vpn?
- Discord/Telegram voice bot

## Installation

You will need python 3.11 and koboldcpp if you want to use the chatbot. Run the install.bat file to install the required packages.

## Usage

Run the start_wol_server.bat file to start the dashboard. You can connect on <http://127.0.0.1:5432>
