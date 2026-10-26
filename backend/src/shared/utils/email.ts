import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  auth: env.SMTP_USERNAME
    ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
    : undefined,
});

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (env.NODE_ENV === 'development') {
    // In development, just log the email instead of actually sending
    console.log(`\n[EMAIL] to: ${options.to}`);
    console.log(`   Subject: ${options.subject}`);
    console.log(`   Body (HTML): ${options.html.substring(0, 200)}...\n`);
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_USERNAME || 'noreply@omniagent.local',
    ...options,
  });
}

export function sendConfirmationEmail(email: string, token: string, accountName?: string): Promise<void> {
  const confirmUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/confirmation?confirmation_token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Confirm your email address',
    html: `<p>Welcome${accountName ? ` to ${accountName}` : ''}!</p><p><a href="${confirmUrl}">Click here to confirm your email</a></p>`,
  });
}

export function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/password/edit?reset_password_token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Reset your password',
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p>`,
  });
}
