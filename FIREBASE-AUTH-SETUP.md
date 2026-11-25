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
3. Click **Publish**. From now on, only a signed-in user (admin or teacher)
   can read or change any data (students, teachers, fees, settings, sessions).

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
- Manager / Parent logins are NOT built yet — only Admin and Teacher sign in
  so far. Teachers land straight in the Teacher Portal (see step 5).
- Firestore rules still allow ANY signed-in user to read/write — the teacher
  separation is enforced in the app for now (a teacher only ever sees their
  own students). Data-level rules per role are the next hardening step.

## Step 5 — Teacher accounts (one per teacher)

No Firebase Console trip is needed any more — the Admin panel creates the
login account itself. Do this for EACH teacher, one at a time. Start with
one teacher to test.

1. **Add the teacher in the LMS** (Admin login) with the teacher's REAL
   email (their own inbox — the verification and password-reset links go
   there): Teacher Payroll -> **Add Teacher** -> **Gmail / Email Address**
   field -> **Save**. Saving creates the teacher's record in Firestore
   AND creates their Firebase login account in the same step (a secondary
   Auth instance, so the admin stays signed in). The account is created
   with a random password nobody sees or stores, and a verification
   email is sent to the teacher. For a teacher added earlier, open
   Teacher Payroll -> teacher card -> **Edit** -> **Teacher login** section
   -> **Create login account**.
   NOTE: the teacher records currently hold placeholder emails
   (`abdulbasit@quranicskills.com`, `maryam.khan@quranicskills.com`,
   `saad.ahmed@quranicskills.com`) — these are NOT real inboxes. Replace
   each one with the teacher's real email before they sign in.
2. **Teacher verifies their email**: they open the verification email and
   click the link.
3. **Teacher sets their own password**: on the LMS login page they click
   **Forgot password?**, type the same email, and click the reset link
   in the email that arrives — then set their own password. Nobody else
   (not even the admin) ever knows it.
4. **Teacher signs in** on the same login page with that email/password.
   They land straight in the **Teacher Portal** and see ONLY the students
   assigned to them (My Students, Sabaq Logger list, Sabaq history).
   They cannot switch to Admin / Manager / Parent — the portal switcher
   shows only Teacher, and role-switch shortcuts are blocked.
5. **If a teacher sees the Admin dashboard instead**: the email in their
   teacher record does not match the Firebase user email exactly
   (spelling / capital letters). Fix it in Edit Teacher and ask them to
   sign in again — no code change needed.
6. **If the login account was not created** (e.g. the cloud save failed
   when the teacher was added): Edit Teacher -> **Teacher login** section
   shows the status and a **Create login account** button — click it.
   (Fallback, only if the panel route ever fails: create the user by
   hand in Firebase Console -> Authentication -> Users -> Add user with
   the same email; console-created users are auto-verified, so the
   teacher can skip step 2 and go straight to step 3.)

## How the app decides the role

On every render the app looks up the signed-in email in the `teachers`
collection: a match means Teacher (locked to the Teacher Portal, only
their assigned students by `teacherId`, falling back to the
`assignedTeacher` name); no match means Admin (full access + portal
preview switching). The admin account (`majidyzaiii@gmail.com`) has no
teacher record, so it always stays Admin. Admin preview: profile dropdown
-> Teacher opens the first teacher's portal; the **Preview as** picker at
the top of the Teacher Portal (or the **Portal** button on any teacher's
payroll card) switches to any teacher's portal.
