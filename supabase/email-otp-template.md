# Urban Kicks Email OTP Template

Use this in Supabase Dashboard > Authentication > Email Templates so customers see only the manual verification code.

Subject:

Urban Kicks verification code: {{ .Token }}

Body:

Your Urban Kicks verification code is:

{{ .Token }}

This code expires quickly. Return to the Urban Kicks app and enter the 6-digit code.

If you did not request this code, ignore this email.

Do not include any clickable authentication URL in the template.
