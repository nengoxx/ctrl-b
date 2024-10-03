import yaml
import subprocess
import os
import shutil
from flask import Flask, render_template, request, jsonify
import paramiko  # for SSH functionality
import platform  # to detect the OS
from wakeonlan import send_magic_packet  # for sending WOL packets

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

        result = subprocess.run(ping_cmd, capture_output=True, text=True)
        return result.returncode == 0

class WolServer:
    def __init__(self, config):
        self.app = Flask(__name__)
        self.computers = {
            name: Computer(name, computer['ip'], computer['mac'], computer['ssh_username'], computer['ssh_password'], computer['os_type'])
            for name, computer in config['computers'].items()
        }

        self.app.add_url_rule('/', 'index', self.index)
        self.app.add_url_rule('/wake/<computer_name>', 'wake_computer', self.wake_computer)
        self.app.add_url_rule('/shutdown/<computer_name>', 'shutdown_computer', self.shutdown_computer)

    def send_wol_packet(self, mac_address):
        send_magic_packet(mac_address)

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

    def index(self):
        status = {computer.name: computer.is_awake() for computer in self.computers.values()}
        return render_template('index.html', computers=self.computers, status=status)

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

    def run(self):
        self.app.run(host='0.0.0.0', port=5432, debug=True)

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

if __name__ == "__main__":
    config = load_config('config.yaml')
    wol_server = WolServer(config)
    wol_server.run()