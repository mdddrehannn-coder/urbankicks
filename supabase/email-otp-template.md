# Urban Kicks Email OTP Template

Use this in Supabase Dashboard > Authentication > Email Templates for confirmation and magic-link style emails so customers see only the manual code.

Subject:

Urban Kicks verification code: {{ .Token }}

Body:

Your Urban Kicks verification code is:

{{ .Token }}

This code expires quickly. Return to the Urban Kicks app and enter the 6-digit code.

If you did not request this code, ignore this email.

Do not include `{{ .ConfirmationURL }}`, `{{ .RedirectTo }}`, or any clickable authentication link in the template.
