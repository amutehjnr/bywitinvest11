const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false
  },
  firstName: { type: String, default: '', trim: true, maxlength: 50 },
  lastName:  { type: String, default: '', trim: true, maxlength: 50 },
  country:   { type: String, default: '', trim: true, maxlength: 60 },
  phone:     { type: String, default: '', trim: true, maxlength: 20 },
  role:      { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive:  { type: Boolean, default: true },
  isVerified:{ type: Boolean, default: false },
  balance:      { type: Number, default: 0, min: 0 },
  totalInvested:{ type: Number, default: 0, min: 0 },
  bonus:        { type: Number, default: 0, min: 0 },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Brute-force protection
  loginAttempts: { type: Number, default: 0, select: false },
  lockUntil:     { type: Date, default: null, select: false },
  // Password reset
  verifyToken:       { type: String, default: '', select: false },
  verifyTokenExpiry: { type: Date,   default: null, select: false },
  // Audit
  lastLogin:   { type: Date, default: null },
  lastLoginIp: { type: String, default: '' },
  createdAt:   { type: Date, default: Date.now }
});

// ── Indexes ───────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

// ── Virtual: isLocked ─────────────────────────────────
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ── Pre-save: hash password ───────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ── Method: compare password ──────────────────────────
userSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

// ── Method: increment login attempts ─────────────────
const MAX_ATTEMPTS = 5;
const LOCK_TIME    = 2 * 60 * 60 * 1000; // 2 hours

userSchema.methods.incLoginAttempts = async function () {
  // If previous lock has expired, reset
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set:   { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= MAX_ATTEMPTS && !this.isLocked) {
    updates.$set = { lockUntil: new Date(Date.now() + LOCK_TIME) };
  }
  return this.updateOne(updates);
};

// ── Method: reset login attempts ─────────────────────
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $set:   { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

module.exports = mongoose.model('User', userSchema);