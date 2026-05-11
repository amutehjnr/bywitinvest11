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

// ── Session ───────────────────────────────────────────
// FIX 1: Guarantee SESSION_SECRET is never null/undefined before passing
// to MongoStore's crypto option — connect-mongo v5 crashes with
// "Cannot read properties of null (reading 'length')" when it is.
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  logger.warn('SESSION_SECRET not set – using insecure default. Set it in .env!');
  return 'change_me_NOW_not_for_production_use_only_32chars_min';
})();

const sessionConfig = {
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600,
    ttl: 7 * 24 * 60 * 60,
    // FIX 2: Only enable crypto when we have a real secret; a weak/default
    // secret passed to kruptein (MongoStore's crypto lib) causes the
    // null-length crash seen in the logs.
    ...(process.env.SESSION_SECRET
      ? { crypto: { secret: process.env.SESSION_SECRET } }
      : {}
    )
  }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,   // FIX 3: was hardcoded `true`; breaks HTTP in dev/staging
    sameSite: 'lax'
  }
};

app.use(session(sessionConfig));

// ── Flash Messages ────────────────────────────────────
app.use(flash());

// ── CSRF Protection ───────────────────────────────────
const csrfProtection = csrf({ cookie: false }); // store token in session
app.use(csrfProtection);

// ── Global Locals ─────────────────────────────────────
// FIX 4: Move global locals BEFORE attachCsrf and BEFORE the CSRF error
// handler so res.locals.csrfToken / siteInfo / messages are ALWAYS set
// before any error handler tries to render a view.
app.use(async (req, res, next) => {
  res.locals.session  = req.session || {};
  res.locals.messages = {
    success: req.flash('success'),
    error:   req.flash('error')
  };
  // Attach CSRF token early so error pages can use it
  res.locals.csrfToken = (req.csrfToken ? req.csrfToken() : '');
  try {
    res.locals.siteInfo = (await SiteInfo.findOne().lean()) || {};
  } catch {
    res.locals.siteInfo = {};
  }
  next();
});

// attachCsrf is now a no-op safety net (csrfToken already set above)
app.use(attachCsrf);

// ── CSRF error handler ────────────────────────────────
// FIX 5: Guard res.headersSent before attempting redirect/response.
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);

  logger.warn(`CSRF token mismatch: IP=${req.ip} URL=${req.originalUrl}`);

  if (res.headersSent) return; // safety guard

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  req.flash('error', 'Form expired or invalid. Please try again.');
  // Avoid redirect loops — fall back to '/' if no valid referrer
  const fallback = '/';
  const ref = req.get('Referrer') || fallback;
  return res.redirect(ref === req.originalUrl ? fallback : ref);
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
// FIX 6: ALWAYS check res.headersSent first — the root cause of the
// "Cannot set headers after they are sent" secondary error.
app.use((err, req, res, next) => {
  // If response already started (e.g. streaming), delegate to Express default
  if (res.headersSent) {
    logger.error(`Error after headers sent: ${err.message}`);
    return next(err);
  }

  logger.error(`500: ${err.message}`, { stack: err.stack, url: req.originalUrl, ip: req.ip });
  const status = err.status || 500;

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({ error: isProd ? 'Internal server error.' : err.message });
  }

  // Ensure locals are always defined for error pages
  // (they should already be set by the global locals middleware above,
  //  but be defensive in case that middleware itself threw)
  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.siteInfo  = res.locals.siteInfo  || {};
  res.locals.messages  = res.locals.messages  || { success: [], error: [] };
  res.locals.session   = res.locals.session   || {};

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