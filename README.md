# AI Dashboard

Easy control over your services.

![Demo](./assets/demo.gif)

Dashboard:

- Monitor server, WOL & shutdown.
- Direct commands (preceded with '$') OR assisted with Koboldcpp backend (default or preceded by 'k:').
- Switch models & start/stop services via assisted command execution. Provide a list of commands, read the sample_prompt.md for more info.
- Simple prompt & after user input prompt files (prompt.md & prompt_after.md).

## To Do

- Prompt formatting support
- Openai endpoint integration (instruction preceded by 'o:')
- Simple chatbot
- Whisper & alltalk integration
- Auto shutdown on idle & wake on connection to local/vpn?
- Discord/Telegram voice bot

## Installation

You will need python 3.11, and also Koboldcpp if you want to use the assistant locally.

Run the install.bat file to install the required packages in a virtual environment.

## Usage

Run the start_wol_server.bat file to start the dashboard. You can connect on <http://127.0.0.1:5432>

- You can send commands directly if you start with an '$'
- By default, or if you start with 'k:' the command will be sent to the Koboldcpp backend and it will return the command ready to send it after reviewing it.
