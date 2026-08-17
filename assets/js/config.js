// ============================================================
// FIREBASE-KONFIGURATION
// Udskift værdierne herunder med dem fra din Firebase Console.
// Denne fil skal IKKE overskrives ved fremtidige opdateringer.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDiOMMD1fwduG7FtOI37hUISSxpHCLqjNk",
  authDomain: "vaegt-8fe24.firebaseapp.com",
  projectId: "vaegt-8fe24",
  storageBucket: "vaegt-8fe24.firebasestorage.app",
  messagingSenderId: "240808747689",
  appId: "1:240808747689:web:6298ad23cdb58b38de7fb8"
};

// Kun denne email har adgang. Ændres du email skal du både opdatere her
// OG i firebase/firestore.rules (og deploye reglerne igen).
export const ALLOWED_EMAIL = "larsmollerchristensen@gmail.com";
