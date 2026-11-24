// Empty uses the same server. Set an HTTPS API origin for separate hosting.
window.ALLMEDIA_CONFIG = Object.freeze({
  backendUrl: "",
  turnstileSiteKey: "0x4AAAAAAGQex4T2JdIXFm6q",
  // Firebase Console > Project settings > Your apps > Web app config.
  // Enable providers separately in Firebase Authentication. Never put service-account secrets here.
  firebase: Object.freeze({
    apiKey: "AIzaSyC8VmkBAVB8K7o7MQONUEUy0JaN_q82fk0",
    authDomain: "all-media-tools-ec968.firebaseapp.com",
    projectId: "all-media-tools-ec968",
    appId: "1:590810448903:web:f9d434532e555dd00c56a2",
    measurementId: "G-XSJNTNFF7T",
    messagingSenderId: "590810448903",
    storageBucket: "all-media-tools-ec968.firebasestorage.app",
  }),
});
