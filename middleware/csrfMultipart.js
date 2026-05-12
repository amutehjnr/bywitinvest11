'use strict';

/**
 * middleware/csrfMultipart.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * csurf (session mode, cookie:false) reads the CSRF token from req.body._csrf.
 * For multipart/form-data, express.urlencoded() never runs — only multer can
 * parse the body. The global csrfProtection in app.js is intentionally SKIPPED
 * for multipart routes (see MULTIPART_ROUTES in app.js).
 *
 * This middleware restores protection on those routes by:
 *   1. Running multer so req.body is populated.
 *   2. Copying req.body._csrf into req.headers['x-csrf-token'] — a header
 *      that csurf always checks regardless of content-type.
 *   3. Running the SAME shared csrfProtection instance from app.locals.
 *
 * USAGE — spread into route middleware array:
 *
 *   const { uploadThenCsrf } = require('../middleware/csrfMultipart');
 *
 *   router.post('/deposit', financialLimiter,
 *     ...uploadThenCsrf(upload.single('proof')),
 *     handleUploadError,
 *     validators,
 *     handler
 *   );
 */

const logger = require('../config/logger');

/**
 * @param {Function} multerMiddleware  e.g. upload.single('proof')
 * @returns {Function[]}  [multer, tokenInjector, csrfValidator]
 */
function uploadThenCsrf(multerMiddleware) {
  return [
    // Step 1: parse multipart body → populates req.body and req.files
    multerMiddleware,

    // Step 2: move _csrf from body into the header csurf always trusts
    function injectCsrfFromBody(req, res, next) {
      const token =
        (req.body && req.body._csrf) ||
        req.headers['x-csrf-token']  ||
        req.headers['csrf-token']    ||
        req.headers['x-xsrf-token'];

      if (token) {
        req.headers['x-csrf-token'] = token;
      }
      next();
    },

    // Step 3: validate using the SHARED instance stored on app.locals
    // (set in app.js as: app.locals.csrfProtection = csrfProtection)
    function runCsrf(req, res, next) {
      const csrfProtection = req.app.locals.csrfProtection;
      if (!csrfProtection) {
        logger.warn('csrfProtection not on app.locals — check app.js setup');
        return next();
      }
      csrfProtection(req, res, (err) => {
        if (err) return next(err);
        // Refresh csrfToken local so any re-render in this handler works
        try { res.locals.csrfToken = req.csrfToken(); } catch { res.locals.csrfToken = ''; }
        next();
      });
    },
  ];
}

module.exports = { uploadThenCsrf };