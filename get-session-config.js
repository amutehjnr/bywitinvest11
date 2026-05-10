// get-session-config.js
require('dotenv').config();

// Check environment variables
console.log('🔍 SESSION CONFIGURATION CHECK');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Check .env for session secret
const sessionSecret = process.env.SESSION_SECRET || process.env.SESSION_KEY || process.env.SECRET_KEY;
if (sessionSecret) {
    console.log('✅ SESSION_SECRET found in .env:', sessionSecret.substring(0, 10) + '...');
} else {
    console.log('⚠️  No SESSION_SECRET found in .env');
}

// Check for other common names
const commonNames = ['SESSION_SECRET', 'SESSION_KEY', 'SECRET_KEY', 'APP_SECRET', 'COOKIE_SECRET'];
console.log('\n📋 Looking for session secret in environment:');
commonNames.forEach(name => {
    if (process.env[name]) {
        console.log(`   - ${name}: ${process.env[name].substring(0, 10)}...`);
    }
});

// Check MongoDB for sessions (shows session IDs, NOT the secret)
console.log('\n📊 To view stored sessions in MongoDB:');
console.log('   Run: node get-sessions.js');