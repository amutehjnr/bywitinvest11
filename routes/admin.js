const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { Plan, Investment, Deposit, Withdrawal, Blog, Team, Testimonial, FAQ, Contact, SiteInfo, CreditLog } = require('../models/index');
const { ensureAdmin } = require('../middleware/auth');
const upload = require('../config/upload');
const { handleUploadError } = require('../middleware/uploadError');
const { uploadThenCsrf } = require('../middleware/csrfMultipart');
const logger = require('../config/logger');

router.use(ensureAdmin);

// ── GET /admin ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [users, pendingDeposits, pendingWithdrawals, contacts,
           deposits, withdrawals, investments] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      Deposit.countDocuments({ status: 'pending' }),
      Withdrawal.countDocuments({ status: 'pending' }),
      Contact.countDocuments({ isRead: false }),
      Deposit.find().sort({ createdAt: -1 }).limit(10).populate('user', 'username email').lean(),
      Withdrawal.find().sort({ createdAt: -1 }).limit(10).populate('user', 'username email').lean(),
      Investment.find().sort({ createdAt: -1 }).limit(10).populate('user', 'username').populate('plan', 'name').lean()
    ]);
    res.render('admin/index', {
      title: 'Admin Dashboard',
      users, deposits, withdrawals, investments,
      pendingDeposits, pendingWithdrawals, contacts
    });
  } catch (err) {
    logger.error(`Admin dashboard error: ${err.message}`);
    res.redirect('/');
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  res.render('admin/users', { title: 'Manage Users', users });
});

router.post('/users/:id/toggle', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
    if (user.role === 'admin') { req.flash('error', 'Cannot deactivate admin accounts.'); return res.redirect('/admin/users'); }
    user.isActive = !user.isActive;
    await user.save();
    logger.info(`Admin toggled user ${user.email} active=${user.isActive}`);
    req.flash('success', `User ${user.isActive ? 'activated' : 'deactivated'}.`);
  } catch (err) { req.flash('error', 'Action failed.'); }
  res.redirect('/admin/users');
});

router.post('/users/:id/credit',
  [body('amount').isFloat({ min: 0.01, max: 1000000 }).withMessage('Invalid amount')],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/admin/users');
    }
    try {
      const { amount } = req.body;
      const amt = parseFloat(parseFloat(amount).toFixed(2));
      const user = await User.findByIdAndUpdate(req.params.id, { $inc: { balance: amt } }, { new: true });
      if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
      logger.info(`Admin credited $${amt} to userId=${req.params.id}`);
      req.flash('success', `$${amt.toFixed(2)} credited to ${user.username}.`);
    } catch (err) { req.flash('error', 'Credit failed.'); }
    res.redirect('/admin/users');
  }
);

router.post('/users/:id/delete', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
    if (user.role === 'admin') { req.flash('error', 'Cannot delete admin accounts.'); return res.redirect('/admin/users'); }
    await User.findByIdAndDelete(req.params.id);
    logger.warn(`Admin deleted userId=${req.params.id}`);
    req.flash('success', 'User deleted.');
  } catch (err) { req.flash('error', 'Delete failed.'); }
  res.redirect('/admin/users');
});

// ── Deposits ──────────────────────────────────────────────────────────────────
router.get('/deposits', async (req, res) => {
  const deposits = await Deposit.find().sort({ createdAt: -1 }).populate('user', 'username email').lean();
  res.render('admin/deposits', { title: 'Manage Deposits', deposits });
});

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id).populate('user');
    if (!deposit) { req.flash('error', 'Deposit not found.'); return res.redirect('/admin/deposits'); }
    if (deposit.status !== 'pending') { req.flash('error', 'Already processed.'); return res.redirect('/admin/deposits'); }
    deposit.status = 'approved';
    deposit.processedAt = new Date();
    await deposit.save();
    await User.findByIdAndUpdate(deposit.user._id, { $inc: { balance: deposit.amount } });
    logger.info(`Deposit approved: depositId=${deposit._id} userId=${deposit.user._id} amount=${deposit.amount}`);
    req.flash('success', `Deposit of $${deposit.amount.toFixed(2)} approved.`);
  } catch (err) { req.flash('error', 'Approval failed.'); }
  res.redirect('/admin/deposits');
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit || deposit.status !== 'pending') { req.flash('error', 'Cannot reject.'); return res.redirect('/admin/deposits'); }
    deposit.status = 'rejected';
    deposit.processedAt = new Date();
    await deposit.save();
    logger.info(`Deposit rejected: depositId=${deposit._id}`);
    req.flash('success', 'Deposit rejected.');
  } catch (err) { req.flash('error', 'Rejection failed.'); }
  res.redirect('/admin/deposits');
});

// ── Withdrawals ───────────────────────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  const withdrawals = await Withdrawal.find().sort({ createdAt: -1 }).populate('user', 'username email').lean();
  res.render('admin/withdrawals', { title: 'Manage Withdrawals', withdrawals });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id);
    if (!w || w.status !== 'pending') { req.flash('error', 'Cannot approve.'); return res.redirect('/admin/withdrawals'); }
    w.status = 'approved';
    w.processedAt = new Date();
    await w.save();
    logger.info(`Withdrawal approved: withdrawalId=${w._id} amount=${w.amount}`);
    req.flash('success', `Withdrawal of $${w.amount.toFixed(2)} approved.`);
  } catch (err) { req.flash('error', 'Approval failed.'); }
  res.redirect('/admin/withdrawals');
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id).populate('user');
    if (!w) { req.flash('error', 'Not found.'); return res.redirect('/admin/withdrawals'); }
    if (w.status !== 'pending') { req.flash('error', 'Already processed.'); return res.redirect('/admin/withdrawals'); }
    w.status = 'rejected';
    w.processedAt = new Date();
    await w.save();
    await User.findByIdAndUpdate(w.user._id, { $inc: { balance: w.amount } });
    logger.info(`Withdrawal rejected + refunded: withdrawalId=${w._id} amount=${w.amount}`);
    req.flash('success', 'Withdrawal rejected and balance refunded.');
  } catch (err) { req.flash('error', 'Rejection failed.'); }
  res.redirect('/admin/withdrawals');
});

// ── Plans ─────────────────────────────────────────────────────────────────────
router.get('/plans', async (req, res) => {
  const plans = await Plan.find().lean();
  res.render('admin/plans', { title: 'Manage Plans', plans });
});

router.post('/plans',
  [
    body('name').trim().notEmpty().isLength({ max: 60 }),
    body('rate').isFloat({ min: 0.001, max: 1 }),
    body('minAmount').isFloat({ min: 1 }),
    body('maxAmount').isFloat({ min: 1 }),
    body('duration').isIn(['Daily', 'Weekly', 'Monthly'])
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/admin/plans');
    }
    const { name, rate, minAmount, maxAmount, duration } = req.body;
    await Plan.create({ name, rate: parseFloat(rate), minAmount: parseFloat(minAmount), maxAmount: parseFloat(maxAmount), duration });
    req.flash('success', 'Plan created.');
    res.redirect('/admin/plans');
  }
);

router.post('/plans/:id/delete', async (req, res) => {
  await Plan.findByIdAndDelete(req.params.id);
  req.flash('success', 'Plan deleted.');
  res.redirect('/admin/plans');
});

router.post('/plans/:id/toggle', async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (plan) { plan.isActive = !plan.isActive; await plan.save(); }
  res.redirect('/admin/plans');
});

// ── Blog ──────────────────────────────────────────────────────────────────────
router.get('/blog', async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 }).lean();
  res.render('admin/blog', { title: 'Manage Blog', blogs });
});

// FIX: multer runs before csurf via uploadThenCsrf
router.post('/blog',
  ...uploadThenCsrf(upload.single('image')),
  handleUploadError,
  [body('headline').trim().notEmpty().isLength({ max: 200 })],
  async (req, res) => {
    const { headline, intro, body: bodyText } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : '';
    await Blog.create({ headline, intro, body: bodyText, image });
    req.flash('success', 'Blog post created.');
    res.redirect('/admin/blog');
  }
);

router.post('/blog/:id/delete', async (req, res) => {
  await Blog.findByIdAndDelete(req.params.id);
  req.flash('success', 'Post deleted.');
  res.redirect('/admin/blog');
});

// ── Team ──────────────────────────────────────────────────────────────────────
router.get('/team', async (req, res) => {
  const team = await Team.find().lean();
  res.render('admin/team', { title: 'Manage Team', team });
});

// FIX: multer runs before csurf via uploadThenCsrf
router.post('/team',
  ...uploadThenCsrf(upload.single('photo')),
  handleUploadError,
  async (req, res) => {
    const { name, position } = req.body;
    const photo = req.file ? '/uploads/' + req.file.filename : '';
    await Team.create({ name, position, photo });
    req.flash('success', 'Team member added.');
    res.redirect('/admin/team');
  }
);

router.post('/team/:id/delete', async (req, res) => {
  await Team.findByIdAndDelete(req.params.id);
  res.redirect('/admin/team');
});

// ── Testimonials ──────────────────────────────────────────────────────────────
router.get('/testimonials', async (req, res) => {
  const testimonials = await Testimonial.find().lean();
  res.render('admin/testimonials', { title: 'Manage Testimonials', testimonials });
});

// FIX: multer runs before csurf via uploadThenCsrf
router.post('/testimonials',
  ...uploadThenCsrf(upload.single('photo')),
  handleUploadError,
  async (req, res) => {
    const { message, name, location } = req.body;
    const photo = req.file ? '/uploads/' + req.file.filename : '';
    await Testimonial.create({ message, name, location, photo });
    req.flash('success', 'Testimonial added.');
    res.redirect('/admin/testimonials');
  }
);

router.post('/testimonials/:id/delete', async (req, res) => {
  await Testimonial.findByIdAndDelete(req.params.id);
  res.redirect('/admin/testimonials');
});

// ── FAQ ───────────────────────────────────────────────────────────────────────
router.get('/faq', async (req, res) => {
  const faqs = await FAQ.find().lean();
  res.render('admin/faq', { title: 'Manage FAQ', faqs });
});

router.post('/faq',
  [body('question').trim().notEmpty(), body('answer').trim().notEmpty()],
  async (req, res) => {
    const { question, answer } = req.body;
    await FAQ.create({ question, answer });
    res.redirect('/admin/faq');
  }
);

router.post('/faq/:id/delete', async (req, res) => {
  await FAQ.findByIdAndDelete(req.params.id);
  res.redirect('/admin/faq');
});

// ── Contacts ──────────────────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  const contacts = await Contact.find().sort({ createdAt: -1 }).lean();
  await Contact.updateMany({ isRead: false }, { isRead: true });
  res.render('admin/contacts', { title: 'Contact Messages', contacts });
});

// ── Site Settings ─────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const siteInfo = await SiteInfo.findOne().lean() || {};
  res.render('admin/settings', { title: 'Site Settings', siteInfo });
});

// FIX: upload.fields() (multipart) must run before csurf.
//      uploadThenCsrf handles the ordering correctly.
router.post('/settings',
  ...uploadThenCsrf(
    upload.fields([
      { name: 'logo',    maxCount: 1 },
      { name: 'favicon', maxCount: 1 },
      { name: 'btcQR',   maxCount: 1 },
      { name: 'ethQR',   maxCount: 1 },
      { name: 'usdtQR',  maxCount: 1 }
    ])
  ),
  handleUploadError,
  async (req, res) => {
    try {
      const update = {
        siteName:        req.body.siteName        || 'LucrativeETF',
        tagline:         req.body.tagline         || '',
        phone:           req.body.phone           || '',
        email:           req.body.email           || '',
        address:         req.body.address         || '',
        bonusRate:       parseFloat(req.body.bonusRate) || 10,
        bitcoinAddress:  req.body.bitcoinAddress  || '',
        ethereumAddress: req.body.ethereumAddress || '',
        usdtAddress:     req.body.usdtAddress     || '',
        privacyPolicy:   req.body.privacyPolicy   || '',
        termsConditions: req.body.termsConditions || ''
      };
      if (req.files?.logo)    update.logo    = '/uploads/' + req.files.logo[0].filename;
      if (req.files?.favicon) update.favicon = '/uploads/' + req.files.favicon[0].filename;
      if (req.files?.btcQR)   update.btcQR   = '/uploads/' + req.files.btcQR[0].filename;
      if (req.files?.ethQR)   update.ethQR   = '/uploads/' + req.files.ethQR[0].filename;
      if (req.files?.usdtQR)  update.usdtQR  = '/uploads/' + req.files.usdtQR[0].filename;

      await SiteInfo.findOneAndUpdate({}, update, { upsert: true, new: true });
      logger.info('Admin updated site settings');
      req.flash('success', 'Settings saved.');
      res.redirect('/admin/settings');
    } catch (err) {
      logger.error(`Settings save error: ${err.message}`);
      req.flash('error', 'Save failed.');
      res.redirect('/admin/settings');
    }
  }
);

// ── GET /admin/credit ─────────────────────────────────────────────────────
router.get('/credit', async (req, res) => {
  try {
    console.log('CreditLog:', typeof CreditLog);
    // CSV export
    if (req.query.export === '1') {
      const log = await CreditLog.find().sort({ createdAt: -1 }).lean();
      const header = 'Date,Username,Email,Operation,Field,Amount,Note\n';
      const rows = log.map(e =>
        `"${new Date(e.createdAt).toISOString()}","${e.username}","${e.email}","${e.operation}","${e.field}","${e.amount}","${(e.note || '').replace(/"/g, '""')}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="credit-log.csv"');
      return res.send(header + rows);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [users, creditLog, todayLog] = await Promise.all([
      User.find({ role: 'user' }).select('username email balance bonus totalInvested isActive').sort({ username: 1 }).lean(),
      CreditLog.find().sort({ createdAt: -1 }).limit(100).lean(),
      CreditLog.find({ createdAt: { $gte: today } }).lean()
    ]);

    const creditsToday     = todayLog.length;
    const totalCreditedToday = todayLog
      .filter(e => e.operation === 'credit')
      .reduce((s, e) => s + e.amount, 0);

    res.render('admin/credit', {
      title: 'Manual Credit / Debit',
      users,
      creditLog,
      creditsToday,
      totalCreditedToday
    });
  } catch (err) {
    logger.error(`Admin credit GET error: ${err.message}`);
    req.flash('error', 'Failed to load credit page.');
    res.redirect('/admin');
  }
});

// ── POST /admin/credit ────────────────────────────────────────────────────
router.post('/credit',
  [
    body('userId').isMongoId().withMessage('Invalid user'),
    body('operation').isIn(['credit', 'debit']).withMessage('Invalid operation'),
    body('field').isIn(['balance', 'bonus', 'totalInvested']).withMessage('Invalid field'),
    body('amount').isFloat({ min: 0.01, max: 10000000 }).withMessage('Invalid amount'),
    body('note').trim().isLength({ max: 300 }).optional({ checkFalsy: true })
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/admin/credit');
    }
    try {
      const { userId, operation, field, amount, note } = req.body;
      const amt = parseFloat(parseFloat(amount).toFixed(2));

      const user = await User.findById(userId);
      if (!user || user.role === 'admin') {
        req.flash('error', 'User not found.');
        return res.redirect('/admin/credit');
      }

      // Prevent debit below zero
      if (operation === 'debit' && user[field] < amt) {
        req.flash('error', `Cannot debit $${amt.toFixed(2)} — user only has $${user[field].toFixed(2)} in ${field}.`);
        return res.redirect('/admin/credit');
      }

      const delta = operation === 'credit' ? amt : -amt;
      await User.findByIdAndUpdate(userId, { $inc: { [field]: delta } });

      // Write audit log
      await CreditLog.create({
        userId:    user._id,
        username:  user.username,
        email:     user.email,
        operation,
        field,
        amount:    amt,
        note:      note || ''
      });

      logger.info(`Admin manual ${operation}: userId=${userId} field=${field} amount=${amt}`);
      req.flash('success',
        `${operation === 'credit' ? 'Credited' : 'Debited'} $${amt.toFixed(2)} (${field}) ${operation === 'credit' ? 'to' : 'from'} ${user.username}.`
      );
      res.redirect('/admin/credit');
    } catch (err) {
      logger.error(`Admin credit POST error: ${err.message}`);
      req.flash('error', 'Transaction failed. Please try again.');
      res.redirect('/admin/credit');
    }
  }
);

router.post('/plans/:id/edit',
  [
    body('name').trim().notEmpty().isLength({ max: 60 }),
    body('rate').isFloat({ min: 0.001, max: 1 }),
    body('minAmount').isFloat({ min: 1 }),
    body('maxAmount').isFloat({ min: 1 }),
    body('duration').isIn(['Daily', 'Weekly', 'Monthly'])
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', errs.array()[0].msg);
      return res.redirect('/admin/plans');
    }
    try {
      const { name, rate, minAmount, maxAmount, duration } = req.body;
      const plan = await Plan.findById(req.params.id);
      if (!plan) {
        req.flash('error', 'Plan not found.');
        return res.redirect('/admin/plans');
      }
      plan.name      = name;
      plan.rate      = parseFloat(rate);
      plan.minAmount = parseFloat(minAmount);
      plan.maxAmount = parseFloat(maxAmount);
      plan.duration  = duration;
      await plan.save();
      logger.info(`Admin edited plan: ${plan._id} → ${name}`);
      req.flash('success', `Plan "${name}" updated successfully.`);
    } catch (err) {
      logger.error(`Plan edit error: ${err.message}`);
      req.flash('error', 'Update failed.');
    }
    res.redirect('/admin/plans');
  }
);

module.exports = router;