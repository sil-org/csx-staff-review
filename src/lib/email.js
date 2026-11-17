import { supabase } from './supabase'

// Requires the send-email edge function (supabase/functions/send-email) to
// be deployed and RESEND_API_KEY/RESEND_FROM set as Supabase secrets — see
// SETUP.md. Not deployed by default, since not every app needs email.
export async function sendEmail({ to, subject, html }) {
  const { error } = await supabase.functions.invoke('send-email', { body: { to, subject, html } })
  if (error) throw error
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const RATING_LABELS = { 1: 'Very unhappy', 2: 'Unhappy', 3: 'Neutral', 4: 'Happy', 5: 'Very happy' }

export function feedbackEmailSubject(appName) {
  return `${appName} feedback`
}

// Free-text user input, unlike the other fields here — escaped so a pasted
// `<` or stray quote can't break the layout (or worse) in the recipient's inbox.
export function feedbackEmailHtml({ appName, rating, message, userEmail, page }) {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202124;">
  <h3 style="margin: 0 0 12px;">${escapeHtml(appName)} feedback</h3>
  ${message ? `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>` : ''}
  <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">
    <tr>
      <td style="padding:6px 12px;color:#666666;width:140px">Rating</td>
      <td style="padding:6px 12px">${rating ? `${rating}/5 (${RATING_LABELS[rating]})` : 'not given'}</td>
    </tr>
    <tr style="background:#f8f9fa">
      <td style="padding:6px 12px;color:#666666">From</td>
      <td style="padding:6px 12px">${escapeHtml(userEmail || 'unknown')}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;color:#666666">Page</td>
      <td style="padding:6px 12px">${escapeHtml(page)}</td>
    </tr>
  </table>
</div>`
}
