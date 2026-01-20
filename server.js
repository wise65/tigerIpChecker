require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

const app = express();

// Security middleware
let helmet, rateLimit;
try {
  helmet = require('helmet');
  rateLimit = require('express-rate-limit');
} catch (err) {
  console.log('⚠️ Optional packages not installed:', err.message);
}

if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
}

if (rateLimit) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
  });
  app.use('/check-ip', limiter);
}

// CORS configuration
const corsOptions = {
  origin: true,
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(__dirname));

// MongoDB connection
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://cent_wise:Senty017@cluster0.se6rjbj.mongodb.net/?retryWrites=true&w=majority';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'your-super-secret-jwt-key-change-in-production';
let db;
let licensesCol;

async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGODB_URI);
    db = client.db('IG_PassChange');
    licensesCol = db.collection('users');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

connectDB();

const API_KEY = process.env.ABUSEIPDB_API_KEY || 'a37f2145505d4e325ae188307fda07d779c7aa3415df8d9f1f82ddf7875cbc463b7d60803eb7bb70';

// Middleware to verify JWT token
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'Authentication required', redirect: '/login' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is expired (2 hours)
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      console.log('⏰ Token expired for:', decoded.chatid);
      return res.status(401).json({ error: 'Session expired', redirect: '/login' });
    }
    
    req.user = decoded;
    console.log('✅ Token verified for:', decoded.chatid);
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid token', redirect: '/login' });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Login endpoint - returns JWT token
app.post('/login', async (req, res) => {
  const { chatid } = req.body;

  console.log('📥 Login attempt for:', chatid);

  if (!chatid) {
    return res.status(400).json({ error: 'Chat ID is required' });
  }

  try {
    const user = await licensesCol.findOne({ chat_id: parseInt(chatid) });

    if (user) {
      if (user.status === 'banned') {
        return res.status(403).json({ error: '🚫 You are banned from using this service.' });
      }

      // Create JWT token (expires in 2 hours)
      const token = jwt.sign(
        {
          chatid: chatid,
          status: user.status || 'active',
          credits: user.credits || 0
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      console.log(`✅ User logged in: ${chatid}`);

      return res.json({
        success: true,
        token: token,
        status: user.status || 'active',
        credits: user.credits || 0,
        chatid: chatid
      });
    } else {
      console.log(`❌ Login failed: Chat ID ${chatid} not found`);
      res.status(401).json({ error: 'Access denied. Chat ID not found in database.' });
    }
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Logout endpoint (client-side just removes token)
app.post('/logout', (req, res) => {
  console.log('✅ User logged out');
  res.json({ success: true });
});

// Verify token endpoint
app.get('/verify-token', requireAuth, (req, res) => {
  res.json({ 
    authenticated: true,
    chatid: req.user.chatid,
    status: req.user.status,
    credits: req.user.credits
  });
});

// IP check endpoint - requires authentication
app.post('/check-ip', requireAuth, async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ error: 'IP address is required' });
  }

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address format' });
  }

  try {
    console.log(`🔍 Checking IP: ${ip} for user: ${req.user.chatid}`);
    
    const response = await axios.get('https://api.abuseipdb.com/api/v2/check', {
      params: {
        ipAddress: ip,
        maxAgeInDays: 90,
        verbose: true
      },
      headers: {
        'Key': API_KEY,
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log(`✅ IP check successful: ${ip}`);
    res.json(response.data);
  } catch (error) {
    console.error('❌ IP check error:', error.message);
    
    let errorMessage = 'Failed to check IP address';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout. Please check your connection and try again.';
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      errorMessage = 'Cannot reach AbuseIPDB API. Please check your internet connection.';
    } else if (error.response) {
      errorMessage = error.response.data?.errors?.[0]?.detail || 'API Error: ' + error.response.status;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).redirect('/login');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60));
});
