/////////////////////////////////////////////////////////////////////////////
// DYNAMICALLY LOAD Dashboard at first load
function fetchDashboard() {
	fetch('/dashboard')
		.then(response => response.text())
		.then(html => {
			document.getElementById('content-area').innerHTML = html;

			// Reattach event listeners and start periodic updates
			updateComputerStatuses();
			setInterval(updateComputerStatuses, 30000);
		})
		.catch(error => {
			console.error('Error loading dashboard:', error);
			document.getElementById('content-area').innerHTML = '<p>Failed to load dashboard.</p>';
		});
}

// Dynamically load content based on the navigation links
document.addEventListener('DOMContentLoaded', function () {
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link, .dropdown-item');
    const contentArea = document.getElementById('content-area');

    navLinks.forEach(link => {
        link.addEventListener('click', function (event) {
            event.preventDefault(); // Prevent the default browser behavior
            const targetUrl = this.getAttribute('href');
			if (targetUrl.startsWith('http')) return; // Let the browser handle external links?

            // Ignore links with no valid href or '#' placeholders
            if (!targetUrl || targetUrl === '#') return;

            // Dynamically fetch the content and load it into the container
            fetch(targetUrl)
                .then(response => response.text())
                .then(html => {
                    contentArea.innerHTML = html;

					// Update browser URL
					//history.pushState({ page: targetUrl }, "", targetUrl);

                    // Handle additional logic for specific pages if needed
                    if (targetUrl === '/dashboard') {
                        updateComputerStatuses();
                        setInterval(updateComputerStatuses, 30000);
                    }
					if (targetUrl === '/ip_info') {
						// Evaluate the script tags within the dynamically loaded content
						const scripts = document.getElementById('content-area').getElementsByTagName('script');
						for (let script of scripts) {
							eval(script.innerHTML);
						}
					}


                })
                .catch(error => {
                    console.error('Error fetching content:', error);
                    contentArea.innerHTML = '<p>Failed to load content.</p>';
                });
        });
    });
});


/////////////////////////////////////////////////////////////////////////////
// HANDLE SHUTDOWN MODAL
let computerNameToShutdown = '';

// function wakeComputer(computerName) {
// 	fetch(`/wake/${computerName}`)
// 		.then(response => response.json())
// 		.then(data => {
// 			if (data.error) {
// 				throw new Error(data.error);
// 			}
// 			alert(data.message);
// 			setTimeout(() => location.reload(), 5000); // Reload after 5 seconds
// 		})
// 		.catch(error => alert('Error: ' + error.message));
// }

// NO RELOAD
function wakeComputer(computerName) {
    fetch(`/wake/${computerName}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            alert(data.message);

            // Dynamically update the status to "awake"
            // const statusElement = document.getElementById(`status-${computerName}`);
            // if (statusElement) {
            //     statusElement.classList.remove('status-asleep');
            //     statusElement.classList.add('status-awake');
            // }
        })
        .catch(error => alert('Error: ' + error.message));
}

function setComputerName(computerName) {
	computerNameToShutdown = computerName;
}

function confirmShutdown() {
	const modal = document.getElementById('shutdownModal');
	const bootstrapModal = bootstrap.Modal.getInstance(modal);
	bootstrapModal.hide();

	fetch(`/shutdown/${computerNameToShutdown}`)
		.then(response => response.json())
		.then(data => {
			if (data.error) {
				throw new Error(data.error);
			}
			alert(data.message);
			// setTimeout(() => location.reload(), 5000); // Reload after 5 seconds
		})
		.catch(error => alert('Error: ' + error.message));
}

/////////////////////////////////////////////////////////////////////////////
// HANDLE COMMANDS
async function handleCommand() {
	const inputElement = document.getElementById("command-input");
	const userInput = inputElement.value.trim();

	if (!userInput) {
		alert("Please enter a valid instruction.");
		return;
	}

	if (userInput.startsWith("$")) {
		// Send directly to execute route
		const command = userInput.substring(1); // Remove the '$'
		const response = await fetch("/execute", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ command: command }),
		});

		const data = await response.json();
		//alert(data.message || data.error || "Command executed.");
		// Use the text form instead of the alert
		const suffix = " &REM Command executed!";
		if (!inputElement.value.endsWith(suffix.trim())) {
		inputElement.value += suffix;
		}
	} else {
		// Send to prompt route
		const response = await fetch("/prompt", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ instruction: userInput }),
		});

		const data = await response.json();
		console.log(data.command);
		if (data.command) {
			// Prepend the `$` to the command and update the input field
			inputElement.value = data.command;
		} else {
			alert(data.error || "Failed to retrieve command.");
		}
	}
	// Add response to the log
	addResponseToLog(userInput, inputElement.value.trim());
}

function addResponseToLog(userInput, responseText) {
	const log = document.getElementById("response-log");

	// Create a new list-group-item for the response
	const logItem = document.createElement("div");
	logItem.className = "list-group-item list-group-item-dark";

	// Format the input and response
	logItem.innerHTML = `
		<strong>Input:</strong> ${userInput}<br>
		<strong>Response:</strong> ${responseText}
	`;

	// Add the new item to the top of the log
	log.prepend(logItem);
	// Toggle the input field border radius
	toggleInputBorderRadius();
}

// Toggle the input field border radius based on the existence of log items
function toggleInputBorderRadius() {
	const inputElement = document.getElementById("command-input");
	const log = document.getElementById("response-log");
	if (log.children.length > 0) {
		inputElement.classList.remove("rounded-bottom");
		inputElement.classList.add("square-bottom");
	} else {
		inputElement.classList.remove("square-bottom");
		inputElement.classList.add("rounded-bottom");
	}
}

// Initial check for log items
toggleInputBorderRadius();

// Handle Enter key press
function handleKeyDown(event) {
	if (event.key === 'Enter') {
		event.preventDefault(); // Prevent the default action (form submission)
		handleCommand();
	}
}

/////////////////////////////////////////////////////////////////////////////
// Function to update the computer statuses after the default has been loaded
function updateComputerStatuses() {
	fetch('/status')
		.then(response => response.json())
		.then(data => {
			for (const computerName in data) {
				const isAwake = data[computerName];
				const statusElement = document.getElementById(`status-${computerName}`);
				if (statusElement) {
					if (isAwake) {
						statusElement.classList.remove('status-asleep');
						statusElement.classList.add('status-awake');
					} else {
						statusElement.classList.remove('status-awake');
						statusElement.classList.add('status-asleep');
					}
				}
			}
		})
		.catch(error => console.error('Error fetching computer statuses:', error));
}

// Call updateComputerStatuses when the page loads
window.onload = updateComputerStatuses;