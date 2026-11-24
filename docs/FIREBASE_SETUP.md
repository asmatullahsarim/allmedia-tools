# Firebase setup for All Media Tools

The current free setup supports Firebase Authentication with email/password and Google sign-in, consent-gated Firebase Analytics, and optional Firestore feedback storage. Facebook and Apple sign-in are not enabled in this build. The Firebase web config is public client configuration; never put a service-account key in `web/config.js`.

## 1. Firebase web app and sign-in

1. Create or select a Firebase project in Firebase Console.
2. Add a Web app and copy its `apiKey`, `authDomain`, `projectId`, `appId`, and, if Analytics is enabled, `measurementId` into `web/config.js` under `ALLMEDIA_CONFIG.firebase`.
3. In Authentication → Sign-in method, enable Email/Password and Google.
4. In Authentication → Settings → Authorized domains, add `allmediatool.online` and `www.allmediatool.online`.
5. For email/password, verify the sender/domain settings if you want account verification emails delivered reliably. New accounts receive a verification email.

## 2. Backend token verification and feedback

Create a dedicated service account for this Firebase project in Google Cloud IAM. Grant it only **Cloud Datastore User** (`roles/datastore.user`) so it can read and write Firestore documents; do not use the default Firebase Admin SDK service account key for this deployment. Store the downloaded JSON securely in the hosting provider's environment variables:

- `FIREBASE_PROJECT_ID`: Firebase project ID.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the full service-account JSON as one environment-variable value. Do not commit it or expose it in frontend files.

Enable Cloud Firestore if you want the optional feedback form to save submissions. The backend writes only the feedback message, optional Firebase UID, timestamp, and site source to the `site_feedback` collection.

## 3. Analytics consent

Enable Google Analytics for the Firebase project and add the generated `measurementId` to `web/config.js`. The Analytics SDK is loaded only after the visitor opts in using “Allow anonymous usage analytics”. If the visitor declines, custom analytics events are not sent.

## 4. Current free usage caps

- Guest: AI images 1 per minute / 7 per UTC day; AI chat 5 per minute / 12 per UTC day.
- Signed-in account: AI images 3 per minute / 15 per UTC day; AI chat 10 per minute / 25 per UTC day.

The API checks Firebase ID tokens before granting signed-in caps. When Firebase Admin credentials and Firestore are configured, daily counters and the shared AI allowance are updated transactionally in Firestore, so they survive restarts and multiple instances. Without that server configuration, the site remains guest-only and falls back to process memory; those fallback counters reset when the Render process restarts. Minute counters remain process-local.
