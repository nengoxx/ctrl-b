import yaml
import subprocess
import os
import shutil
from flask import Flask, render_template, request

class Computer:
    def __init__(self, name, ip, mac, ssh_username, ssh_password):
        self.name = name
        self.ip = ip
        self.mac = mac
        self.ssh_username = ssh_username
        self.ssh_password = ssh_password

    def is_awake(self):
        ping_cmd = ["ping", "-c", "1", "-W", "1", self.ip]
        result = subprocess.run(ping_cmd, capture_output=True, text=True)
        return result.returncode == 0

class WolServer:
    def __init__(self, config):
        self.app = Flask(__name__)
        self.computers = {name: Computer(computer['name'], computer['ip'], computer['mac'], computer['ssh_username'], computer['ssh_password']) for name, computer in config['computers'].items()}

        self.app.add_url_rule('/', 'index', self.index)
        self.app.add_url_rule('/wake/<computer_name>', 'wake_computer', self.wake_computer)
        self.app.add_url_rule('/shutdown/<computer_name>', 'shutdown_computer', self.shutdown_computer)

    def send_wol_packet(self, mac_address):
        result = subprocess.run(["wakeonlan", mac_address], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error sending WOL packet: {result.stderr}")

    def ssh_command(self, computer, command):
        ssh_cmd = f"sshpass -p '{computer.ssh_password}' ssh {computer.ssh_username}@{computer.ip} '{command}'"
        result = subprocess.run(ssh_cmd, shell=True, capture_output=True, text=True)
        return result.stdout, result.stderr

    def index(self):
        status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        return render_template('index.html', computers=self.computers, status=status)

    def wake_computer(self, computer_name):
        computer = self.computers.get(computer_name)
        if computer:
            self.send_wol_packet(computer.mac)
            return f"Sending wake-up packet to {computer_name}"
        else:
            return "Computer not found"

    def shutdown_computer(self, computer_name):
        computer = self.computers.get(computer_name)
        if computer:
            output, error = self.ssh_command(computer, "shutdown -h now")
            if error:
                return f"Error shutting down {computer_name}: {error}"
            else:
                return f"Sending shutdown command to {computer_name}"
        else:
            return "Computer not found"

    def run(self):
        self.app.run(host='0.0.0.0', port=5000, debug=True)

def load_config(filename='config.yaml'):
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

config = load_config('config.yaml')
wol_server = WolServer(config)
wol_server.run()
