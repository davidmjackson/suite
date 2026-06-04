// lib/email.js
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eta = new Eta({ views: path.join(__dirname, "../views"), cache: false });

export async function renderMagicLinkEmail({ url }) {
  return await eta.renderAsync("emails/magic-link", { url });
}

export async function renderAccessApprovedEmail({ url }) {
  return await eta.renderAsync("emails/access-approved", { url });
}

export async function renderAccessRequestNotificationEmail({ request, reviewUrl }) {
  return await eta.renderAsync("emails/access-request-notification", { request, reviewUrl });
}

export function createEmailSender({ apiKey, from }) {
  const resend = new Resend(apiKey);
  return {
    async sendMagicLink({ to, url }) {
      const html = await renderMagicLinkEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: "Your Sprint Suite sign-in link",
        html,
      });
    },
    async sendAccessApproved({ to, url }) {
      const html = await renderAccessApprovedEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: "You're approved — sign in to Sprint Suite",
        html,
      });
    },
    async sendAccessRequestNotification({ to, request, reviewUrl }) {
      const html = await renderAccessRequestNotificationEmail({ request, reviewUrl });
      return await resend.emails.send({
        from,
        to,
        subject: `New Sprint Suite access request — ${request.companyName}`,
        html,
      });
    },
  };
}
