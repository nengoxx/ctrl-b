import subprocess
from flask import Flask, render_template, request


class Computer:
    def __init__(self, name, ip, mac):
        self.name = name
        self.ip = ip
        self.mac = mac

    def is_awake(self):
        ping_cmd = ["ping", "-c", "1", "-W", "1", self.ip]
        result = subprocess.run(ping_cmd, capture_output=True, text=True)
        return result.returncode == 0

class WolServer:
    def __init__(self, computers, ssh_username):
        self.app = Flask(__name__)
        #self.app.template_folder = './templates/'
        self.computers = computers
        self.ssh_username = ssh_username

        self.app.add_url_rule('/', 'index', self.index)
        self.app.add_url_rule('/wake/<computer_name>', 'wake_computer', self.wake_computer)
        self.app.add_url_rule('/shutdown/<computer_name>', 'shutdown_computer', self.shutdown_computer)

    def send_wol_packet(self, mac_address):
        result = subprocess.run(["wakeonlan", mac_address], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error sending WOL packet: {result.stderr}")

    def ssh_command(self, ip_address, command):
        result = subprocess.run(["ssh", f"{self.ssh_username}@{ip_address}", command],
                                capture_output=True, text=True)
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
            output, error = self.ssh_command(computer.ip, "shutdown -h now")
            if error:
                return f"Error shutting down {computer_name}: {error}"
            else:
                return f"Sending shutdown command to {computer_name}"
        else:
            return "Computer not found"

    def run(self):
        self.app.run(host='0.0.0.0', port=5000, debug=True)

# Configuration
computers = {
    "computer1": Computer("corsair", "100.76.212.35", "00:11:22:33:44:55"),
    "computer2": Computer("vault", "100.102.147.25", "66:77:88:99:AA:BB"),
}
ssh_username = "your_username"  # Replace with your SSH username

wol_server = WolServer(computers, ssh_username)
wol_server.run()
