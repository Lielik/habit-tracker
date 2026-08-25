# Habits

A free, installable habit tracker for iPhone — built as a Progressive Web App
(PWA) instead of a native App Store app, so there's no $99/year developer fee
and no app review process. It installs to the home screen, works full-screen
and offline, and syncs your data across every device you log into.

**Live app:** https://lielik.github.io/habit-tracker/

## Features

- Email/password accounts with cross-device sync (your data, your own free
  Firebase project — nobody else can read it)
- Three switchable views on the Today screen: a card grid with a mini
  month-heatmap per habit, a list with a mini year-heatmap per habit, and a
  table showing the last 7 days across all habits at once — tap any cell in
  any view to mark a day done
- Simple check-off habits and "count" habits (e.g. "8 glasses of water") with
  a circular dial for logging counts, including on past days
- A full-year, GitHub-style contribution heatmap and a current-month heatmap
  per habit, plus streak and total-completions stats
- 8 built-in accent colors per habit, or any custom color via a color picker
- 8 selectable color themes for the whole app
- Personalization: set your name and it's used in the Today screen's greeting
- Works offline — completions save locally and sync automatically once
  you're back online
- Installs like a real app (own icon, full-screen, no browser chrome) via
  Safari's "Add to Home Screen," and auto-updates itself in the background

## Tech stack

Plain HTML/CSS/JavaScript — no build step, no framework, no bundler.

- **Frontend:** vanilla JS (ES modules), hand-written CSS with CSS custom
  properties for theming, inline SVG icons (no emoji, no icon fonts)
- **Backend:** [Firebase](https://firebase.google.com) Authentication
  (email/password) and Firestore (free Spark plan), loaded via the Firebase
  v10 modular SDK straight from Google's CDN — no `npm install` needed
- **Offline & installability:** a service worker (`service-worker.js`) caches
  the app shell and the Firebase SDK, and actively checks for updates so the
  installed app on your phone stays current
- **Hosting:** [GitHub Pages](https://pages.github.com), free, served over
  HTTPS (required for PWA installation on iOS)

## Project structure

```
habit_tracker/
├── index.html          Markup for all screens (auth, Today, Stats, Settings, modals)
├── style.css            All styling, including the 8 color themes
├── app.js                App logic: auth, Firestore sync, rendering, all views
├── firebase-config.js    Your Firebase project's public config (see setup)
├── manifest.json         PWA metadata (name, icons, colors, display mode)
├── service-worker.js     Offline caching + auto-update logic
├── icons/                App icons in the sizes iOS/PWA installs expect
├── SETUP_GUIDE.md        Step-by-step setup for a new Firebase + GitHub Pages deploy
└── README.md             This file
```

## Setup

This repo is already wired up and deployed. If you're setting up your **own**
copy from scratch (your own Firebase project and your own GitHub Pages URL),
follow **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** — it walks through creating a
free Firebase project, locking down the Firestore security rules, publishing
to GitHub Pages, and installing the app on your iPhone. Total time is about
10 minutes and it costs $0.

## Making changes

There's no build step — just edit `index.html`, `style.css`, or `app.js`
directly and push.

**Every time you deploy a change, bump `CACHE_VERSION` at the top of
`service-worker.js`** (e.g. `"habits-v15"` → `"habits-v16"`). The service
worker uses that string to know a new version exists; without bumping it,
installed phones may keep serving the old cached files.

```bash
cd ~/Desktop/devops/projects/habit_tracker
git add .
git commit -m "Describe your change"
git push
```

GitHub Pages redeploys automatically within a minute or two. The app checks
for updates in the background and reloads itself once the new version is
ready — on iOS, the very first time a new update-check mechanism ships, a
manual force-quit and reopen of the app is needed to pick it up.

## Privacy & cost

Your data lives only in your own Firebase project's Firestore database,
restricted by security rules so only your logged-in account can read or
write it. Firebase's free Spark plan and GitHub Pages' free tier comfortably
cover personal use — there's no cost and no credit card required.
