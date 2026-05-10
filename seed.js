/**
 * Seed script — run once to populate initial data
 * Usage: node seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const { Plan, Team, Testimonial, FAQ, SiteInfo, Blog } = require('./models/index');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB...');

  // Clear existing
  await Promise.all([
    User.deleteMany({}), Plan.deleteMany({}), Team.deleteMany({}),
    Testimonial.deleteMany({}), FAQ.deleteMany({}), SiteInfo.deleteMany({}), Blog.deleteMany({})
  ]);

  // Admin user
  await User.create({
    username: 'mustaphaadmin',
    email: 'mustaeenms@gmail.com',
    password: await bcrypt.hash('Musamarch@121', 10),
    firstName: 'Site', lastName: 'Admin',
    role: 'admin', isActive: true, isVerified: true,
    balance: 0
  });

  // Demo user
  await User.create({
    username: 'demouser',
    email: 'demo@lucrativeetf.com',
    password: await bcrypt.hash('Demo@123', 10),
    firstName: 'Demo', lastName: 'User',
    country: 'USA', phone: '+1234567890',
    role: 'user', isActive: true, isVerified: true,
    balance: 1000
  });

  // Investment plans
  await Plan.insertMany([
    { name: 'Starter',          rate: 0.065, minAmount: 100,   maxAmount: 499,    duration: 'Weekly' },
    { name: 'Platinum',         rate: 0.075, minAmount: 500,   maxAmount: 900,    duration: 'Weekly' },
    { name: 'Black Horse',      rate: 0.09,  minAmount: 901,   maxAmount: 2400,   duration: 'Weekly' },
    { name: 'Silver Elite',     rate: 0.10,  minAmount: 2401,  maxAmount: 4900,   duration: 'Weekly' },
    { name: 'Gold Premier',     rate: 0.15,  minAmount: 4901,  maxAmount: 7900,   duration: 'Weekly' },
    { name: 'Diamond Crown',    rate: 0.25,  minAmount: 7901,  maxAmount: 10000,  duration: 'Weekly' },
    { name: 'Unlimited Elite',  rate: 0.35,  minAmount: 10001, maxAmount: 500000, duration: 'Weekly' }
  ]);

  // Team
  await Team.insertMany([
    { name: 'Rex Johnson', position: 'CEO & Founder' },
    { name: 'Nonso Williams', position: 'Marketing Director' },
    { name: 'Sarah Mitchell', position: 'CFO' },
    { name: 'David Chen', position: 'Head of Trading' }
  ]);

  // Testimonials
  await Testimonial.insertMany([
    { name: 'Monalisa Thakur', location: 'User from India', message: 'I have invested with this platform and gotten my money in my account. This is legit and safe. Great doing business with them.' },
    { name: 'Sundax Ezma', location: 'User from USA', message: 'Legit and reliable. Although the payment was processed manually, I received my first payment within a very short time.' },
    { name: 'James Okafor', location: 'User from Nigeria', message: 'Amazing platform! The returns are consistent and the support team is always available. Highly recommended!' }
  ]);

  // FAQs
  await FAQ.insertMany([
    { question: 'When can I deposit/withdraw from my Investment account?', answer: 'Deposits and withdrawals are available at any time. Ensure your funds are not in an ongoing trade before withdrawing. The available amount is shown in your dashboard.' },
    { question: 'How do I check my account balance?', answer: 'You can see your balance anytime on your accounts dashboard on the main page of the investing platform.' },
    { question: 'I forgot my password, what should I do?', answer: 'Visit the Forgot Password page, enter your registered email address and click the Reset button. You will receive a reset link by email.' },
    { question: 'How will I know that a withdrawal has been successful?', answer: 'You will get an automatic notification once we process the funds. You can always check your transaction history or account balance.' },
    { question: 'How much can I withdraw?', answer: 'You can withdraw the full amount of your account balance minus any funds currently being used for active investments.' },
    { question: 'Are my investments secure?', answer: 'Yes. We use bank-grade encryption and security protocols to protect all user funds and personal information.' }
  ]);

  // Site Info
  await SiteInfo.create({
    siteName: 'LucrativeETF',
    tagline: 'Maximize Your Earnings with Smart Investments',
    about: 'We are an international financial company engaged in investment activities related to trading on financial markets and cryptocurrency exchanges.',
    phone: '+1 (555) 234-5678',
    email: 'support@lucrativeetf.com',
    address: '256, 1st AVE, Manchester, North England',
    bonusRate: 10,
    tenureType: 'Weekly',
    requireVerification: false,
    privacyPolicy: '<p>Your privacy is important to us. This Privacy Policy explains how LucrativeETF collects and uses information about you.</p>',
    termsConditions: '<p>By using LucrativeETF you agree to these Terms. All investments carry risk.</p>'
  });

  // Sample blog posts
  await Blog.insertMany([
    { headline: 'Bitcoin Appreciates After Market Speculation', intro: 'The most popular cryptocurrency has seen significant gains following weeks of speculation.', body: 'Bitcoin has risen sharply as investors...', createdAt: new Date() },
    { headline: 'Why ETF Investing is the Smart Choice in 2024', intro: 'Exchange Traded Funds continue to outperform traditional investment methods.', body: 'ETF investing provides diversification...', createdAt: new Date() },
    { headline: 'LucrativeETF Reaches $10M in Managed Assets', intro: 'Our platform celebrates a major milestone as total assets under management exceed $10 million.', body: 'We are proud to announce...', createdAt: new Date() }
  ]);

  console.log('✅ Database seeded successfully!');
  console.log('Admin login: admin@lucrativeetf.com / Admin@123');
  console.log('Demo login:  demo@lucrativeetf.com / Demo@123');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
