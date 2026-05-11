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

// ── Trust proxy ───────────────────────────────────────
app.set('trust proxy', 1);

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

// ── Session secret ────────────────────────────────────
// Must be a non-empty string. Never pass undefined/null to MongoStore.
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim() ||
  (() => {
    logger.warn('SESSION_SECRET not set – using insecure default. Set it in .env!');
    return 'insecure_default_please_set_SESSION_SECRET_in_env_now';
  })();

// ── MongoStore ────────────────────────────────────────
// ROOT CAUSE OF THE BUG:
// The original code passed `crypto: { secret: process.env.SESSION_SECRET }`
// to MongoStore. When SESSION_SECRET was undefined (not set on Render),
// kruptein (the crypto lib inside connect-mongo v5) received null as its
// key and crashed: "Cannot read properties of null (reading 'length')".
//
// Even after fixing the env var, OLD session documents in MongoDB were
// written when the secret was null — connect-mongo tries to DECRYPT those
// on every single request and crashes again on each one.
//
// SOLUTION:
//   1. Remove the crypto option entirely. Session IDs are already
//      protected by the signed cookie (SESSION_SECRET + httpOnly + secure).
//      Server-side encryption of the session store is optional hardening,
//      not a security requirement.
//   2. Run clear-sessions.js ONCE after deploying to drop all corrupted
//      session documents from MongoDB.
const store = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  touchAfter: 24 * 3600,
  ttl: 7 * 24 * 60 * 60,
  autoRemove: 'native',
  // ← NO crypto option
});

// Catch any async store errors so they never become uncaught exceptions
store.on('error', (err) => {
  logger.error(`MongoStore error (non-fatal): ${err.message}`);
});

const sessionConfig = {
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,   // was hardcoded true — broke HTTP in dev/staging
    sameSite: 'lax'
  }
};

app.use(session(sessionConfig));

// ── Flash Messages ────────────────────────────────────
app.use(flash());

// ── CSRF Protection ───────────────────────────────────
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// ── Global Locals ─────────────────────────────────────
// MUST come before all error handlers so that csrfToken / siteInfo /
// messages are always available when any EJS view is rendered.
app.use(async (req, res, next) => {
  res.locals.session   = req.session || {};
  res.locals.messages  = {
    success: req.flash('success'),
    error:   req.flash('error')
  };
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  try {
    res.locals.siteInfo = (await SiteInfo.findOne().lean()) || {};
  } catch {
    res.locals.siteInfo = {};
  }
  next();
});

app.use(attachCsrf); // idempotent safety-net (no-op when already set above)

// ── CSRF error handler ────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  if (res.headersSent) return;
  logger.warn(`CSRF token mismatch: IP=${req.ip} URL=${req.originalUrl}`);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  req.flash('error', 'Form expired or invalid. Please try again.');
  const ref = req.get('Referrer') || '/';
  return res.redirect(ref === req.originalUrl ? '/' : ref);
});

// ── General rate limiter ──────────────────────────────
app.use(generalLimiter);

// ── Health check ──────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));

// ── Routes ────────────────────────────────────────────
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));

// ── 404 Handler ───────────────────────────────────────
app.use((req, res) => {
  if (res.headersSent) return;
  logger.warn(`404: ${req.method} ${req.originalUrl} IP=${req.ip}`);
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ── Global Error Handler ──────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) {
    // Response already committed — cannot write headers or body.
    // Just log and bail; do NOT call next(err) again (infinite loop risk).
    logger.error(`Error after headers sent: ${err.message}`);
    return;
  }
  logger.error(`500: ${err.message}`, { stack: err.stack, url: req.originalUrl, ip: req.ip });
  const status = err.status || 500;
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({ error: isProd ? 'Internal server error.' : err.message });
  }
  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.siteInfo  = res.locals.siteInfo  || {};
  res.locals.messages  = res.locals.messages  || { success: [], error: [] };
  res.locals.session   = res.locals.session   || {};
  res.status(status).render('500', { title: 'Server Error' });
});

// ── Process-level guards ──────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received – shutting down gracefully.');
  server.close(() => { logger.info('HTTP server closed.'); process.exit(0); });
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