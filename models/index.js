const mongoose = require('mongoose');

// ── Plan ──────────────────────────────────────────────────────────────────────
const planSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  rate: { type: Number, required: true, min: 0, max: 1 },
  minAmount: { type: Number, required: true, min: 1 },
  maxAmount: { type: Number, required: true, min: 1 },
  duration: { type: String, default: 'Weekly', enum: ['Daily', 'Weekly', 'Monthly'] },
  isActive: { type: Boolean, default: true }
});
const Plan = mongoose.model('Plan', planSchema);

// ── Investment ────────────────────────────────────────────────────────────────
const investmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  planName: { type: String, trim: true },
  amount: { type: Number, required: true, min: 1 },
  rate: { type: Number, min: 0, max: 1 },
  isMature: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
investmentSchema.index({ user: 1, createdAt: -1 });
const Investment = mongoose.model('Investment', investmentSchema);

// ── Deposit ───────────────────────────────────────────────────────────────────
const depositSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT', 'Bank'],
    trim: true
  },
  walletAddress: { type: String, default: '', trim: true }, // wallet funds sent TO
  amount: { type: Number, required: true, min: 1 },
  proofImage: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '', maxlength: 500 },
  processedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
depositSchema.index({ user: 1, createdAt: -1 });
depositSchema.index({ status: 1 });
const Deposit = mongoose.model('Deposit', depositSchema);

// ── Withdrawal ────────────────────────────────────────────────────────────────
const withdrawSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  walletAddress: { type: String, required: true, trim: true, maxlength: 200 },
  channel: {
    type: String,
    default: 'BTC',
    enum: ['BTC', 'ETH', 'USDT'],
    trim: true
  },
  amount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '', maxlength: 500 },
  processedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
withdrawSchema.index({ user: 1, createdAt: -1 });
withdrawSchema.index({ status: 1 });
const Withdrawal = mongoose.model('Withdrawal', withdrawSchema);

// ── Blog ──────────────────────────────────────────────────────────────────────
const blogSchema = new mongoose.Schema({
  headline: { type: String, required: true, trim: true, maxlength: 200 },
  intro: { type: String, default: '', trim: true, maxlength: 500 },
  body: { type: String, default: '' },
  image: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
blogSchema.index({ createdAt: -1 });
const Blog = mongoose.model('Blog', blogSchema);

// ── Team ──────────────────────────────────────────────────────────────────────
const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  position: { type: String, required: true, trim: true, maxlength: 100 },
  photo: { type: String, default: '' }
});
const Team = mongoose.model('Team', teamSchema);

// ── Testimonial ───────────────────────────────────────────────────────────────
const testimonialSchema = new mongoose.Schema({
  message: { type: String, required: true, maxlength: 1000 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  location: { type: String, default: '', trim: true, maxlength: 100 },
  photo: { type: String, default: '' }
});
const Testimonial = mongoose.model('Testimonial', testimonialSchema);

// ── FAQ ───────────────────────────────────────────────────────────────────────
const faqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 300 },
  answer: { type: String, required: true, maxlength: 2000 }
});
const FAQ = mongoose.model('FAQ', faqSchema);

// ── Contact ───────────────────────────────────────────────────────────────────
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email']
  },
  phone: { type: String, default: '', trim: true, maxlength: 20 },
  subject: { type: String, default: '', trim: true, maxlength: 200 },
  message: { type: String, required: true, maxlength: 3000 },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
contactSchema.index({ createdAt: -1 });
const Contact = mongoose.model('Contact', contactSchema);

// ── SiteInfo ──────────────────────────────────────────────────────────────────
const siteInfoSchema = new mongoose.Schema({
  siteName: { type: String, default: 'LucrativeETF', maxlength: 60 },
  tagline: { type: String, default: 'Invest Smart. Grow Wealth.', maxlength: 150 },
  about: { type: String, default: '', maxlength: 5000 },
  phone: { type: String, default: '', maxlength: 30 },
  email: { type: String, default: '', maxlength: 100 },
  address: { type: String, default: '', maxlength: 300 },
  privacyPolicy: { type: String, default: '' },
  termsConditions: { type: String, default: '' },
  logo: { type: String, default: '' },
  favicon: { type: String, default: '' },
  bonusRate: { type: Number, default: 10, min: 0, max: 100 },
  tenureType: { type: String, default: 'Weekly', enum: ['Daily', 'Weekly', 'Monthly'] },
  requireVerification: { type: Boolean, default: false },
  // Crypto wallets
  bitcoinAddress: { type: String, default: '', maxlength: 100 },
  ethereumAddress: { type: String, default: '', maxlength: 100 },
  usdtAddress: { type: String, default: '', maxlength: 100 },
  btcQR: { type: String, default: '' },
  ethQR: { type: String, default: '' },
  usdtQR: { type: String, default: '' }
});
const SiteInfo = mongoose.model('SiteInfo', siteInfoSchema);

// ── Wallet ────────────────────────────────────────────────────────────────────
const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: String, required: true, enum: ['BTC', 'ETH', 'USDT'] },
  address: { type: String, required: true, trim: true, maxlength: 200 }
});
walletSchema.index({ user: 1, channel: 1 }, { unique: true });
const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = {
  Plan, Investment, Deposit, Withdrawal, Blog,
  Team, Testimonial, FAQ, Contact, SiteInfo, Wallet
};
