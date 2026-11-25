# Firebase Auth Setup — Admin Login (do these 4 steps, in order)

The code for email login + email verification link + admin profile + manage
devices is already live on the site. Firebase itself still needs 4 clicks
from Majid in Firebase Console. Until step 3 is done, the login screen is
UI-only and the data is still open in test mode.

## Step 1 — Turn on Email/Password login
1. Open https://console.firebase.google.com/project/quranic-skills-lms/authentication/providers
2. Click **Email/Password** -> toggle **Enable** -> **Save**.
3. (Optional, recommended) In Authentication -> Templates, check the
   "Email address verification" template sender shows
   `noreply@quranic-skills-lms.firebaseapp.com` — that is the address the
   verification link comes from. No change needed.

## Step 2 — Create the admin account
1. In Firebase Console go to **Authentication -> Users -> Add user**.
2. Email: `majidyzaiii@gmail.com`
3. Password: choose a strong password YOURSELF and remember it.
   Never send it to anyone in chat, email or WhatsApp — not even to Muse.
4. Click **Add user**.

## Step 3 — Lock the database (publish the rules)
1. Open https://console.firebase.google.com/project/quranic-skills-lms/firestore/rules
2. Delete everything in the rules editor and paste the whole contents of
   the file `firestore.rules` from the GitHub repo.
3. Click **Publish**. From now on, only a signed-in admin can read or
   change any data (students, teachers, fees, settings, sessions).

## Step 4 — Sign in on the site
1. Open https://quranic-skills-s-lms-project.vercel.app/
2. Sign in with `majidyzaiii@gmail.com` and the password from step 2.
3. The site shows "Verify your email" — open the inbox, click the
   verification link, then click **"I verified — check again"**.
4. Done — the Admin portal opens. Your name shows as **Majid** (change it
   in Settings -> 8. Admin Profile if you want a different display name).

## If something goes wrong
- **"Email login abhi Firebase Console mein on nahi hai"** -> step 1 is not done yet.
- **"Email ya password ghalat hai"** -> check the email spelling; if the
  password is forgotten, use **Forgot password?** on the login screen.
- **No verification email arrives** -> check Spam; use **Resend verification link**
  (one resend per 60 seconds).
- **Signed out on another device** -> Settings -> 9. Manage Devices lists every
  signed-in device; "Sign out" removes it (takes effect within 5 minutes).
- **Forgot the admin password and the reset email does not arrive** -> create a
  new password from Firebase Console -> Authentication -> Users -> (the user)
  -> Reset password is not available there; use the site's Forgot password
  flow, or delete the user and repeat step 2.

## Notes
- There is NO public signup anywhere: nobody can create an account from the
  site. Only the account created in step 2 can sign in.
- There is NO SMS OTP and NO 6-digit email code: the email verification LINK
  is the second factor Majid chose. Password reset also goes by email link.
- Teacher / Manager / Parent logins are NOT part of this change — the login
  gate covers the whole app for the admin only, for now.
