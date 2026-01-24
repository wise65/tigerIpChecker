const loginForm = document.getElementById('loginForm');
const chatidInput = document.getElementById('chatid');
const loginBtn = document.getElementById('loginBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const errorDiv = document.getElementById('error');
const successDiv = document.getElementById('success');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const chatid = chatidInput.value.trim();
  
  if (!chatid) {
    showError('Please enter your Chat ID');
    return;
  }
  
  await login(chatid);
});

async function login(chatid) {
  // Show loading
  loginBtn.disabled = true;
  btnText.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  hideMessages();
  
  try {
    const response = await fetch('https://tiger-ip-checker.pro/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ chatid })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Store token in localStorage
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('userStatus', data.status);
      localStorage.setItem('userCredits', data.credits);
      localStorage.setItem('chatId', data.chatid);
      
      showSuccess(`✅ Login successful!\n\nStatus: ${data.status}\nCredits: ${data.credits}`);
      
      // Redirect to main page after 1 second
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    } else {
      showError(data.error || 'Login failed');
    }
  } catch (error) {
    showError('Connection error. Please try again.');
    console.error('Login error:', error);
  } finally {
    // Hide loading
    loginBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
  }
}

function showError(message) {
  hideMessages();
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

function showSuccess(message) {
  hideMessages();
  successDiv.textContent = message;
  successDiv.classList.remove('hidden');
}

function hideMessages() {
  errorDiv.classList.add('hidden');
  successDiv.classList.add('hidden');
}
