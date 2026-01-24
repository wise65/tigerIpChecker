const ipInput = document.getElementById('ipInput');
const checkBtn = document.getElementById('checkBtn');
const myIpBtn = document.getElementById('myIpBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const result = document.getElementById('result');
const logoutBtn = document.getElementById('logoutBtn');
const userStatus = document.getElementById('userStatus');

// Check authentication on page load
window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('authToken');
  
  if (!token) {
    // No token - redirect to login
    window.location.href = '/login';
    return;
  }
  
  try {
    // Verify token with server
    const response = await fetch('https://tiger-ip-checker.pro/verify-token', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      // Token invalid or expired
      localStorage.clear();
      window.location.href = '/login';
      return;
    }
    
    const data = await response.json();
    
    // Update stored data (in case credits changed)
    localStorage.setItem('userStatus', data.status);
    localStorage.setItem('userCredits', data.credits);
    
    // Show user info
    userStatus.textContent = `Status: ${data.status} | Credits: ${data.credits}`;
    
    // Auto-detect and check IP
    getMyIP();
  } catch (err) {
    console.error('Auth check error:', err);
    localStorage.clear();
    window.location.href = '/login';
  }
});

// Logout function
logoutBtn.addEventListener('click', async () => {
  const token = localStorage.getItem('authToken');
  
  try {
    await fetch('https://tiger-ip-checker.pro/logout', { 
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  } catch (err) {
    console.error('Logout error:', err);
  }
  
  // Clear local storage and redirect
  localStorage.clear();
  window.location.href = '/login';
});

// Event listeners
checkBtn.addEventListener('click', () => checkIP(ipInput.value));
myIpBtn.addEventListener('click', getMyIP);
ipInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') checkIP(ipInput.value);
});

// Get user's IP and check it automatically
async function getMyIP() {
  try {
    showLoading();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error('Failed to get IP address');
    }
    
    const data = await response.json();
    ipInput.value = data.ip;
    await checkIP(data.ip);
  } catch (err) {
    hideAll();
    if (err.name === 'AbortError') {
      showError('Connection timeout. Please check your internet connection or try again.');
    } else {
      showError('Failed to get your IP address. Please enter it manually or check your connection.');
    }
    console.error('Get IP error:', err);
  }
}

// Validate IP address
function isValidIP(ip) {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  
  const parts = ip.split('.');
  return parts.every(part => parseInt(part) >= 0 && parseInt(part) <= 255);
}

// Check IP address
async function checkIP(ip) {
  if (!ip.trim()) {
    showError('Please enter an IP address');
    return;
  }

  if (!isValidIP(ip)) {
    showError('Please enter a valid IP address');
    return;
  }

  showLoading();

  const token = localStorage.getItem('authToken');
  
  if (!token) {
    showError('Please log in again');
    setTimeout(() => {
      window.location.href = '/login';
    }, 2000);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://tiger-ip-checker.pro/check-ip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ ip }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      // Handle unauthorized (token expired)
      if (response.status === 401) {
        localStorage.clear();
        showError('Session expired. Redirecting to login...');
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
        return;
      }
      
      throw new Error(data.error || 'Failed to check IP');
    }

    displayResults(data);
  } catch (err) {
    hideAll();
    if (err.name === 'AbortError') {
      showError('Request timeout. The server took too long to respond. Please try again.');
    } else {
      showError(err.message || 'An error occurred. Please try again.');
    }
    console.error('Check IP error:', err);
  }
}

function showLoading() {
  hideAll();
  loading.classList.remove('hidden');
}

// Display results
function displayResults(data) {
  const ipData = data.data;
  
  hideAll();
  result.classList.remove('hidden');
  
  document.getElementById('resultIp').textContent = ipData.ipAddress;

  const igStatus = checkIGQuality(ipData);
  const igStatusDiv = document.getElementById('igStatus');
  
  if (igStatus.isGood) {
    igStatusDiv.innerHTML = `✅ ${igStatus.message}`;
    igStatusDiv.className = 'status safe';
  } else {
    igStatusDiv.innerHTML = `❌ ${igStatus.message}`;
    igStatusDiv.className = 'status danger';
  }

  const vpnStatus = document.getElementById('vpnStatus');
  if (ipData.usageType === 'Data Center/Web Hosting/Transit' || 
      ipData.usageType === 'Commercial' ||
      ipData.isTor) {
    vpnStatus.innerHTML = '⚠️ VPN/Proxy Detected';
    vpnStatus.className = 'status warning';
  } else {
    vpnStatus.innerHTML = '✅ Residential IP';
    vpnStatus.className = 'status safe';
  }

  const blacklistStatus = document.getElementById('blacklistStatus');
  if (ipData.isWhitelisted) {
    blacklistStatus.innerHTML = '✅ Whitelisted';
    blacklistStatus.className = 'status safe';
  } else if (ipData.abuseConfidenceScore > 75) {
    blacklistStatus.innerHTML = '❌ Blacklisted';
    blacklistStatus.className = 'status danger';
  } else if (ipData.abuseConfidenceScore > 25) {
    blacklistStatus.innerHTML = '⚠️ Suspicious';
    blacklistStatus.className = 'status warning';
  } else {
    blacklistStatus.innerHTML = '✅ Clean';
    blacklistStatus.className = 'status safe';
  }

  const abuseScore = document.getElementById('abuseScore');
  const score = ipData.abuseConfidenceScore;
  abuseScore.innerHTML = `${score}%`;
  if (score > 75) {
    abuseScore.className = 'status danger';
  } else if (score > 25) {
    abuseScore.className = 'status warning';
  } else {
    abuseScore.className = 'status safe';
  }

  const detailsContent = document.getElementById('detailsContent');
  detailsContent.innerHTML = `
    <div class="detail-item">
      <span class="detail-label">Country:</span>
      <span class="detail-value">${ipData.countryName || 'Unknown'}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">ISP:</span>
      <span class="detail-value">${ipData.isp || 'Unknown'}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Total Reports:</span>
      <span class="detail-value">${ipData.totalReports}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Last Report:</span>
      <span class="detail-value">${ipData.lastReportedAt ? formatDate(ipData.lastReportedAt) : 'Never'}</span>
    </div>
  `;
}

function checkIGQuality(ipData) {
  const totalReports = ipData.totalReports;
  const lastReportedAt = ipData.lastReportedAt;
  
  if (totalReports === 0) {
    return { isGood: true, message: 'Perfect for IG/FB (No reports)' };
  }
  
  if (totalReports <= 5) {
    if (lastReportedAt) {
      const lastReport = new Date(lastReportedAt);
      const now = new Date();
      const daysSinceReport = Math.floor((now - lastReport) / (1000 * 60 * 60 * 24));
      
      if (daysSinceReport >= 30) {
        return { isGood: true, message: `Good for IG/FB (${totalReports} old reports, ${daysSinceReport} days ago)` };
      }
    }
  }
  
  return { isGood: false, message: `Bad for IG/FB (${totalReports} reports, too recent or too many)` };
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 60) return '1 month ago';
  return `${Math.floor(days / 30)} months ago`;
}

function showError(message) {
  hideAll();
  error.textContent = message;
  error.classList.remove('hidden');
}

function hideAll() {
  loading.classList.add('hidden');
  error.classList.add('hidden');
  result.classList.add('hidden');
}
