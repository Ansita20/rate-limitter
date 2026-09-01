/**
 * Shared email transport, configured via env vars. Works with Gmail SMTP
 * (using an App Password, not your real Gmail password) or any other SMTP
 * provider — just point SMTP_HOST/PORT at it instead.
 *
 * SMTP_HOST — defaults to Gmail's SMTP server
 * SMTP_PORT — defaults to 587 (STARTTLS)
 * SMTP_USER — the sending address (e.g. your Gmail address)
 * SMTP_PASS — Gmail App Password (myaccount.google.com/apppasswords), or
 *   your provider's SMTP password
 */

const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

if (!SMTP_USER || !SMTP_PASS) {
  console.warn('[mailer] SMTP_USER / SMTP_PASS not set — password reset and email verification will fail until configured.');
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // STARTTLS on port 587
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

async function sendMail({ to, subject, html }) {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('Email is not configured on this server (SMTP_USER / SMTP_PASS missing)');
  }
  await transporter.sendMail({
    from: `"Throttle" <${SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
