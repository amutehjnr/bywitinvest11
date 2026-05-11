const logger = require('../config/logger');

const ensureAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  req.flash('error', 'Please log in to access this page.');
  return res.redirect('/auth/login');
};

const ensureAdmin = (req, res, next) => {
  if (req.session && req.session.userId && req.session.userRole === 'admin') {
    return next();
  }
  logger.warn(`Unauthorised admin access attempt by userId=${req.session?.userId} IP=${req.ip}`);
  req.flash('error', 'Access denied.');
  return res.redirect('/dashboard');
};

const ensureGuest = (req, res, next) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  return next();
};

// Idempotent: global locals middleware in app.js sets csrfToken first.
// This is a safety net only — it won't overwrite an already-set value.
const attachCsrf = (req, res, next) => {
  if (!res.locals.csrfToken && req.csrfToken) {
    res.locals.csrfToken = req.csrfToken();
  }
  next();
};

module.exports = { ensureAuth, ensureAdmin, ensureGuest, attachCsrf };