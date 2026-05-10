const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { Plan, Team, Testimonial, FAQ, Blog, Contact, SiteInfo } = require('../models/index');
const { contactLimiter } = require('../config/rateLimit');
const logger = require('../config/logger');

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [plans, team, testimonials, faqs, blogs] = await Promise.all([
      Plan.find({ isActive: true }).lean(),
      Team.find().lean(),
      Testimonial.find().lean(),
      FAQ.find().lean(),
      Blog.find().sort({ createdAt: -1 }).limit(3).lean()
    ]);
    res.render('index', { title: 'Home', plans, team, testimonials, faqs, blogs });
  } catch (err) {
    logger.error(`Homepage error: ${err.message}`);
    res.render('index', { title: 'Home', plans: [], team: [], testimonials: [], faqs: [], blogs: [] });
  }
});

router.get('/about',   async (req, res) => res.render('about',   { title: 'About Us' }));
router.get('/privacy', async (req, res) => res.render('privacy', { title: 'Privacy Policy' }));
router.get('/terms',   async (req, res) => res.render('terms',   { title: 'Terms & Conditions' }));
router.get('/faq',     async (req, res) => {
  const faqs = await FAQ.find().lean();
  res.render('faq', { title: 'FAQ', faqs });
});

router.get('/plans', async (req, res) => {
  const plans = await Plan.find({ isActive: true }).lean();
  res.render('plans', { title: 'Investment Plans', plans });
});

router.get('/blog', async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 }).lean();
  res.render('blog', { title: 'News & Blog', blogs });
});

router.get('/blog/:id', async (req, res) => {
  try {
    // Validate ObjectId to prevent CastError
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.redirect('/blog');
    const post = await Blog.findById(req.params.id).lean();
    if (!post) return res.redirect('/blog');
    res.render('blog-single', { title: post.headline, post });
  } catch {
    res.redirect('/blog');
  }
});

// ── POST /contact ─────────────────────────────────────────────────────────────
router.post('/contact', contactLimiter,
  [
    body('name').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('phone').trim().isLength({ max: 20 }).optional({ checkFalsy: true }).escape(),
    body('subject').trim().isLength({ max: 200 }).optional({ checkFalsy: true }).escape(),
    body('message').trim().notEmpty().isLength({ max: 3000 })
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      req.flash('error', 'Please fill all required fields correctly.');
      return res.redirect('/#contact');
    }
    try {
      const { name, email, phone, subject, message } = req.body;
      await Contact.create({ name, email, phone, subject, message });
      req.flash('success', 'Your message has been sent. We will get back to you shortly.');
    } catch (err) {
      logger.error(`Contact form error: ${err.message}`);
      req.flash('error', 'Failed to send message. Please try again.');
    }
    res.redirect('/#contact');
  }
);

module.exports = router;
