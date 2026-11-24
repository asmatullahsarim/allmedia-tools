// Firebase is opt-in/configured by the site owner in web/config.js.
// No Firebase or Analytics SDK is downloaded until the corresponding feature is configured/consented.
const FIREBASE_VERSION = "13.4.0";
const cfg = window.ALLMEDIA_CONFIG || {};
const firebaseConfig = cfg.firebase || {};
const hasWebConfig = ["apiKey", "authDomain", "projectId", "appId"].every((key) =>
  typeof firebaseConfig[key] === "string" && firebaseConfig[key].trim()
);

let authApi;
let authInstance;
let analyticsApi;
let analyticsInstance;
let appInstance;
const authMessage = document.getElementById("auth-status");
const signOutButton = document.getElementById("sign-out-btn");
const consentCheckbox = document.getElementById("analytics-consent");

function dispatchUser(user) {
  window.dispatchEvent(new CustomEvent("allmedia-auth-changed", {
    detail: { user: user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null },
  }));
  if (signOutButton) signOutButton.classList.toggle("hidden", !user);
}

function firebaseUnavailable() {
  return new Error(hasWebConfig
    ? "Firebase sign-in could not start. Check the Firebase project settings and enabled providers."
    : "Firebase is not configured yet. Add the web app settings in web/config.js.");
}

async function ensureAuth() {
  if (authInstance) return authInstance;
  if (!hasWebConfig) throw firebaseUnavailable();
  const [{ initializeApp, getApps }, auth] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
  ]);
  authApi = auth;
  appInstance = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  authInstance = auth.getAuth(appInstance);
  await auth.setPersistence(authInstance, auth.browserLocalPersistence);
  auth.onAuthStateChanged(authInstance, dispatchUser);
  return authInstance;
}

async function signInWithProvider(name) {
  const auth = await ensureAuth();
  const providers = {
    google: () => new authApi.GoogleAuthProvider(),
    facebook: () => new authApi.FacebookAuthProvider(),
    apple: () => new authApi.OAuthProvider("apple.com"),
  };
  if (!providers[name]) throw new Error("This sign-in provider is not supported.");
  try {
    return await authApi.signInWithPopup(auth, providers[name]());
  } catch (error) {
    if (error.code === "auth/operation-not-allowed") {
      throw new Error(`Enable ${name} sign-in in Firebase Authentication settings first.`);
    }
    if (error.code === "auth/popup-closed-by-user") throw new Error("Sign-in was cancelled.");
    throw new Error(error.message || "Sign-in could not be completed.");
  }
}

async function signInWithEmail(email, password) {
  const auth = await ensureAuth();
  try { return await authApi.signInWithEmailAndPassword(auth, email, password); }
  catch (error) { throw new Error(error.message || "Email and password sign-in failed."); }
}

async function createAccount(email, password) {
  const auth = await ensureAuth();
  try {
    const result = await authApi.createUserWithEmailAndPassword(auth, email, password);
    await authApi.sendEmailVerification(result.user);
    if (authMessage) authMessage.textContent = "Account created. Check your email to verify the address.";
    return result;
  } catch (error) { throw new Error(error.message || "Account could not be created."); }
}

async function signOut() {
  if (!authInstance) return;
  await authApi.signOut(authInstance);
}

async function getIdToken() {
  if (!authInstance) return "";
  const user = authInstance.currentUser;
  return user ? user.getIdToken() : "";
}

async function initializeAnalytics() {
  if (!hasWebConfig || !firebaseConfig.measurementId || analyticsInstance) return;
  const [{ getAnalytics, isSupported, logEvent, setConsent }, app] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-analytics.js`),
    ensureFirebaseApp(),
  ]);
  if (!(await isSupported())) return;
  analyticsApi = { logEvent, setConsent };
  analyticsInstance = getAnalytics(app);
  analyticsApi.setConsent(analyticsInstance, { analytics_storage: "granted" });
}

async function ensureFirebaseApp() {
  if (appInstance) return appInstance;
  if (!hasWebConfig) throw firebaseUnavailable();
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  appInstance = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return appInstance;
}

async function setAnalyticsConsent(granted) {
  const status = document.getElementById("analytics-status");
  try {
    if (!granted) {
      try { localStorage.setItem("amt_analytics_consent", "denied"); } catch (_) {}
      if (analyticsInstance && analyticsApi) analyticsApi.setConsent(analyticsInstance, { analytics_storage: "denied" });
      analyticsInstance = null;
      if (status) status.textContent = "Optional analytics are off.";
      return;
    }
    try { localStorage.setItem("amt_analytics_consent", "granted"); } catch (_) {}
    if (!hasWebConfig || !firebaseConfig.measurementId) {
      if (status) status.textContent = "Add the Firebase web settings and Analytics Measurement ID to activate analytics.";
      return;
    }
    await initializeAnalytics();
    if (status) status.textContent = analyticsInstance ? "Optional analytics are on." : "Analytics is not supported in this browser.";
  } catch (_) {
    if (status && granted) status.textContent = "Analytics could not load; sign-in is still available.";
  }
}

window.AllMediaAuth = {
  signInWithProvider,
  signInWithEmail,
  createAccount,
  signOut,
  getIdToken,
};
window.AllMediaAnalytics = {
  setConsent: setAnalyticsConsent,
  track: (eventName, params = {}) => {
    if (analyticsInstance && analyticsApi) analyticsApi.logEvent(analyticsInstance, eventName, params);
  },
};

if (!hasWebConfig && authMessage) {
  authMessage.textContent = "Firebase project settings are needed to activate sign-in. Email login and Google, Facebook, and Apple are supported when enabled in Firebase.";
}
if (consentCheckbox) {
  let consent = "denied";
  try { consent = localStorage.getItem("amt_analytics_consent") || "denied"; } catch (_) {}
  consentCheckbox.checked = consent === "granted";
  if (consentCheckbox.checked) setAnalyticsConsent(true);
}
