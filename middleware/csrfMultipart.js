/**
 * csrfMultipart.js
 *
 * ROOT CAUSE OF THE CSRF MISMATCH ON FILE-UPLOAD ROUTES:
 * -------------------------------------------------------
 * csurf (cookie:false / session mode) reads the CSRF token from:
 *   1. req.body._csrf          — only available AFTER a body-parser runs
 *   2. req.query._csrf
 *   3. req.headers['csrf-token'] / x-csrf-token / x-xsrf-token
 *
 * For multipart/form-data requests, express.urlencoded() does NOT parse
 * the body — only multer does. But multer is mounted PER-ROUTE, *after*
 * the global csrfProtection middleware has already tried (and failed) to
 * read req.body._csrf (which is still undefined at that point).
 *
 * SOLUTION:
 * ---------
 * 1. Mount multer BEFORE csurf on every multipart route.
 * 2. After multer populates req.body, manually inject the token into the
 *    header that csurf always checks (x-csrf-token), so that when csurf
 *    runs immediately after it finds the token.
 *
 * Usage (replace existing route middleware order):
 *
 *   const { uploadThenCsrf } = require('../middleware/csrfMultipart');
 *
 *   // Single file
 *   router.post('/deposit', financialLimiter,
 *     uploadThenCsrf(upload.single('proof'), csrfProtection),
 *     handleUploadError,
 *     [...validators],
 *     handler
 *   );
 *
 *   // Multiple fields
 *   router.post('/settings',
 *     uploadThenCsrf(upload.fields([...]), csrfProtection),
 *     handleUploadError,
 *     handler
 *   );
 */

'use strict';

/**
 * Returns an array of middleware:
 *   [ multerMiddleware, csrfTokenInjector, csrfProtection ]
 *
 * The injector reads _csrf from the now-populated req.body and writes it
 * into req.headers['x-csrf-token'] so csurf finds it without any patches.
 *
 * @param {Function} multerMiddleware  - e.g. upload.single('proof')
 * @param {Function} csrfProtection    - the csurf() instance from app.js
 * @returns {Function[]}
 */
function uploadThenCsrf(multerMiddleware, csrfProtection) {
  return [
    // Step 1: parse the multipart body so req.body._csrf is populated
    multerMiddleware,

    // Step 2: bridge the token into a header csurf always checks
    function injectCsrfFromBody(req, res, next) {
      const token =
        (req.body && req.body._csrf) ||
        req.headers['x-csrf-token'] ||
        req.headers['csrf-token'] ||
        req.headers['x-xsrf-token'];

      if (token) {
        // csurf checks this header regardless of content-type
        req.headers['x-csrf-token'] = token;
      }
      next();
    },

    // Step 3: now csurf can validate normally
    csrfProtection,
  ];
}

module.exports = { uploadThenCsrf };