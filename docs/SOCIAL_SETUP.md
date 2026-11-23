# Social setup

Turns on the **Social** tab (friends, rooms, weekly scores), lets friends **create their own accounts**, and lets anyone **reset a forgotten password** with a code by email. It's a one-time job in the Supabase dashboard, about 20 minutes. Do the steps in order. Until step 1 is done, the Social tab says *"Social isn't switched on for this site yet"*, and the rest of the app works as before.

Supabase moves its menus around now and then, so labels may differ slightly. This assumes [SUPABASE_SETUP.md](SUPABASE_SETUP.md) is already done (project, tables, the app connected).

## 1. Add the social tables and functions

1. Supabase dashboard → your `gym-tracker` project → **SQL Editor** → **New query**.
2. Open [`supabase/migrations/0002_social.sql`](../supabase/migrations/0002_social.sql) on GitHub (or in the repo), copy all of it, paste it into the editor and click **Run**.
3. It should finish with *"Success. No rows returned"*. It's safe to run again if you're not sure it ran.
4. Check: **Table Editor** now lists `profiles`, `friendships`, `rooms`, `room_members` and `weekly_tallies`.

What it does, in short: usernames live in `profiles` (never an email), friend requests and rooms have their own tables, and each person's weekly score goes in `weekly_tallies`. Your existing workout tables are unchanged and still "own rows only". A friend's workouts are only ever read through a database function that checks you're friends and removes notes first.

## 2. Let friends create accounts

1. **Authentication → Sign In / Providers** → **User Signups**:
   - **Allow new users to sign up**: **on**.
   - **Confirm email**: leave **off**. With it on, a new account doesn't work until its owner clicks a link in an email, and the link opens Safari instead of the installed app.
   - Click **Save changes**.
2. In the app, **Settings → Create an account** asks for an email, a password (8+ characters) and a **username** (3–20 lowercase letters, numbers or `_`; it checks the name is free as you type). The username is how friends find each other.

Anyone with the link can now create an account. They only ever see their own workouts, plus what friends choose to share by accepting a request.

## 3. Send reset codes from Gmail

Supabase's built-in mail only delivers to members of your Supabase organization, a couple an hour, so password reset needs your own sender. A Gmail account works (up to about 500 emails a day).

### Make a Gmail app password

1. Use the Gmail account the codes should come from. It needs **2-Step Verification** on: [myaccount.google.com/security](https://myaccount.google.com/security) → **2-Step Verification**.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), name it `Supabase`, click **Create**, and copy the 16-letter password (the spaces don't matter). You won't see it again; make a new one if you lose it.

### Give it to Supabase

1. **Authentication → Emails → SMTP Settings** (it may say **Set up SMTP**) → turn on **Enable custom SMTP**.
2. Fill in:

   | Field | What to enter |
   |---|---|
   | **Sender email** | the Gmail address |
   | **Sender name** | `Gym Tracker` |
   | **Host** | `smtp.gmail.com` |
   | **Port** | `465` |
   | **Username** | the Gmail address |
   | **Password** | the 16-letter app password |
   | **Minimum interval between emails** | leave the default |

3. **Save changes**.

## 4. Put the code in the reset email

The app asks for a **6-digit code**, not a link (a link would open Safari, not the installed iPhone app).

1. **Authentication → Sign In / Providers → Email** (under Auth Providers): check **Email OTP Length** is `6` and **Email OTP Expiration** is `3600` (an hour). Save if you changed anything.
2. **Authentication → Emails → Templates → Reset Password** (sometimes called *Recovery*).
3. **Subject:** `Your Gym Tracker reset code`
4. **Body:** replace everything with:

   ```html
   <h2>Reset your Gym Tracker password</h2>
   <p>Your code is <strong style="font-size: 20px; letter-spacing: 2px">{{ .Token }}</strong></p>
   <p>Type it into the app under Settings → Account and sync. It works for an hour.</p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```

5. **Save changes**. Leave the other templates as they are.

## 5. Try it

1. Open the app → **Social**. Signed in, it asks you to **pick a username** (your account was made before usernames existed). After that it shows your `@handle`.
2. Sign out → **Sign in → Forgot password?** → enter your email → **Send code**. The email should arrive from your Gmail within a minute (check spam the first time). Enter the code and a new password; it signs you in.
3. Have a friend create an account, then add each other by username on the Social tab. Once they accept, you'll see their week and recent workouts (never their notes). **New room** makes a leaderboard of planned workouts hit this week, which resets every Monday.

## Good to know

- **Scores** are published by each person's own app: when they open Social, and a few seconds after they log anything. A friend who hasn't opened the app since Monday shows `–` until they do.
- **The score** is planned workouts done this week out of planned, e.g. `3/4`. A workout moved to another day still counts; an extra one doesn't put you above someone who hit every planned day. The streak is weeks in a row with every planned workout done.
- **Leaving a room** passes it to whoever joined earliest; the last person out deletes it. Someone only invited isn't shown on the board until they join.
- **Switching accounts on one device:** signing in as someone else clears the previous account's workouts from that device first (they're safe in Supabase). Logs made while signed out join whichever account signs in next.
- **Removing a friend** takes them out of your list both ways; it doesn't remove anyone from rooms you share.
