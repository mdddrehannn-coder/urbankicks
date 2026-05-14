# Urban Kicks India Supabase Email OTP Template

Use this in Supabase Dashboard > Authentication > Email Templates for signup, recovery, and email-change OTP emails.

Sender name:

Urban Kicks India

Subject:

Urban Kicks India Verification Code

SMTP:

Use Resend or another custom SMTP provider in Supabase Dashboard > Project Settings > Authentication > SMTP Settings. Do not use the default Supabase mail sender if you want all visible sender branding to be Urban Kicks India.

HTML body:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Urban Kicks India Verification Code</title>
  </head>
  <body style="margin:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;color:#111318;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e8e8ec;">
            <tr>
              <td style="background:#070708;padding:28px 24px;text-align:center;">
                <img src="https://urban-kicks-india.vercel.app/assets/urban-kicks-logo.png" width="92" alt="Urban Kicks India" style="display:block;margin:0 auto 16px;border-radius:18px;background:#ffffff;">
                <div style="color:#ffffff;font-size:24px;font-weight:900;letter-spacing:.02em;">Urban Kicks India</div>
                <div style="color:#ff3b45;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin-top:6px;">Premium Streetwear Sneaker Store</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hello,</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Your Urban Kicks India verification code is:</p>
                <div style="margin:0 0 20px;padding:18px 16px;border-radius:18px;background:#0b0c10;color:#ffffff;text-align:center;font-size:34px;font-weight:900;letter-spacing:.18em;">
                  {{ .Token }}
                </div>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#444b57;">This code will expire in 10 minutes.</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#444b57;">If you did not request this code, please ignore this email.</p>
                <p style="margin:0;color:#111318;font-size:15px;line-height:1.6;">— Urban Kicks India<br>Premium Streetwear Sneaker Store</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

Plain text fallback:

```text
Hello,

Your Urban Kicks India verification code is:

{{ .Token }}

This code will expire in 10 minutes.

If you did not request this code, please ignore this email.

— Urban Kicks India
Premium Streetwear Sneaker Store
```
