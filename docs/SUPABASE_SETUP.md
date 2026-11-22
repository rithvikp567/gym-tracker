# Supabase setup

Turns on sign-in and sync, so your phone and computer share one log. Without it the app still works, but data stays on each device. Takes about 15 minutes. Supabase moves its menus around now and then, so labels may differ slightly.

## 1. Create the project

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) with the account you used for the interior design portal.
2. **Check your free slots.** The free plan allows **2 active projects** per organization. If two are already active, open the one you're not using → **Project Settings → General → Pause project**. Otherwise the form says *"Unable to create project under Free Plan organization"*.
3. Click **New project** and fill in the form from top to bottom:

   | Field | What to enter |
   |---|---|
   | **Organization** | Your existing org. A new one is fine too, and it gets its own 2 free slots. |
   | **GitHub (optional)** | Skip it. That's Supabase's own schema-deploy integration; this app applies SQL by hand in step 2. |
   | **Project name** | `gym-tracker` |
   | **Database password** | Click the **Generate a password** link under the box, then save it (see below). |
   | **Region** | **Americas** or the US region nearest you, e.g. *East US (North Virginia)*. It can't be changed later. |
   | **Data access → Enable Data API** | **Leave ticked.** The app talks to the database through it; without it, sign-in works but nothing syncs. |
   | **Grant API access to new tables automatically** | Either way. The SQL in step 2 grants exactly what the app needs. |
   | **Enable RLS on new tables automatically** | Tick it. It's a safety net for tables added later; step 2 turns RLS on for these tables either way. |
   | **Advanced Configuration → Postgres Type** | Leave **Postgres**. Not OrioleDB, which is beta. This can't be changed later. |

4. Click **Create new project**. Setup takes a minute or two, and the dashboard opens when it's ready.

### The database password

- **What it is:** the password of the `postgres` superuser. It's used only for direct database connections: `psql`, database GUIs, `pg_dump` backups, and the Supabase CLI.
- **The app never uses it.** The website connects with the project URL and the publishable key (step 4), and your sign-in code does the rest.
- **How to make one:** click **Generate a password**. It fills the box with a random password, and the strength bar must reach green before **Create new project** works. Typing your own works too, if it's long and random enough to fill the bar.
- **Save it now.** Click the copy icon at the right of the box and store it in your password manager, e.g. as "Supabase gym-tracker database". The dashboard never shows it again.
- **If you lose it:** reset it from **Database → Settings → Reset database password**, or from the **Connect** dialog. Nothing in this app breaks when you reset it.

## 2. Create the tables

1. Left sidebar → **SQL Editor** (the `>_` icon). A blank query tab opens; if not, click **+** to start a new query.
2. Copy the schema to your clipboard. In Terminal:

   ```bash
   pbcopy < ~/gym-tracker/supabase/migrations/0001_init.sql
   ```

   Or open [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) and copy all of it.
3. Paste it into the editor, then click **Run** (bottom right) or press **⌘ Enter**.
4. A **"Potential issue detected"** dialog appears, saying the query *"includes destructive operations"*. That's expected. The script starts each policy and trigger with a `drop … if exists`, so it can be run again safely; it never deletes tables or data. Click **Run query**.
5. The results panel should say **Success. No rows returned**.
6. Check it worked. Replace the editor text with this and run it:

   ```sql
   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
   ```

   You should get three rows, `sessions`, `splits`, and `workout_days`, each with `rowsecurity` = `true`. In **Table Editor**, none of the three should carry a red **Unrestricted** tag.

What it does: one table per record type, each row tied to your user id. Row-level security means a signed-in user can only read and write their own rows, which is why the public key in the website is safe.

## 3. Sign-in settings (no emails needed)

The app signs in with **email + password**, and Supabase never has to send an email.

- **Why not emailed codes:** Supabase only lets you edit its emails after you set up your own mail server ("Set up custom SMTP to edit templates"). Its built-in sender also only delivers to members of your Supabase organization, a couple of emails an hour.
- **Why not sign-in links:** a link from Mail would open Safari, not the installed iPhone app.

1. If you're on **Authentication → Emails**, leave the templates as they are. Nothing to save there.
2. Go to **Authentication → Sign In / Providers**. In the **User Signups** section at the top:
   - **Allow new users to sign up**: **on** for now. You'll turn it off in step 5, after creating your account.
   - **Confirm email**: **off**. Otherwise Supabase waits for you to click a link before the account works.
   - Leave **Allow manual linking** and **Allow anonymous sign-ins** off.
   - Click **Save changes**.
3. Further down, under **Auth Providers**, **Email** should show as enabled; it's on by default. You don't need to open it. The app asks for at least 8 characters when you create the account.

Skip **URL Configuration** for now. It only matters for emailed links, which the app doesn't use.

## 4. Connect the app

You need two values, and both are safe to put in a public website:

- **Project URL:** `https://<project-ref>.supabase.co`. The project ref is the random-looking ID in your browser's address bar after `/project/` (e.g. `supabase.com/dashboard/project/abcdwxyz…`). It's also shown under **Project Settings → Data API**.
- **Publishable key:** **Project Settings → API Keys** → **Publishable key** (starts with `sb_publishable_`). Use the copy button. If the page only shows **Legacy API keys**, use the `anon` `public` one.

**Never** use a `secret` (`sb_secret_…`) or `service_role` key in the app. Those skip row-level security.

1. Put the two values on your computer. Create `~/gym-tracker/.env.local` with:

   ```bash
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_KEY=sb_publishable_...
   ```

   Vite reloads automatically when this file changes. `.env.local` is git-ignored, so it never reaches GitHub.
2. Put the same two values on GitHub, **after the repo exists**: repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Add `SUPABASE_URL` and `SUPABASE_KEY`. Use **Variables**, not Secrets: they're public values, and the deploy reads `vars.*`. The next deploy picks them up.

## 5. Create your account, then lock sign-ups

1. Open the app (http://localhost:5173) → **Settings**. The **Account and sync** card should now show sign-in fields instead of "Sync isn't set up".
2. Tap **Create an account**, enter your email and a password (8+ characters), and tap **Create account**. Save the password in your password manager or iCloud Keychain.
3. The card should show your email and **Synced at …**. Anything you logged before signing in uploads on this first sync.
4. In Supabase, check:
   - **Authentication → Users** lists your email.
   - **Table Editor → `workout_days`** has a row per workout day, if you've imported or set up days.
5. Lock it: **Authentication → Sign In / Providers → User Signups** → turn **Allow new users to sign up** off → **Save changes**. Signing in still works; only new accounts are blocked. Turn it back on when multi-user (backlog a) ships.

On the phone (once the site is deployed), open it, sign in with the same email and password, then Add to Home Screen.

## Good to know

- **Forgot the password?** You stay signed in on each device, so you only need the password when you sign in on a new one. Keep it in your password manager.
  - **Don't delete your user** to start over: that also deletes your synced data.
  - **To reset it**, run this in the SQL Editor with your email and the new password:

    ```sql
    update auth.users
    set encrypted_password = extensions.crypt('new-password-here', extensions.gen_salt('bf'))
    where email = 'you@example.com';
    ```
- **Free projects pause after 7 days with no activity.** Logging a few times a week keeps yours awake. If it pauses (e.g. on vacation), restore it from the dashboard. The app keeps working offline meanwhile and syncs when the project is back.
- **Before opening it to friends** (backlog a): set up custom SMTP (e.g. Resend's free tier, which needs a domain you own) so Supabase can send confirmation and password-reset emails to anyone. Then turn **Confirm email** back on and set **URL Configuration → Site URL** to `https://rithvikp567.github.io/gym-tracker/`.
- **Limits** (check supabase.com/pricing): 500 MB database, 1 GB file storage, 50k monthly users. Years of logs take a few MB.
