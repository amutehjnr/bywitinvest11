require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const compression = require('compression');
const morgan = require('morgan');
const csrf = require('csurf');
const path = require('path');
const fs = require('fs');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const { generalLimiter } = require('./config/rateLimit');
const { securityMiddleware } = require('./middleware/security');
const { attachCsrf } = require('./middleware/auth');
const { SiteInfo } = require('./models/index');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Connect to MongoDB ────────────────────────────────
connectDB();

// ── View Engine ───────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Trust proxy (for correct IP behind Nginx/Cloudflare) ──
if (isProd) app.set('trust proxy', 1);

// ── Security Middleware ───────────────────────────────
securityMiddleware(app);

// ── Compression ───────────────────────────────────────
app.use(compression());

// ── HTTP Request Logging ──────────────────────────────
if (!isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health'
  }));
}

// ── Body Parsers ──────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(methodOverride('_method'));

// ── Static Files ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,
  etag: true
}));

// ── Session ───────────────────────────────────────────
const sessionConfig = {
  name: '__Host-sid', // Prevents session fixation; __Host- prefix enforces Secure+path=/
  secret: process.env.SESSION_SECRET || (() => {
    logger.warn('SESSION_SECRET not set – using insecure default. Set it in .env!');
    return 'change_me_NOW_not_for_production_use_only';
  })(),
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600, // lazy session update
    ttl: 7 * 24 * 60 * 60, // 7 days
    crypto: { secret: process.env.SESSION_SECRET || 'change_me' }
  }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,      // HTTPS only in prod
    sameSite: 'lax'
  }
};

// In production with __Host- prefix the cookie name requires secure=true
if (isProd) sessionConfig.cookie.secure = true;

app.use(session(sessionConfig));

// ── Flash Messages ────────────────────────────────────
app.use(flash());

// ── CSRF Protection ───────────────────────────────────
const csrfProtection = csrf({ cookie: false }); // store token in session
app.use(csrfProtection);
app.use(attachCsrf);

// ── CSRF error handler ────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    logger.warn(`CSRF token mismatch: IP=${req.ip} URL=${req.originalUrl}`);
    if (req.xhr) return res.status(403).json({ error: 'Invalid CSRF token.' });
    req.flash('error', 'Form expired or invalid. Please try again.');
    return res.redirect('back');
  }
  next(err);
});

// ── Global Locals ─────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.session = req.session;
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error')
  };
  // Cache siteInfo so partials always have it
  try {
    if (!res.locals.siteInfo) {
      res.locals.siteInfo = (await SiteInfo.findOne().lean()) || {};
    }
  } catch { res.locals.siteInfo = {}; }
  next();
});

// ── General rate limiter ──────────────────────────────
app.use(generalLimiter);

// ── Health check (for uptime monitors, no rate limit) ─
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));

// ── Routes ────────────────────────────────────────────
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));

// ── 404 Handler ───────────────────────────────────────
app.use((req, res) => {
  logger.warn(`404: ${req.method} ${req.originalUrl} IP=${req.ip}`);
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ── Global Error Handler ──────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`500: ${err.message}`, { stack: err.stack, url: req.originalUrl, ip: req.ip });
  const status = err.status || 500;
  if (req.xhr) return res.status(status).json({ error: isProd ? 'Internal server error.' : err.message });
  res.status(status).render('500', { title: 'Server Error' });
});

// ── Graceful shutdown ─────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received – shutting down gracefully.');
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Promise Rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

// ── Start Server ──────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`🚀 LucrativeETF running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
