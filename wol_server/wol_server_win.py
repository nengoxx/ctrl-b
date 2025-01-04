import yaml
import subprocess
import os
import shutil
from flask import Flask, render_template, request, jsonify
import paramiko  # for SSH functionality
import platform  # to detect the OS
from wakeonlan import send_magic_packet  # for sending WOL packets
import requests  # for sending requests to the LLM server

############################
## Variables
############################
config_filename = "config.yaml"
prompt_filename = "prompt.md"

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
    def __init__(self, config):
        self.app = Flask(__name__)
        self.computers = {
            name: Computer(name, computer['ip'], computer['mac'], computer['ssh_username'], computer['ssh_password'], computer['os_type'])
            for name, computer in config['computers'].items()
        }

        ### Routes ############################
        self.app.add_url_rule('/', 'index', self.index)
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
            return jsonify({"message": "Command executed successfully"}), 200
        except Exception as e:
            return jsonify({"error": f"Failed to execute command: {str(e)}"}), 500

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
        if not os.path.exists(prompt_filename):
            # If not, check if the sample prompt file exists
            sample_filename = 'prompt_sample.md'
            if os.path.exists(sample_filename):
                # Copy the sample prompt file to the prompt file
                shutil.copy(sample_filename, prompt_filename)
            else:
                raise FileNotFoundError(f"Neither {prompt_filename} nor {sample_filename} found.")

        try:
            with open(prompt_filename, "r") as file:
                base_prompt = file.read()
            with open(config_filename, 'r') as file:
                config_prompt = yaml.safe_load(file)
                config_prompt = yaml.dump(config_prompt, default_flow_style=False)

            crafted_prompt = f"# Configuration:\n\n{config_prompt}\n{base_prompt}\n{user_input.strip().capitalize()}\n\n# Command:" # ORDER MATTERS
            print(f"Prompt:\n{crafted_prompt}")
            return crafted_prompt
        except Exception as e:
            print(f"Error reading prompt.txt: {e}")
            return None

    # Function to send the crafted prompt to KoboldCPP LLM and get the response
    def query_kobold_cpp(self, prompt):
        url = "http://localhost:5001/api/v1/generate"  # KoboldCPP inference server URL
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
    def query_openai(self, prompt):
        url = "http://localhost:5001/api/v1/generate"  # KoboldCPP inference server URL
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
    
    # Function to handle the LLM prompt
    def command_prompt(self):
        user_input = request.json.get('instruction')
        if not user_input:
            return jsonify({"error": "No input provided"}), 400

        # Check if the input is a command
        if user_input.startswith('$'):
            # Forward to execute command
            command = user_input[1:]  # Remove the '$'
            return self.execute_command(command)
        
        # Send to LLM instead
        if user_input:
            crafted_prompt = self.get_crafted_prompt(user_input)
            if crafted_prompt:
                response_text = self.query_kobold_cpp(crafted_prompt)
            else:
                response_text = "Error: Unable to craft prompt."

            return jsonify({"command": response_text})  # Return JSON response

        # Render the template with the necessary context
        status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        return render_template("index.html", computers=self.computers, status=status, response_text=response_text)
    

    ############################
    ## Index
    ############################

    def index(self):
        status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        return render_template('index.html', computers=self.computers, status=status)

    def run(self):
        self.app.run(host='0.0.0.0', port=5432, debug=True)

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

### Now I just need you to giver me the corresponding code for the index.html file, and remember: I want a text form with a send/enter button on the side as any chat app, the same style as the buttons I have already on my index.html. That text form & button combo will have 2 functions: first the user will input the instruction in plain text (not preceded with $), that text will be sent to the LLM, then after querying the LLM (self.app.add_url_rule('/prompt', 'command_prompt', self.execute_command, methods=['POST'])), the specific command returned by the LLM will replace the form text prepended with $, so the next time the user inputs the text, since its preceded with $, it will send it directly to the execute command route (self.app.add_url_rule('/execute', 'execute_command', self.execute_command, methods=['POST'])).