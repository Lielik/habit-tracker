# Habits — setup guide

This is a free, installable web app (PWA). It lives on your iPhone home screen
like a real app — full screen, its own icon, works offline — without going
through the App Store (which would cost $99/year). Your data is stored in a
free Firebase account you control, so it syncs across every device you log
into.

Total setup time: about 10 minutes, no credit card required.

## Part 1 — Create your free Firebase project

1. Go to **console.firebase.google.com** and sign in with any Google account.
2. Click **Add project**, give it any name (e.g. "my-habits"), and click through
   the prompts (you can disable Google Analytics, you don't need it). This
   creates a project on the free **Spark plan** — no billing required.
3. In the left sidebar, click **Build → Firestore Database**. Click
   **Create database**, choose any location close to you, and start in
   **production mode**. Click **Enable**.
4. Still in the sidebar, click **Build → Authentication**. Click
   **Get started**, then in the **Sign-in method** tab, click
   **Email/Password**, toggle it **Enabled**, and click **Save**.
5. Click the gear icon (top left, next to "Project Overview") →
   **Project settings**. Scroll to **Your apps**, click the **`</>`** (web)
   icon, give the app any nickname, and click **Register app**. You'll see a
   code block that looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "my-habits-xxxxx.firebaseapp.com",
     projectId: "my-habits-xxxxx",
     storageBucket: "my-habits-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456"
   };
   ```

   Copy those six values.

6. Open **`firebase-config.js`** in this project folder and paste your six
   values in, replacing the placeholder text. Save the file.

## Part 2 — Lock down your data

By default, other people can't read your Firestore data, but let's set an
explicit rule that only lets a logged-in user read/write their own data.

1. In the Firebase console, go to **Firestore Database → Rules**.
2. Replace everything in the box with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

3. Click **Publish**.

## Part 3 — Put the app online (GitHub Pages)

You need the app served over HTTPS for it to install as an app on your
iPhone. GitHub Pages is free and — unlike a one-off drag-and-drop upload —
ties to a permanent account you keep control of.

1. If you don't already have one, create a free account at **github.com**.
2. Create a new repository: click the **+** (top right) → **New repository**.
   Name it `habit-tracker`, set visibility to **Public** (GitHub Pages on
   the free tier needs a public repo), leave "Add a README" unchecked, and
   click **Create repository**.
3. Push this project folder to it. Open a terminal and run:

   ```bash
   cd ~/Desktop/devops/projects/habit_tracker
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/habit-tracker.git
   git push -u origin main
   ```

   Replace `<your-username>` with your GitHub username. If this is the
   first time you're pushing from this machine, GitHub will prompt you to
   authenticate — follow its prompts (browser sign-in or a personal access
   token).

4. On GitHub, open your new repo → **Settings → Pages**. Under **Build and
   deployment → Source**, choose **Deploy from a branch**. Set **Branch**
   to **main** and the folder to **/ (root)**, then click **Save**.
5. Wait about a minute, then refresh that Pages settings page — it'll show
   your live URL: `https://<your-username>.github.io/habit-tracker/`.
   That's your app's address.

## Part 4 — Install it on your iPhone

1. On your iPhone, open **Safari** (must be Safari, not Chrome) and go to
   your GitHub Pages URL.
2. Tap the **Share** button (square with an arrow, bottom of the screen).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. A "Habits" icon now appears on your home screen — open it
   from there (not from Safari) for the full app-like experience.

## Part 5 — Create your account

The first time you open the app, sign up with an email and password of your
choice (this is stored in your own Firebase project — not sent to me or
anyone else). Use that same email/password on any other device to see the
same habits, synced automatically.

## Updating the app laterr

If you ever want to add features or tweak the design, I can update the
files in this same folder — then just commit and push again:

```bash
cd ~/Desktop/devops/projects/habit_tracker
git add .
git commit -m "Update app"
git push
```

GitHub Pages redeploys automatically within a minute or two, and the app
picks up the new version the next time you open it (a small background
refresh via the service worker).

## Notes

- **Cost:** $0. Firebase's Spark plan and GitHub Pages' free tier
  comfortably cover a personal habit tracker — you'd need a genuinely large
  amount of usage to hit any limit.
- **Privacy:** your data lives only in your own Firebase project. Nobody else
  can read it (see the security rule in Part 2).
- **Offline:** the app keeps working without internet — completions save
  locally and sync automatically once you're back online.
