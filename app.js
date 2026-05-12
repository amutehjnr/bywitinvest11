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

// ── Connect to MongoDB ────────────────────────────────────────────────────────
connectDB();

// ── View Engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Trust proxy ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Security Middleware ───────────────────────────────────────────────────────
securityMiddleware(app);

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression());

// ── HTTP Request Logging ──────────────────────────────────────────────────────
if (!isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health'
  }));
}

// ── Body Parsers ──────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(methodOverride('_method'));

// ── Static Files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,
  etag: true
}));

// ── Session secret ────────────────────────────────────────────────────────────
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim() ||
  (() => {
    logger.warn('SESSION_SECRET not set – using insecure default. Set it in .env!');
    return 'insecure_default_please_set_SESSION_SECRET_in_env_now';
  })();

// ── MongoStore ────────────────────────────────────────────────────────────────
const store = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  touchAfter: 24 * 3600,
  ttl: 7 * 24 * 60 * 60,
  autoRemove: 'native',
});

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
    secure: isProd,
    sameSite: 'lax'
  }
};

app.use(session(sessionConfig));

// ── Flash Messages ────────────────────────────────────────────────────────────
app.use(flash());

// ── CSRF Protection ───────────────────────────────────────────────────────────
// Create ONE shared instance that is exported for use in routes too.
// Using cookie:false means tokens are stored in the session.
//
// CRITICAL: multipart/form-data requests (file uploads) cannot have their
// body parsed by express.urlencoded — only multer can parse them. That means
// req.body._csrf is undefined when global csurf runs, causing a mismatch.
//
// Solution: skip global csurf for known multipart routes, and enforce it
// per-route AFTER multer has parsed the body (see middleware/csrfMultipart.js).
//
// The set of multipart POST routes:
const MULTIPART_ROUTES = new Set([
  '/dashboard/deposit',
  '/admin/settings',
  '/admin/blog',
  '/admin/team',
  '/admin/testimonials',
]);

const csrfProtection = csrf({ cookie: false });

// Export the shared instance so route files can reuse it (not create new ones)
app.locals.csrfProtection = csrfProtection;

app.use((req, res, next) => {
  // Skip global CSRF for multipart upload routes — they enforce it themselves
  // after multer parses the body (via csrfMultipart middleware).
  if (req.method === 'POST' && MULTIPART_ROUTES.has(req.path)) {
    return next();
  }
  return csrfProtection(req, res, next);
});

// ── Global Locals ─────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.session   = req.session || {};
  res.locals.messages  = {
    success: req.flash('success'),
    error:   req.flash('error')
  };
  // csrfToken() is only available after csrfProtection has run.
  // For the multipart routes that skipped global csurf above, this will
  // be set by the per-route csrfProtection (via attachCsrf / res.locals
  // assignment inside the route) — so we guard with a try/catch.
  try {
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  } catch {
    res.locals.csrfToken = '';
  }
  try {
    res.locals.siteInfo = (await SiteInfo.findOne().lean()) || {};
  } catch {
    res.locals.siteInfo = {};
  }
  next();
});

app.use(attachCsrf); // idempotent safety-net

// ── CSRF error handler ────────────────────────────────────────────────────────
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

// ── General rate limiter ──────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (res.headersSent) return;
  logger.warn(`404: ${req.method} ${req.originalUrl} IP=${req.ip}`);
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) {
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

// ── Process-level guards ──────────────────────────────────────────────────────
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

// ── Start Server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`🚀 LucrativeETF running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;