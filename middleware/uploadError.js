const multer = require('multer');
const logger = require('../config/logger');

/**
 * Wraps a multer middleware, catches MulterError and bad file-type errors,
 * and converts them into flash messages + redirects (or JSON for XHR).
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.warn(`Multer error: ${err.message} | IP=${req.ip}`);
    if (req.xhr) return res.status(400).json({ error: err.message });
    req.flash('error', err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum size is 5MB.'
      : `Upload error: ${err.message}`
    );
    return res.redirect('back');
  }
  if (err && err.message && err.message.includes('Only image')) {
    if (req.xhr) return res.status(400).json({ error: err.message });
    req.flash('error', err.message);
    return res.redirect('back');
  }
  next(err);
};

module.exports = { handleUploadError };
