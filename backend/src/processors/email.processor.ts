import type { Job } from 'bullmq';
import { sendEmail, sendConfirmationEmail, sendPasswordResetEmail } from '../shared/utils/email.js';

/**
 * Email queue processor — handles all transactional email.
 *
 * Job names:
 *   - send_confirmation_email
 *   - send_password_reset_email
 *   - conversation_reply
 *   - send_email (generic)
 */

interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  email?: string;
  token?: string;
  account_name?: string;
}

export async function emailProcessor(job: Job): Promise<{ sent: boolean; to?: string }> {
  const data = job.data as EmailJobData;

  switch (job.name) {
    case 'send_confirmation_email': {
      const { email, token, account_name } = data;
      if (email && token) {
        await sendConfirmationEmail(email, token, account_name);
        return { sent: true, to: email };
      }
      return { sent: false };
    }

    case 'send_password_reset_email': {
      const { email, token } = data;
      if (email && token) {
        await sendPasswordResetEmail(email, token);
        return { sent: true, to: email };
      }
      return { sent: false };
    }

    case 'conversation_reply':
    case 'send_email':
    default: {
      const { to, subject, html } = data;
      if (to && subject) {
        await sendEmail({ to, subject, html: html ?? '' });
        return { sent: true, to };
      }
      return { sent: false };
    }
  }
}
