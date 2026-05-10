const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 465,
      secure: parseInt(process.env.SMTP_PORT, 10) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      rateLimit: 10
    });
  }
  return transporter;
}

const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_USER) {
    logger.warn('SMTP not configured – skipping email to ' + to);
    return;
  }
  try {
    const info = await getTransporter().sendMail({
      from: `"${process.env.SMTP_NAME || 'LucrativeETF'}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
  } catch (err) {
    logger.error(`Email send error to ${to}: ${err.message}`);
  }
};

module.exports = { sendMail };
