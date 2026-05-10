const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { Plan, Investment, Deposit, Withdrawal, SiteInfo, Wallet } = require('../models/index');
const { ensureAuth } = require('../middleware/auth');
const { financialLimiter } = require('../config/rateLimit');
const upload = require('../config/upload');
const { handleUploadError } = require('../middleware/uploadError');
const logger = require('../config/logger');

router.use(ensureAuth);

// ── Helper: load current user (lean for reads, full for writes) ───────────────
const getUser    = (id) => User.findById(id);
const getUserLean = (id) => User.findById(id).lean();

// ── GET /dashboard ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [user, investments, deposits, withdrawals] = await Promise.all([
      getUserLean(req.session.userId),
      Investment.find({ user: req.session.userId }).sort({ createdAt: -1 }).limit(5).populate('plan').lean(),
      Deposit.find({ user: req.session.userId }).sort({ createdAt: -1 }).limit(5).lean(),
      Withdrawal.find({ user: req.session.userId }).sort({ createdAt: -1 }).limit(5).lean()
    ]);
    const totalDeposited = deposits.filter(d => d.status === 'approved').reduce((s, d) => s + d.amount, 0);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0);
    res.render('dashboard/index', {
      title: 'Dashboard', user, investments, deposits, withdrawals,
      totalDeposited, totalWithdrawn
    });
  } catch (err) {
    logger.error(`Dashboard error: ${err.message}`);
    res.redirect('/');
  }
});

// ── GET /dashboard/invest ─────────────────────────────────────────────────────
router.get('/invest', async (req, res) => {
  try {
    const [plans, user] = await Promise.all([
      Plan.find({ isActive: true }).lean(),
      getUserLean(req.session.userId)
    ]);
    res.render('dashboard/invest', { title: 'Invest Now', plans, user });
  } catch (err) {
    logger.error(`Invest GET error: ${err.message}`);
    req.flash('error', 'Failed to load plans.');
    res.redirect('/dashboard');
  }
});

// ── POST /dashboard/invest ────────────────────────────────────────────────────
router.post('/invest', financialLimiter,
  [
    body('planId').isMongoId().withMessage('Invalid plan'),
    body('amount').isFloat({ min: 1 }).withMessage('Invalid amount')
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/dashboard/invest');
    }
    try {
      const { planId, amount } = req.body;
      const amt = parseFloat(parseFloat(amount).toFixed(2));

      const [plan, user] = await Promise.all([
        Plan.findById(planId),
        getUser(req.session.userId)
      ]);

      if (!plan || !plan.isActive) {
        req.flash('error', 'Invalid or inactive plan.');
        return res.redirect('/dashboard/invest');
      }
      if (amt < plan.minAmount || amt > plan.maxAmount) {
        req.flash('error', `Amount must be between $${plan.minAmount.toLocaleString()} and $${plan.maxAmount.toLocaleString()}.`);
        return res.redirect('/dashboard/invest');
      }
      if (user.balance < amt) {
        req.flash('error', 'Insufficient balance. Please make a deposit first.');
        return res.redirect('/dashboard/deposit');
      }

      // Atomic balance deduction
      const updated = await User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: amt } },
        { $inc: { balance: -amt, totalInvested: amt } },
        { new: true }
      );
      if (!updated) {
        req.flash('error', 'Insufficient balance.');
        return res.redirect('/dashboard/invest');
      }

      await Investment.create({
        user: user._id,
        plan: plan._id,
        planName: plan.name,
        amount: amt,
        rate: plan.rate
      });

      logger.info(`Investment: userId=${user._id} plan=${plan.name} amount=${amt}`);
      req.flash('success', `Successfully invested $${amt.toFixed(2)} in the ${plan.name} plan!`);
      res.redirect('/dashboard');
    } catch (err) {
      logger.error(`Invest POST error: ${err.message}`);
      req.flash('error', 'Investment failed. Please try again.');
      res.redirect('/dashboard/invest');
    }
  }
);

// ── GET /dashboard/deposit ────────────────────────────────────────────────────
router.get('/deposit', async (req, res) => {
  try {
    const [deposits, user] = await Promise.all([
      Deposit.find({ user: req.session.userId }).sort({ createdAt: -1 }).lean(),
      getUserLean(req.session.userId)
    ]);
    res.render('dashboard/deposit', { title: 'Deposit Funds', deposits, user });
  } catch (err) {
    logger.error(`Deposit GET error: ${err.message}`);
    req.flash('error', 'Failed to load deposit page.');
    res.redirect('/dashboard');
  }
});

// ── POST /dashboard/deposit ───────────────────────────────────────────────────
router.post('/deposit', financialLimiter,
  upload.single('proof'),
  handleUploadError,
  [
    body('channel').isIn(['BTC', 'ETH', 'USDT', 'Bank']).withMessage('Invalid channel'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least $1'),
    body('walletSentTo').trim().isLength({ max: 200 }).optional({ checkFalsy: true })
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      if (req.file) {
        const fs = require('fs');
        fs.unlink(req.file.path, () => {});
      }
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/dashboard/deposit');
    }
    try {
      const { channel, amount, walletSentTo } = req.body;
      const proofImage = req.file ? '/uploads/' + req.file.filename : '';

      await Deposit.create({
        user: req.session.userId,
        channel,
        amount: parseFloat(parseFloat(amount).toFixed(2)),
        walletAddress: walletSentTo || '',
        proofImage
      });

      logger.info(`Deposit submitted: userId=${req.session.userId} channel=${channel} amount=${amount}`);
      req.flash('success', 'Deposit submitted! It will be approved within 24 hours.');
      res.redirect('/dashboard/deposit');
    } catch (err) {
      logger.error(`Deposit POST error: ${err.message}`);
      req.flash('error', 'Deposit submission failed.');
      res.redirect('/dashboard/deposit');
    }
  }
);

// ── GET /dashboard/withdraw ───────────────────────────────────────────────────
router.get('/withdraw', async (req, res) => {
  try {
    const [withdrawals, wallets, user] = await Promise.all([
      Withdrawal.find({ user: req.session.userId }).sort({ createdAt: -1 }).lean(),
      Wallet.find({ user: req.session.userId }).lean(),
      getUserLean(req.session.userId)
    ]);
    res.render('dashboard/withdraw', { title: 'Withdraw Funds', withdrawals, wallets, user });
  } catch (err) {
    logger.error(`Withdraw GET error: ${err.message}`);
    req.flash('error', 'Failed to load withdrawal page.');
    res.redirect('/dashboard');
  }
});

// ── POST /dashboard/withdraw ──────────────────────────────────────────────────
router.post('/withdraw', financialLimiter,
  [
    body('walletAddress').trim().notEmpty().isLength({ max: 200 }).withMessage('Wallet address required'),
    body('channel').isIn(['BTC', 'ETH', 'USDT']).withMessage('Invalid channel'),
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least $1')
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/dashboard/withdraw');
    }
    try {
      const { walletAddress, channel, amount } = req.body;
      const amt = parseFloat(parseFloat(amount).toFixed(2));

      const updated = await User.findOneAndUpdate(
        { _id: req.session.userId, balance: { $gte: amt } },
        { $inc: { balance: -amt } },
        { new: true }
      );
      if (!updated) {
        req.flash('error', 'Insufficient balance.');
        return res.redirect('/dashboard/withdraw');
      }

      await Withdrawal.create({
        user: req.session.userId,
        walletAddress,
        channel,
        amount: amt
      });

      logger.info(`Withdrawal request: userId=${req.session.userId} channel=${channel} amount=${amt}`);
      req.flash('success', 'Withdrawal request submitted! Processing within 24-48 hours.');
      res.redirect('/dashboard/withdraw');
    } catch (err) {
      logger.error(`Withdraw POST error: ${err.message}`);
      req.flash('error', 'Withdrawal failed. Please try again.');
      res.redirect('/dashboard/withdraw');
    }
  }
);

// ── GET /dashboard/transactions ───────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const [deposits, withdrawals, investments, user] = await Promise.all([
      Deposit.find({ user: req.session.userId }).sort({ createdAt: -1 }).lean(),
      Withdrawal.find({ user: req.session.userId }).sort({ createdAt: -1 }).lean(),
      Investment.find({ user: req.session.userId }).sort({ createdAt: -1 }).populate('plan').lean(),
      getUserLean(req.session.userId)
    ]);
    res.render('dashboard/transactions', { title: 'Transaction History', deposits, withdrawals, investments, user });
  } catch (err) {
    logger.error(`Transactions GET error: ${err.message}`);
    req.flash('error', 'Failed to load transactions.');
    res.redirect('/dashboard');
  }
});

// ── GET /dashboard/profile ────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  const user = await getUserLean(req.session.userId);
  res.render('dashboard/profile', { title: 'My Profile', user, errors: [] });
});

// ── POST /dashboard/profile ───────────────────────────────────────────────────
router.post('/profile',
  [
    body('firstName').trim().isLength({ max: 50 }),
    body('lastName').trim().isLength({ max: 50 }),
    body('phone').trim().isLength({ max: 20 }).optional({ checkFalsy: true }),
    body('country').trim().isLength({ max: 60 }).optional({ checkFalsy: true })
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      const user = await getUserLean(req.session.userId);
      return res.render('dashboard/profile', { title: 'My Profile', user, errors: errs.array() });
    }
    try {
      const { firstName, lastName, phone, country } = req.body;
      await User.findByIdAndUpdate(req.session.userId, { firstName, lastName, phone, country });
      req.flash('success', 'Profile updated successfully.');
      res.redirect('/dashboard/profile');
    } catch (err) {
      logger.error(`Profile update error: ${err.message}`);
      req.flash('error', 'Update failed.');
      res.redirect('/dashboard/profile');
    }
  }
);

// ── POST /dashboard/change-password ──────────────────────────────────────────
router.post('/change-password',
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must be ≥8 chars with upper, lower and number'),
    body('confirmPassword').custom((v, { req }) => {
      if (v !== req.body.newPassword) throw new Error('Passwords do not match');
      return true;
    })
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/dashboard/profile');
    }
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.session.userId).select('+password');
      if (!(await user.matchPassword(currentPassword))) {
        req.flash('error', 'Current password is incorrect.');
        return res.redirect('/dashboard/profile');
      }
      user.password = newPassword;
      await user.save();
      logger.info(`Password changed: userId=${user._id}`);
      req.flash('success', 'Password changed successfully.');
      res.redirect('/dashboard/profile');
    } catch (err) {
      logger.error(`Change-password error: ${err.message}`);
      req.flash('error', 'Password change failed.');
      res.redirect('/dashboard/profile');
    }
  }
);

// ── POST /dashboard/wallets ───────────────────────────────────────────────────
router.post('/wallets',
  [
    body('channel').isIn(['BTC', 'ETH', 'USDT']).withMessage('Invalid channel'),
    body('address').trim().notEmpty().isLength({ max: 200 }).withMessage('Address required')
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/dashboard/withdraw');
    }
    try {
      const { channel, address } = req.body;
      await Wallet.findOneAndUpdate(
        { user: req.session.userId, channel },
        { address },
        { upsert: true, new: true }
      );
      req.flash('success', 'Wallet address saved.');
      res.redirect('/dashboard/withdraw');
    } catch (err) {
      logger.error(`Wallet save error: ${err.message}`);
      req.flash('error', 'Failed to save wallet.');
      res.redirect('/dashboard/withdraw');
    }
  }
);

module.exports = router;
