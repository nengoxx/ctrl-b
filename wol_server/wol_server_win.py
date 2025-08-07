import logging
import time
import yaml
import subprocess
import os
import shutil
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
import paramiko  # for SSH functionality
import platform  # to detect the OS
from wakeonlan import send_magic_packet  # for sending WOL packets
import requests  # for sending requests to the LLM server
from openai import OpenAI

## YouTube Captions
import io, json
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter
import requests
from bs4 import BeautifulSoup


############################
## Variables
############################
config_filename = "config.yaml"
sample_prompt_filename = 'prompt_sample.txt'
command_prompt_filename = "command_prompt.txt" # command prompt file
command_post_prompt_filename = "command_post_prompt.txt" # after user input prompt file(optional)
chat_system_prompt_filename = "system_prompt.txt" # chat system prompt file(optional)
chat_post_prompt_filename = "post_prompt.txt" # chat post prompt file(optional)

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

class Computer:
    def __init__(self, name, ip, mac, ssh_username, ssh_password, os_type):
        self.name = name
        self.ip = ip
        self.mac = mac
        self.ssh_username = ssh_username
        self.ssh_password = ssh_password
        self.os_type = os_type  # Target OS (Windows or Linux)

    def is_awake(self):
        if platform.system().lower() == "windows":
            ping_cmd = ["ping", self.ip, "-n", "1"]  # Windows uses -n for ping count
        else:
            ping_cmd = ["ping", "-c", "1", self.ip]  # Linux uses -c for ping count

        result = subprocess.run(ping_cmd, capture_output=True, text=True) ########### ASYNC to not stop the loading? 
        return result.returncode == 0

class WolServer:
    app = Flask(__name__)

    def __init__(self, config):
        
        self.computers = {
            name: Computer(name, computer['ip'], computer['mac'], computer['ssh_username'], computer['ssh_password'], computer['os_type'])
            for name, computer in config['computers'].items()
        }

        self.inference_endpoint = config.get('inference_endpoint')
        self.cloud_inference_endpoint = config.get('cloud_inference_endpoint')
        self.cloud_inference_key = config.get('cloud_inference_key')
        self.cloud_inference_model = config.get('cloud_inference_model')
        self.local_inference = config.get('local_inference')
        
        default_status = {computer.name: False for computer in self.computers.values()}  # Default to asleep
        self.previous_status = default_status

        ### Routes ############################
        self.app.add_url_rule('/', 'index', self.index)
        self.app.add_url_rule('/dashboard', 'dashboard', self.show_dashboard)
        self.app.add_url_rule('/status', 'get_computer_statuses', self.get_computer_statuses)
        self.app.add_url_rule('/wake/<computer_name>', 'wake_computer', self.wake_computer)
        self.app.add_url_rule('/shutdown/<computer_name>', 'shutdown_computer', self.shutdown_computer)

        self.app.add_url_rule('/execute', 'execute_command', self.execute_command, methods=['POST'])
        self.app.add_url_rule('/prompt', 'command_prompt', self.command_prompt, methods=['POST'])


    ############################
    ## Utility Functions
    ############################

    # Execute command on the server
    def execute_command(self, command=None):
        if not command:
            command = request.json.get('command')
        if not command:
            return jsonify({"error": "No command provided"}), 400
        try:
            # Open a new cmd window to execute the command
            subprocess.Popen(['cmd', '/k', command], shell=True)
            return jsonify({"message": "Command executed successfully","command": "Command executed successfully"}), 200
        except Exception as e:
            return jsonify({"error": f"Failed to execute command: {str(e)}","command": f"Failed to execute command: {str(e)}"}), 500

    def get_computer_statuses(self):
        """Returns the current computer statuses as JSON."""
        status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        self.previous_status = status # Update the previous status with the current status
        return jsonify(self.previous_status)

    # Send WOL packet
    def send_wol_packet(self, mac_address):
        send_magic_packet(mac_address)

    # Execute SSH command on target computer
    def ssh_command(self, computer, command):
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(
               computer.ip, 
               port=22,  # Specify the correct port here
               username=computer.ssh_username, 
               password=computer.ssh_password,
               timeout=10  # Add a timeout
            )
            stdin, stdout, stderr = ssh.exec_command(command)
            return stdout.read(), stderr.read()
        except paramiko.AuthenticationException:
            return None, "Authentication failed. Check username and password."
        except paramiko.SSHException as ssh_ex:
            return None, f"SSH error: {str(ssh_ex)}"
        except Exception as e:
            return None, str(e)
        finally:
            ssh.close()

    # Wake up target computer
    def wake_computer(self, computer_name):
        computer = self.computers.get(computer_name)
        if computer:
            try:
                self.send_wol_packet(computer.mac)
                return jsonify({"message": f"Sent wake-up packet to {computer_name}"}), 200
            except Exception as e:
                return jsonify({"error": f"Failed to wake {computer_name}: {str(e)}"}), 500
        else:
            return jsonify({"error": "Computer not found"}), 404

    # Shutdown target computer
    def shutdown_computer(self, computer_name):
        computer = self.computers.get(computer_name)
        if computer:
            if computer.os_type.lower() == "windows":
                command = "shutdown /s /f /t 0"  # Windows shutdown command
            elif computer.os_type.lower() == "linux":
                command = "sudo shutdown now"  # Linux shutdown command
            else:
                return jsonify({"error": f"Unsupported OS type: {computer.os_type}"}), 400

            try:
                output, error = self.ssh_command(computer, command)
                if error:
                    return jsonify({"error": f"Failed to shutdown {computer_name}: {error}"}), 500
                return jsonify({"message": f"Sent shutdown command to {computer_name}"}), 200
            except Exception as e:
                return jsonify({"error": f"Failed to shutdown {computer_name}: {str(e)}"}), 500
        else:
            return jsonify({"error": "Computer not found"}), 404
        

    ############################
    ## LLM Functions
    ############################

    # Function to read the prompt file and append user input
    def get_crafted_prompt(self, user_input):
        if not os.path.exists(command_prompt_filename):
            # If not, check if the sample prompt file exists
            if os.path.exists(sample_prompt_filename):
                # Copy the sample prompt file to the prompt file
                shutil.copy(sample_prompt_filename, command_prompt_filename)
            else:
                raise FileNotFoundError(f"Neither {command_prompt_filename} nor {sample_prompt_filename} found.")

        try:
            with open(command_prompt_filename, "r", encoding="utf-8") as file:
                base_prompt = file.read()
            if os.path.exists(command_post_prompt_filename):
                with open(command_post_prompt_filename, "r", encoding="utf-8") as file:
                    after_prompt = file.read()
                crafted_prompt = f"{base_prompt}\n\n{user_input.strip().capitalize()}\n\n{after_prompt}" # ORDER MATTERS
            else:
                crafted_prompt = f"{base_prompt}\n\n{user_input.strip().capitalize()}" # ORDER MATTERS
            print(f"Prompt:\n{crafted_prompt}")
            return crafted_prompt
        except Exception as e:
            print(f"Error reading prompt.txt: {e}")
            return None

    # Function to send the crafted prompt to KoboldCPP LLM and get the response
    def query_kobold_cpp(self, prompt):
        #url = "http://localhost:5001/api/v1/generate"  # KoboldCPP inference server URL
        url = self.inference_endpoint
        headers = {"Content-Type": "application/json"}
        payload = {"prompt": prompt, "max_length": 100}

        try:
            #print(f"Sending to LLM:\n{payload}")  # Debugging log
            response = requests.post(url, json=payload, headers=headers)
            #response_text = response.json().get("results")
            #print(f"Response from LLM:\n{response_text}")  # Debugging log
            if response.status_code == 200:
                return response.json().get("results")[0].get("text", "Error: No response received").strip()
            else:
                return f"Error: {response.status_code} - {response.text}"
        except requests.exceptions.RequestException as e:
            return f"Error connecting to LLM server: {e}"
        
    # Function to send the crafted prompt to an OpenAI endpoint
    def query_openai(self, sysPrompt, userPrompt=None, postPrompt=None, max_retries=3, retry_delay=1):
        client = OpenAI(
            base_url=self.cloud_inference_endpoint,
            api_key=self.cloud_inference_key,
        )

        prompt = [
            {
                "role": "system",
                "content": sysPrompt.strip()+"\n"
            }
        ]

        if userPrompt:
            prompt.append({
                "role": "user",
                "content": userPrompt.strip().capitalize()+"\n"
            })

        if postPrompt:
            prompt.append({
                "role": "user",
                "content": postPrompt.strip()+"\n"
            })
        
        print(f"Prompt:\n{prompt}")  # Debugging log
        # print(f"System prompt:\n{prompt[0]['content']}")  # Debugging log
        for attempt in range(max_retries):
            try:
                completion = client.chat.completions.create(
                    model=self.cloud_inference_model,
                    messages=prompt
                )
                print(f"Completion response (attempt {attempt + 1}):\n{completion}")
                response = completion.choices[0].message.content.strip()
                # print(f"Response from LLM (attempt {attempt + 1}):\n{response}")
                return response
            except requests.exceptions.RequestException as e:
                errormsg = ''
                if completion.error:
                    if completion.error['message']:
                        errormsg = completion.error['message']

                print(f"Error connecting to LLM server (attempt {attempt + 1}): {errormsg} - {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)  # Wait before retrying
                else:
                    return f"Error: Could not connect to LLM server after {max_retries} attempts."
            except Exception as e: # Catch other potential OpenAI errors
                errormsg = ''
                if completion.error:
                    if completion.error['message']:
                        errormsg = completion.error['message']

                print(f"OpenAI API Error (attempt {attempt + 1}): {errormsg} - {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay) # Wait before retrying
                else:
                    return f"Error: OpenAI API call failed after {max_retries} attempts: {errormsg} - {e}"
    
    # Function to handle the LLM prompt
    def command_prompt(self):
        user_input = request.json.get('instruction')
        if not user_input:
            return jsonify({"error": "No input provided"}), 400

        # Check if the input is a command
        if user_input.startswith('$') or user_input.startswith('>'):
        # Forward to execute command
            command = user_input[1:]  # Remove the '$'
            return self.execute_command(command)
        elif user_input.startswith("k:"):
            prompt = user_input[len("k:"):]
            response_text = self.query_kobold_cpp(prompt)
        elif user_input.startswith("o:"):
            prompt = user_input[len("o:"):]
            response_text = self.query_openai(prompt)
        else:
            # Default to preferred endpoint if no prefix
            crafted_prompt = self.get_crafted_prompt(user_input)
            if crafted_prompt:
                if self.local_inference:
                    response_text = self.query_kobold_cpp(crafted_prompt)
                else:
                    response_text = self.query_openai(crafted_prompt)
            else:
                response_text = "Error: Unable to craft prompt."

        return jsonify({"command": response_text})
        # if user_input.startswith('$'):
        #     # Forward to execute command
        #     command = user_input[1:]  # Remove the '$'
        #     return self.execute_command(command)
        
        # # Send to LLM instead
        # if user_input:
        #     crafted_prompt = self.get_crafted_prompt(user_input)
        #     if crafted_prompt:
        #         response_text = self.query_kobold_cpp(crafted_prompt)
        #     else:
        #         response_text = "Error: Unable to craft prompt."

        #     return jsonify({"command": response_text})  # Return JSON response

    @app.route('/chat_api', methods=['POST'])
    def chat_api():
        user_input = request.json.get('instruction')
        if not user_input:
            return jsonify({"error": "No input provided"}), 400

        try:
            # Check for the optional prompt files
            sys_prompt = ""
            if os.path.exists(chat_system_prompt_filename):
                with open(chat_system_prompt_filename, "r", encoding="utf-8") as sys_file:
                    sys_prompt = sys_file.read().strip()
            else:
                sys_prompt = "You are a helpful assistant."  # Default system prompt

            post_prompt = ""
            if os.path.exists(chat_post_prompt_filename):
                with open(chat_post_prompt_filename, "r", encoding="utf-8") as post_file:
                    post_prompt = post_file.read().strip()

            # Send prompts to OpenAI
            response = wol_server.query_openai(
                sysPrompt=sys_prompt,
                userPrompt=user_input,
                postPrompt=post_prompt
            )
            return jsonify({"command": response})

        except Exception as e:
            return jsonify({"error": f"An error occurred: {str(e)}"}), 500

    ############################
    ## YT Captions
    ############################

    # Extract video ID from a YouTube URL (caption dowload)
    def extract_video_id(url: str):
        parsed = urlparse(url)
        if parsed.hostname in ('www.youtube.com', 'youtube.com') or parsed.path == 'www.youtube.com/watch':
            if parsed.path == '/watch' or parsed.path == 'www.youtube.com/watch':
                return parse_qs(parsed.query).get('v', [None])[0]
            if parsed.path.startswith(('/embed/', '/shorts/')):
                return parsed.path.split('/')[2]
        if parsed.hostname == 'youtu.be':
            return parsed.path.lstrip('/')
        return None
    
    def get_video_title(video_id):
        # YouTube Video URL
        url = f'https://www.youtube.com/watch?v={video_id}'

        # Extracting HTML Code of the Video Page:
        response = requests.get(url)
        html_content = response.text

        # Processing the HTML Code with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')

        # Extracting <title> tag's content
        title_tag = soup.find('meta', property='og:title')
        video_title = title_tag['content'] if title_tag else video_id

        return(video_title)


    @app.route('/yt_caption')
    def yt_caption():
        return render_template('yt_caption.html')

    @app.route('/yt_caption_api', methods=['POST'])
    
    def yt_caption_api():
        video_url = request.json.get('url', '')
        video_id = WolServer.extract_video_id(video_url)
        if not video_id:
            return jsonify({'error': 'Invalid YouTube URL'}), 400
        try:
            ytt_api = YouTubeTranscriptApi()
            transcript = ytt_api.fetch(video_id)
        except Exception as e:
            return jsonify({'error': str(e)}), 400
        formatter = JSONFormatter()

        # .format_transcript(transcript) turns the transcript into a JSON string.
        data = formatter.format_transcript(transcript).encode('utf-8')
        #data = formatter.format_transcript(transcript, indent=2).encode('utf-8') #prettier json

        video_title = WolServer.get_video_title(video_id)

        return send_file(
            io.BytesIO(data),
            mimetype='application/json',
            as_attachment=True,
            download_name=video_title+'_captions.json'
        )


    ############################
    ## Index
    ############################

    def index(self):
        # status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        # return render_template('index.html', computers=self.computers, status=status)
        return render_template('index.html', computers=self.computers, status=self.previous_status)
    
    def show_dashboard(self):
        return render_template('dashboard.html', computers=self.computers, status=self.previous_status)
    
    @app.route('/ip_info')
    def ip_info():
        return render_template('ip_info.html')

    @app.route('/chat')
    def chat():
        return render_template('chat.html')

    @app.route('/settings')
    def settings():
        return render_template('settings.html')


    def run(self):
        self.app.run(host='0.0.0.0', port=5432, debug=True)


############################

def load_config(filename=config_filename):
    # Check if the config file exists
    if not os.path.exists(filename):
        # If not, check if the sample config file exists
        sample_filename = 'config_sample.yaml'
        if os.path.exists(sample_filename):
            # Copy the sample config file to the config file
            shutil.copy(sample_filename, filename)
        else:
            raise FileNotFoundError(f"Neither {filename} nor {sample_filename} found.")

    # Load the config file
    with open(filename, 'r') as f:
        return yaml.safe_load(f)

if __name__ == "__main__":
    config = load_config(config_filename)
    wol_server = WolServer(config)
    wol_server.run()
