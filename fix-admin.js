// fix-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = await User.findOne({ email: 'mustaeenms@gmail.com' });
  if (!admin) { console.log('User not found — run seed.js first'); process.exit(); }
  admin.password = 'Musamarch@121'; // pre-save hook will hash it correctly
  await admin.save();
  console.log('✅ Password reset successfully');
  await mongoose.disconnect();
}
fix();