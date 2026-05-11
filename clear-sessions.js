// clear-sessions.js
require('dotenv').config();
const mongoose = require('mongoose');

async function clear() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.collection('sessions').deleteMany({});
  console.log('✅ All sessions cleared');
  await mongoose.disconnect();
}
clear();