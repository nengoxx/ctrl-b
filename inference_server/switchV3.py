import psutil
import subprocess
import time
import os

def find_process_by_name(name):
    for proc in psutil.process_iter(['name', 'cmdline']):
        if proc.info['name'] == name or (proc.info['cmdline'] and name in ' '.join(proc.info['cmdline'])):
            return proc
    return None

def gracefully_stop_process(proc):
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=30)  # Wait up to 30 seconds for graceful shutdown
        except psutil.TimeoutExpired:
            proc.kill()  # Force kill if graceful shutdown fails

def switch_apps():
    kobold_process = find_process_by_name('koboldcpp.exe')
    sd_process = find_process_by_name('python')

    if kobold_process:
        print("KoboldCPP is running. Switching to Stable Diffusion WebUI...")
        gracefully_stop_process(kobold_process)
        
        sd_path = os.path.expandvars(r'%UserProfile%\Documents\github\sd.webui\run.bat')
        subprocess.Popen(sd_path, shell=True)
        print("Stable Diffusion WebUI started.")
    
    elif sd_process:
        print("Stable Diffusion WebUI is running. Switching to KoboldCPP...")
        gracefully_stop_process(sd_process)
        
        kobold_path = r'D:\KoboldCpp\start.bat'
        subprocess.Popen(kobold_path, shell=True)
        print("KoboldCPP started.")
    
    else:
        print("Neither KoboldCPP nor Stable Diffusion WebUI is running.")
        print("Starting KoboldCPP...")
        kobold_path = r'D:\KoboldCpp\start.bat'
        subprocess.Popen(kobold_path, shell=True)

def main():
    while True:
        print("\nPress Enter to switch between KoboldCPP and Stable Diffusion WebUI")
        print("Type 'exit' to quit")
        
        user_input = input().strip().lower()
        
        if user_input == 'exit':
            break
        else:
            switch_apps()
        
        time.sleep(2)  # Wait for 2 seconds before showing the prompt again

if __name__ == "__main__":
    main()