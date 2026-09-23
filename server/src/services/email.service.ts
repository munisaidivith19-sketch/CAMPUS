/**
 * Transactional email (dev: Mailpit at SMTP_HOST:SMTP_PORT — no credentials, nothing leaves
 * the machine; see docs/API_KEYS.md).
 *
 * Two rules govern everything here:
 *  1. **Secrets are never logged.** Verification links, reset links and OTP codes go into the
 *     message body only. Log lines record the template name and recipient, never the token.
 *  2. **Failure is never hidden.** If SMTP is down the error is logged at `error` level and the
 *     caller is told, so no flow can silently pretend an email was delivered.
 *
 * Under NODE_ENV=test a JSON transport is used instead of a socket, and the messages are kept
 * in `sentMailbox` so tests can assert on what would have been sent without a live SMTP server.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface SentMessage {
  to: string;
  subject: string;
  text: string;
}

/** Test-only capture buffer. Empty in dev/production. */
export const sentMailbox: SentMessage[] = [];

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = config.isTest
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        // Mailpit accepts unauthenticated mail; real SMTP providers set these in .env.
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
      });

  return transporter;
}

async function send(message: SentMessage): Promise<void> {
  if (config.isTest) sentMailbox.push(message);

  try {
    await getTransporter().sendMail({
      from: config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    // Recipient + template only. The body (which carries the token) is never logged.
    logger.info({ to: message.to, subject: message.subject }, 'Email dispatched');
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, 'Email dispatch FAILED');
    throw err;
  }
}

export async function sendVerificationEmail(to: string, fullName: string, token: string): Promise<void> {
  const link = `${config.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: 'Verify your CampusConnect account',
    text: [
      `Hi ${fullName},`,
      '',
      'Confirm your email address to activate your CampusConnect account:',
      link,
      '',
      'This link expires in 24 hours. If you did not create this account, ignore this email.',
    ].join('\n'),
  });
}

/**
 * Sent when someone tries to register an address that already has an account.
 *
 * The HTTP response is identical to a fresh signup, so the request itself reveals nothing. This
 * email is what stops that privacy choice from stranding the real owner: they get told an
 * account exists and how to get into it, while an attacker probing the endpoint learns nothing
 * — the mail goes to the mailbox owner, not to whoever made the request.
 */
export async function sendAccountExistsEmail(to: string, fullName: string): Promise<void> {
  await send({
    to,
    subject: 'You already have a CampusConnect account',
    text: [
      `Hi ${fullName},`,
      '',
      'Someone just tried to create a CampusConnect account with this email address, but you',
      'already have one. No new account was created and nothing has changed.',
      '',
      `Sign in:           ${config.WEB_APP_URL}/login`,
      `Forgot password?   ${config.WEB_APP_URL}/forgot-password`,
      '',
      'If this was not you, no action is needed — but consider resetting your password if you',
      'did not expect this.',
    ].join('\n'),
  });
}

export async function sendPasswordResetEmail(to: string, fullName: string, token: string): Promise<void> {
  const link = `${config.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: 'Reset your CampusConnect password',
    text: [
      `Hi ${fullName},`,
      '',
      'We received a request to reset your password. Use the link below:',
      link,
      '',
      'This link expires in 30 minutes and can be used once.',
      'If you did not request this, your password is unchanged and no action is needed.',
    ].join('\n'),
  });
}

/** Sent AFTER a successful reset so an account takeover is visible to the real owner. */
export async function sendPasswordChangedEmail(to: string, fullName: string): Promise<void> {
  await send({
    to,
    subject: 'Your CampusConnect password was changed',
    text: [
      `Hi ${fullName},`,
      '',
      'Your password was just changed and all other sessions were signed out.',
      'If this was not you, reset your password immediately and contact your administrator.',
    ].join('\n'),
  });
}

export async function sendDeviceOtpEmail(to: string, fullName: string, code: string): Promise<void> {
  await send({
    to,
    subject: 'Your CampusConnect verification code',
    text: [
      `Hi ${fullName},`,
      '',
      `Verification code: ${code}`,
      '',
      'We noticed a sign-in from a device you have not used before.',
      'This code expires in 10 minutes. If this was not you, change your password.',
    ].join('\n'),
  });
}
