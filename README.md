# Olly’s Outgoings

A simple, installable organiser for UK household bills, subscriptions and insurance. The app runs entirely in the browser by default.

## Run it locally

Use Node.js 20 or later. From the project folder run:

```sh
npm start
```

Open [the local preview](http://localhost:4173/billnest/). Run `npm test` for the calculation, date, backup and calendar tests. The preview binds to this computer. Use the HTTPS Pages address to try it on an iPhone.

## Put it on GitHub Pages

1. Push `main` to [mdelaneycastle/billnest](https://github.com/mdelaneycastle/billnest).
2. In [repository Settings → Pages](https://github.com/mdelaneycastle/billnest/settings/pages), set **Source** to **GitHub Actions**. If the first run started before Pages was enabled, go to **Actions → Deploy Olly’s Outgoings to GitHub Pages → Run workflow**.
3. When deployment succeeds, open the URL in Settings → Pages. The [default Pages URL](https://mdelaneycastle.github.io/billnest/) currently redirects to [marcdelaney.co.uk/billnest/](https://marcdelaney.co.uk/billnest/). Keep HTTPS enabled. The checked-in workflow tests the app and publishes only `dist/`.

The contents of `dist/`, including the supplied portrait, are public site assets. Bill records are created on each visitor’s own device and are excluded from the site and repository. You can also publish `dist/` to another HTTPS static host.

## Install on Olly’s iPhone

1. Open the live HTTPS link in Safari. Tap **Share → Add to Home Screen**, turn on **Open as Web App** if shown, and tap **Add**.
2. Open **Outgoings** from the new icon before entering real bills. If you already entered bills in Safari or on another device, use the backup controls to move them.
3. The example bills disappear when you save a real bill or choose **Start fresh**. The app is available offline after the shell has finished saving on an online visit.

## Phone reminders

- **Use Apple Calendar for the local-first setup.** Edit a bill to choose the lead time, then open the bill and tap **Calendar** by its payment or renewal. The file repeats payments at their billing interval by default. You can also make a renewal repeat annually. Share the file to Mail and open the attachment on the iPhone, or download it to import on a computer with your calendar. Confirm the repeat setting and alert when you save the event. You can also use the dates displayed in the app to create the event and alert manually in Apple Calendar.
- Calendar can alert while Outgoings is closed. Keep Calendar notifications enabled. An imported event is independent of Outgoings, so edit or delete it in Calendar if the bill changes. The event uses a generic title. Your calendar provider may sync it, according to your Calendar settings.
- **Optional direct iPhone push.** The separate [Supabase setup](PUSH.md) enables generic phone alerts with the app closed on supported devices, including iPhone Home Screen apps on iOS 16.4 or later. Supabase Free can pause low-activity projects over a seven-day period, which would stop direct alerts until the project resumes. Calendar alerts are independent of that service. [Supabase pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing)

## How bills and backups work

The monthly figure is annualized active spending divided by 12. Weekly bills use 52 payments per year, quarterly use 4, monthly use 12 and annual use 1. GBP calculations use integer pence. **Upcoming** shows the next recorded dates and flags overdue ones. **Mark paid** advances the payment date one period, clamping short months and preserving the intended billing day. Edit renewal dates when terms change. Archived records are searchable and can be restored.

The app has no sign-in, tracking, analytics or external assets. Its IndexedDB records have no app-level encryption and are accessible to anyone with access to the same browser profile. Protect the phone with its passcode. Data can be lost if the phone is lost or site storage is cleared. **Settings → Download backup** exports a plain-text JSON file with all real records, including archived ones. Store it privately. Import validates the full file and merges by record ID, keeping existing records on a match. Data is tied to the browser profile and site origin. Use backups to move between the local preview, a new URL or another device.

GitHub project sites under the same `mdelaneycastle.github.io` hostname share a browser origin. If you later host other sites there with untrusted scripts, use a dedicated custom hostname for Outgoings and move records with a backup. Anyone with access to change the hosted app can change the code that the browser runs.

## MVP boundaries

- **Documents.** Attachments are deferred. References, contacts and notes are supported. Secure attachments need encrypted storage and a backup/recovery design.
- **Device sync.** The current storage adapter and versioned backup format provide a migration point. For later sync, add authenticated per-household access, row-level security, encrypted private fields and conflict resolution for the local records. The optional push service has a separate schema and does not sync bills.
- **Reminders.** Calendar alerts rely on the settings in the chosen Calendar app. Direct alerts rely on the hosting service, a live subscription, browser and phone settings, and a connection. Test on the actual handset before relying on them.
