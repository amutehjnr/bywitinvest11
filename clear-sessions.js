/**
 * clear-sessions.js
 *
 * Run ONCE after deploying the fixed app.js to Render.
 * Drops every session document from MongoDB so connect-mongo never
 * again tries to decrypt the old null-keyed encrypted blobs.
 *
 * Usage:
 *   node clear-sessions.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function clear() {
  if (!process.env.MONGODB_URI) {
    console.error('❌  MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);

  const col = mongoose.connection.collection('sessions');
  const before = await col.countDocuments();
  await col.deleteMany({});
  const after = await col.countDocuments();

  console.log(`✅  Deleted ${before - after} session document(s). Remaining: ${after}`);
  await mongoose.disconnect();
  console.log('Disconnected. Safe to restart the app.');
}

clear().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});