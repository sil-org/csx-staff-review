// Generic Resend-backed send — client-callable (any signed-in user's JWT is
// accepted; add stricter checks here if this app needs to restrict who can
// trigger email). Requires RESEND_API_KEY and RESEND_FROM set as Supabase
// secrets (`npx supabase secrets set ...`, see SETUP.md), and the email_log
// table from schema.sql.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM = Deno.env.get('RESEND_FROM') || 'App <noreply@example.org>'
const REPLY_TO = Deno.env.get('RESEND_REPLY_TO') || undefined

interface EmailRequest {
  to: string
  subject: string
  html: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body: EmailRequest = await req.json()
    const { to, subject, html } = body

    if (!to || !subject || !html) {
      return json({ error: 'Missing required fields: to, subject, html' }, 400)
    }

    const resendRes = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(REPLY_TO ? { reply_to: REPLY_TO } : {}) }),
    })

    const resendData = await resendRes.json()
    const status = resendRes.ok ? 'sent' : 'failed'
    const error = resendRes.ok ? null : JSON.stringify(resendData)

    await supabase.from('email_log').insert({
      to_email: to,
      subject,
      resend_id: resendData.id || null,
      status,
      error,
    })

    if (!resendRes.ok) {
      return json({ error: 'Failed to send email', detail: resendData }, 500)
    }

    return json({ success: true, id: resendData.id })
  } catch (err) {
    return json({ error: err.message }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
