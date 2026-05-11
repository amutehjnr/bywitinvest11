require('dotenv').config();
const mongoose = require('mongoose');
const { SiteInfo } = require('./models/index');

async function updateSiteInfo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB...');
    
    const result = await SiteInfo.updateOne(
      {}, // Update the first document
      { 
        $set: { 
          logo: '/images/logo1.png',
        } 
      }
    );
    
    console.log('✅ SiteInfo updated successfully!');
    console.log(`Modified: ${result.modifiedCount} document(s)`);
    
    // Verify the update
    const updated = await SiteInfo.findOne().lean();
    console.log('Current site info:', { 
      logo: updated.logo, 
    });
    
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

updateSiteInfo();