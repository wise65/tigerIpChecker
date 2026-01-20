require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const { MongoClient } = require('mongodb');

const app = express();

// Only require these if installed
let helmet, rateLimit, MongoStore;
try {
  helmet = require('helmet');
  rateLimit = require('express-rate-limit');
  MongoStore = require('connect-mongo');
} catch (err) {
  console.log('⚠️ Optional packages not installed:', err.message);
}

// Security middleware (if installed)
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
}

// Rate limiting - prevent abuse (if installed)
if (rateLimit) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
  });
  app.use('/check-ip', limiter);
}

// IMPORTANT: Trust proxy for production (needed for secure cookies behind reverse proxy)
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  app.set('trust proxy', 1); // Trust first proxy
}

// CORS configuration - SIMPLIFIED for same-origin
const corsOptions = {
  origin: true, // Reflects request origin
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(__dirname));

// MongoDB connection
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://cent_wise:Senty017@cluster0.se6rjbj.mongodb.net/?retryWrites=true&w=majority';
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

// Session configuration
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-super-secret-random-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
    httpOnly: true,
    secure: isProduction, // only true in production
    sameSite: 'lax',
    path: '/'
  }
};

// Add MongoStore if available
if (MongoStore) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: MONGODB_URI,
    dbName: 'IG_PassChange',
    collectionName: 'sessions',
    ttl: 2 * 60 * 60,
    touchAfter: 24 * 3600
  });
  console.log('✅ Using MongoDB session store');
} else {
  console.log('⚠️ Using memory session store (sessions will be lost on restart)');
  console.log('⚠️ Install connect-mongo: npm install connect-mongo');
}

app.use(session(sessionConfig));

// Debug helper: echo origin and allow credentials so browser accepts Set-Cookie for fetch with credentials
app.use((req, res, next) => {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

const API_KEY = process.env.ABUSEIPDB_API_KEY || 'a37f2145505d4e325ae188307fda07d779c7aa3415df8d9f1f82ddf7875cbc463b7d60803eb7bb70';

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  console.log('🔐 Auth check - Session ID:', req.sessionID);
  console.log('🔐 Auth check - Chat ID:', req.session?.chatid ? 'Valid' : 'Invalid');
  console.log('🔐 Auth check - Cookie:', req.headers.cookie);
  
  if (req.session && req.session.chatid) {
    next();
  } else {
    console.log('❌ No valid session, redirecting to login');
    res.redirect('/login');
  }
}

// Middleware to check session expiry
function checkSessionExpiry(req, res, next) {
  if (req.session && req.session.loginTime) {
    const currentTime = Date.now();
    const sessionDuration = currentTime - req.session.loginTime;
    const twoHours = 2 * 60 * 60 * 1000;
    
    if (sessionDuration > twoHours) {
      console.log('⏰ Session expired for:', req.session.chatid);
      req.session.destroy();
      return res.redirect('/login');
    }
  }
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Login page - redirect if already logged in
app.get('/login', (req, res) => {
  if (req.session && req.session.chatid) {
    console.log('🔄 Already logged in, redirecting to home');
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Home page - requires authentication
app.get('/', requireAuth, checkSessionExpiry, (req, res) => {
  console.log('🏠 Serving home page to:', req.session.chatid);
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Login endpoint (returns JSON; client handles redirect)
app.post('/login', async (req, res) => {
  const { chatid } = req.body;

  console.log('📥 Login attempt for:', chatid);
  console.log('📥 Headers:', req.headers);

  if (!chatid) {
    return res.status(400).json({ error: 'Chat ID is required' });
  }

  try {
    const user = await licensesCol.findOne({ chat_id: parseInt(chatid) });

    if (user) {
      if (user.status === 'banned') {
        return res.status(403).json({ error: '🚫 You are banned from using this service.' });
      }

      req.session.chatid = chatid;
      req.session.status = user.status || 'active';
      req.session.credits = user.credits || 0;
      req.session.loginTime = Date.now();

      console.log(`✅ User logged in: ${chatid}`);

      // Save session before responding
      req.session.save((err) => {
        if (err) {
          console.error('❌ Session save error:', err);
          return res.status(500).json({ error: 'Login failed. Please try again.' });
        }

        console.log('💾 Session saved successfully for:', chatid);
        console.log('🍪 Session ID:', req.sessionID);
        console.log('🍪 Cookie settings:', sessionConfig.cookie);

        // DEBUG header so you can confirm server attempted to set cookie
        res.setHeader('X-Session-Set', '1');

        // Return JSON for AJAX/fetch clients (your client uses credentials: 'include')
        return res.json({
          success: true,
          status: user.status || 'active',
          credits: user.credits || 0,
          chatid: chatid
        });
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

// Logout endpoint
app.post('/logout', (req, res) => {
  const chatid = req.session?.chatid;
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    console.log(`✅ User logged out: ${chatid}`);
    res.json({ success: true });
  });
});

// Check session endpoint
app.get('/check-session', (req, res) => {
  console.log('🔍 Session check - ID:', req.sessionID);
  console.log('🔍 Session check - Chat ID:', req.session?.chatid);
  
  if (req.session && req.session.chatid) {
    const currentTime = Date.now();
    const sessionDuration = currentTime - req.session.loginTime;
    const twoHours = 2 * 60 * 60 * 1000;
    const remainingTime = twoHours - sessionDuration;
    
    if (remainingTime <= 0) {
      req.session.destroy();
      return res.json({ authenticated: false, expired: true });
    }
    
    res.json({ 
      authenticated: true,
      chatid: req.session.chatid,
      status: req.session.status,
      credits: req.session.credits,
      remainingTime: Math.floor(remainingTime / 1000)
    });
  } else {
    res.json({ authenticated: false });
  }
});

// IP check endpoint - requires authentication
app.post('/check-ip', requireAuth, checkSessionExpiry, async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ error: 'IP address is required' });
  }

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address format' });
  }

  try {
    console.log(`🔍 Checking IP: ${ip} for user: ${req.session.chatid}`);
    
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
  console.log(`🔐 Secure cookies: ${sessionConfig.cookie.secure}`);
  console.log(`🍪 SameSite: ${sessionConfig.cookie.sameSite}`);
  console.log(`🔒 Trust proxy: ${app.get('trust proxy')}`);
  console.log('='.repeat(60));
});