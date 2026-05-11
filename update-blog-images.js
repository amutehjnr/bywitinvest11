require('dotenv').config();
const mongoose = require('mongoose');
const { Blog } = require('./models/index');

async function updateBlogImages() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected...');

  await Blog.updateOne(
    { headline: "Bitcoin Appreciates After Market Speculation" },
    { $set: { image: "/images/blog/bitcoin.jpg" } }
  );

  await Blog.updateOne(
    { headline: "Why ETF Investing is the Smart Choice in 2024" },
    { $set: { image: "/images/blog/etf-investing.jpg" } }
  );

  await Blog.updateOne(
    { headline: "BywitInvest Reaches $10M in Managed Assets" },
    { $set: { image: "/images/blog/milestone.jpg" } }
  );

  console.log('✅ Blog images updated!');
  await mongoose.disconnect();
}

updateBlogImages();