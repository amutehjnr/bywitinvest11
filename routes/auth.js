const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { ensureGuest } = require('../middleware/auth');
const { authLimiter } = require('../config/rateLimit');
const { sendMail } = require('../config/mailer');
const logger = require('../config/logger');

// ── Validation rules ──────────────────────────────────────────────────────────
const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

const registerRules = [
  body('username').trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username: 3-30 chars, letters/numbers/underscore only'),
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email'),
  body('firstName').trim().notEmpty().isLength({ max: 50 }).withMessage('First name required'),
  body('lastName').trim().notEmpty().isLength({ max: 50 }).withMessage('Last name required'),
  body('country').trim().isLength({ max: 60 }).optional({ checkFalsy: true }),
  body('phone').trim().isLength({ max: 20 }).optional({ checkFalsy: true }),
  body('password').isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be ≥8 chars with upper, lower and number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  })
];

// ── GET /auth/login ───────────────────────────────────────────────────────────
router.get('/login', ensureGuest, (req, res) => {
  res.render('auth/login', { title: 'Login', errors: [], old: {} });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', authLimiter, ensureGuest, loginRules, async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.render('auth/login', { title: 'Login', errors: errs.array(), old: req.body });
  }
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

    if (!user) {
      // Constant-time response to prevent user enumeration
      await new Promise(r => setTimeout(r, 300));
      return res.render('auth/login', {
        title: 'Login',
        errors: [{ msg: 'Invalid email or password' }],
        old: { email: req.body.email }
      });
    }

    // Check account lock
    if (user.isLocked) {
      logger.warn(`Locked account login attempt: ${email} IP=${req.ip}`);
      return res.render('auth/login', {
        title: 'Login',
        errors: [{ msg: 'Account temporarily locked due to multiple failed attempts. Try again in 2 hours.' }],
        old: { email: req.body.email }
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incLoginAttempts();
      logger.warn(`Failed login for ${email} IP=${req.ip}`);
      return res.render('auth/login', {
        title: 'Login',
        errors: [{ msg: 'Invalid email or password' }],
        old: { email: req.body.email }
      });
    }

    if (!user.isActive) {
      return res.render('auth/login', {
        title: 'Login',
        errors: [{ msg: 'Your account has been deactivated. Contact support.' }],
        old: {}
      });
    }

    // Successful login
    await user.resetLoginAttempts();
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date(), lastLoginIp: req.ip });

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        logger.error(`Session regeneration error: ${err.message}`);
        return res.render('auth/login', {
          title: 'Login',
          errors: [{ msg: 'Server error. Please try again.' }],
          old: {}
        });
      }
      req.session.userId   = user._id.toString();
      req.session.userRole = user.role;
      req.session.userName = user.username;
      req.flash('success', `Welcome back, ${user.firstName || user.username}!`);
      logger.info(`User logged in: ${user.email} IP=${req.ip}`);
      if (user.role === 'admin') return res.redirect('/admin');
      return res.redirect('/dashboard');
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.render('auth/login', { title: 'Login', errors: [{ msg: 'Server error. Try again.' }], old: {} });
  }
});

// ── GET /auth/register ────────────────────────────────────────────────────────
router.get('/register', ensureGuest, (req, res) => {
  res.render('auth/register', { title: 'Register', errors: [], old: {} });
});

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', authLimiter, ensureGuest, registerRules, async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.render('auth/register', { title: 'Register', errors: errs.array(), old: req.body });
  }
  try {
    const { username, email, password, firstName, lastName, country, phone, ref } = req.body;

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const msg = existing.email === email ? 'Email already registered.' : 'Username already taken.';
      return res.render('auth/register', { title: 'Register', errors: [{ msg }], old: req.body });
    }

    const newUser = new User({ username, email, password, firstName, lastName, country, phone });

    if (ref) {
      try {
        const referrer = await User.findById(ref).select('_id');
        if (referrer) newUser.referredBy = referrer._id;
      } catch { /* invalid ObjectId – ignore */ }
    }

    await newUser.save();

    req.session.regenerate((err) => {
      if (err) {
        logger.error(`Session regen on register: ${err.message}`);
        req.flash('error', 'Account created but could not log you in. Please log in manually.');
        return res.redirect('/auth/login');
      }
      req.session.userId   = newUser._id.toString();
      req.session.userRole = newUser.role;
      req.session.userName = newUser.username;
      logger.info(`New user registered: ${newUser.email} IP=${req.ip}`);
      req.flash('success', 'Account created! Welcome to LucrativeETF.');
      return res.redirect('/dashboard');
    });
  } catch (err) {
    logger.error(`Register error: ${err.message}`);
    res.render('auth/register', {
      title: 'Register',
      errors: [{ msg: 'Registration failed. Please try again.' }],
      old: req.body
    });
  }
});

// ── GET /auth/logout ──────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy((err) => {
    if (err) logger.error(`Session destroy error: ${err.message}`);
    res.clearCookie('sid');
    logger.info(`User logged out: ${userId} IP=${req.ip}`);
    res.redirect('/');
  });
});

// ── GET /auth/forgot-password ─────────────────────────────────────────────────
router.get('/forgot-password', ensureGuest, (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password', sent: false, errors: [] });
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
router.post('/forgot-password', authLimiter, ensureGuest,
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email }).select('+verifyToken +verifyTokenExpiry');

      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        user.verifyToken = token;
        user.verifyTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save({ validateBeforeSave: false });

        const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;

        await sendMail({
          to: user.email,
          subject: 'LucrativeETF – Password Reset Request',
          html: `
            <h2>Password Reset</h2>
            <p>You requested a password reset. Click the link below (valid for 1 hour):</p>
            <a href="${resetUrl}" style="background:#1a9e5f;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">
              Reset Password
            </a>
            <p>If you did not request this, please ignore this email.</p>
          `,
          text: `Reset your password: ${resetUrl}`
        });
        logger.info(`Password reset token sent to ${email}`);
      }
      // Always show "sent" to prevent email enumeration
      res.render('auth/forgot-password', { title: 'Forgot Password', sent: true, errors: [] });
    } catch (err) {
      logger.error(`Forgot-password error: ${err.message}`);
      res.render('auth/forgot-password', { title: 'Forgot Password', sent: false, errors: [{ msg: 'Server error.' }] });
    }
  }
);

// ── GET /auth/reset-password ──────────────────────────────────────────────────
router.get('/reset-password', ensureGuest, async (req, res) => {
  const { token } = req.query;
  let valid = false;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const user = await User.findOne({
      verifyToken: token,
      verifyTokenExpiry: { $gt: new Date() }
    }).select('+verifyToken +verifyTokenExpiry');
    valid = !!user;
  }
  res.render('auth/reset-password', { title: 'Reset Password', token: token || '', valid, errors: [], success: false });
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
router.post('/reset-password', authLimiter, ensureGuest,
  [
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must be ≥8 chars with upper, lower and number'),
    body('confirmPassword').custom((v, { req }) => {
      if (v !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    })
  ],
  async (req, res) => {
    const { token, password, confirmPassword } = req.body;
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.render('auth/reset-password', {
        title: 'Reset Password', token, valid: true, errors: errs.array(), success: false
      });
    }
    if (password !== confirmPassword) {
      return res.render('auth/reset-password', {
        title: 'Reset Password', token, valid: true,
        errors: [{ msg: 'Passwords do not match.' }], success: false
      });
    }
    try {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        return res.render('auth/reset-password', {
          title: 'Reset Password', token: '', valid: false, errors: [], success: false
        });
      }
      const user = await User.findOne({
        verifyToken: token,
        verifyTokenExpiry: { $gt: new Date() }
      }).select('+verifyToken +verifyTokenExpiry');

      if (!user) {
        return res.render('auth/reset-password', {
          title: 'Reset Password', token, valid: false, errors: [{ msg: 'Invalid or expired link.' }], success: false
        });
      }
      user.password = password;
      user.verifyToken = '';
      user.verifyTokenExpiry = null;
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();
      logger.info(`Password reset successfully for userId=${user._id}`);
      res.render('auth/reset-password', { title: 'Reset Password', token, valid: true, errors: [], success: true });
    } catch (err) {
      logger.error(`Reset-password error: ${err.message}`);
      res.render('auth/reset-password', {
        title: 'Reset Password', token, valid: true, errors: [{ msg: 'Server error.' }], success: false
      });
    }
  }
);

module.exports = router;
