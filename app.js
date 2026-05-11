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

connectDB();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

securityMiddleware(app);
app.use(compression());

if (!isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health'
  }));
}

app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(methodOverride('_method'));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,
  etag: true
}));

// ─────────────────────────────────────────────────────────────────────────────
// SESSION
// Guarantee SESSION_SECRET is never null — connect-mongo's kruptein lib
// crashes with "Cannot read properties of null (reading 'length')" otherwise.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  logger.warn('SESSION_SECRET not set – using insecure default. Set it in .env!');
  return 'change_me_NOW_not_for_production_use_only_32chars_min';
})();

app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600,
    ttl: 7 * 24 * 60 * 60,
    // Only pass crypto when a REAL secret exists in env.
    // The fallback string must NOT go here — kruptein crashes on it.
    ...(process.env.SESSION_SECRET
      ? { crypto: { secret: process.env.SESSION_SECRET } }
      : {}
    )
  }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,   // was hardcoded true — breaks non-HTTPS environments
    sameSite: 'lax'
  }
}));

app.use(flash());

// ─────────────────────────────────────────────────────────────────────────────
// CSRF — THE ROOT CAUSE OF "Form expired or invalid" ON SETTINGS/UPLOAD PAGES
//
// Problem:
//   csurf({ cookie: false }) reads req.body._csrf to validate the token.
//   For multipart/form-data requests (file uploads), multer parses the body
//   INSIDE the route handler — which runs AFTER this global middleware.
//   So when csurf executes here, req.body is still {} → token not found →
//   EBADCSRFTOKEN → "Form expired or invalid."
//
// Fix:
//   1. Skip global csurf for multipart POSTs.
//   2. Create a second csrf instance (csrfAfterMultipart) that route handlers
//      apply AFTER multer, when req.body is already populated.
//   3. Store csrfAfterMultipart on the app so route files can retrieve it.
// ─────────────────────────────────────────────────────────────────────────────
const csrfValueFn = (req) =>
  (req.body && req.body._csrf) ||
  req.headers['x-csrf-token'] ||
  req.headers['x-xsrf-token'] ||
  req.headers['csrf-token'] ||
  (req.query && req.query._csrf);

const csrfProtection       = csrf({ cookie: false, value: csrfValueFn });
const csrfAfterMultipart   = csrf({ cookie: false, value: csrfValueFn });

// Make available to route files via app.get('csrfAfterMultipart')
app.set('csrfAfterMultipart', csrfAfterMultipart);

app.use((req, res, next) => {
  // Multipart POSTs skip global csurf; they run csrfAfterMultipart locally
  if (req.method === 'POST' && (req.headers['content-type'] || '').includes('multipart/form-data')) {
    return next();
  }
  return csrfProtection(req, res, next);
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL LOCALS — must be AFTER session+csrf, BEFORE error handlers
// ─────────────────────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.session   = req.session || {};
  res.locals.messages  = {
    success: req.flash('success'),
    error:   req.flash('error')
  };
  // csrfToken may be absent on multipart routes (token generated locally)
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  try {
    res.locals.siteInfo = (await SiteInfo.findOne().lean()) || {};
  } catch {
    res.locals.siteInfo = {};
  }
  next();
});

app.use(attachCsrf); // idempotent safety net

// ─────────────────────────────────────────────────────────────────────────────
// CSRF ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  logger.warn(`CSRF token mismatch: IP=${req.ip} URL=${req.originalUrl}`);
  if (res.headersSent) return;
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  req.flash('error', 'Form expired or invalid. Please try again.');
  const ref = req.get('Referrer') || '/';
  return res.redirect(ref === req.originalUrl ? '/' : ref);
});

app.use(generalLimiter);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));

app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));

// ─────────────────────────────────────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (res.headersSent) return;
  logger.warn(`404: ${req.method} ${req.originalUrl} IP=${req.ip}`);
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// Always check headersSent first — failing to do so causes the secondary
// "Cannot set headers after they are sent" error.
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) {
    logger.error(`Error after headers sent: ${err.message}`);
    return next(err);
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

const server = app.listen(PORT, () => {
  logger.info(`🚀 LucrativeETF running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;