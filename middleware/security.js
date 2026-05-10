const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

/**
 * Apply all security-related middleware in one place.
 * Call securityMiddleware(app) from app.js before routes.
 */
const securityMiddleware = (app) => {
  // ── Helmet (HTTP security headers) ──────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // needed for inline scripts in EJS
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com'
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://cdnjs.cloudflare.com',
            'https://fonts.googleapis.com'
          ],
          fontSrc: [
            "'self'",
            'https://fonts.gstatic.com',
            'https://cdnjs.cloudflare.com'
          ],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false, // CDN assets
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    })
  );

  // ── NoSQL Injection sanitisation ─────────────────────────────────────────────
  app.use(mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      const logger = require('../config/logger');
      logger.warn(`NoSQL injection attempt sanitised: key=${key} IP=${req.ip}`);
    }
  }));

  // ── HTTP Parameter Pollution ──────────────────────────────────────────────────
  app.use(hpp());

  // ── Disable x-powered-by (already done by helmet but explicit) ───────────────
  app.disable('x-powered-by');
};

module.exports = { securityMiddleware };
