# Vægt

Personlig vægt- og aktivitets-tracker med Firebase-backend, låst til én Google-konto.

## Filstruktur

```
vaegt/
├── index.html                    ← markup (kan trygt overskrives)
├── assets/
│   ├── css/styles.css            ← styling (kan trygt overskrives)
│   └── js/
│       ├── app.js                ← al app-logik (kan trygt overskrives)
│       └── config.js             ← ⚠️ DIN Firebase-config (skal IKKE overskrives)
├── firebase/
│   └── firestore.rules           ← ⚠️ security rules (deploy separat, skal IKKE overskrives)
└── README.md
```

**Ved fremtidige opdateringer** overskrives kun `index.html`, `styles.css` og `app.js`. Filerne `config.js` og `firestore.rules` er dine — de rører jeg ikke.

## Score-logik

Max score pr. dag = **10 point**:
- 9 aktivitets-checkboxes (Løb, Fitness, Svømning, Tennis, Gåtur + 4x mad-regler)
- +1 point hvis dagens vægt **≤ dagens målvægt**

Zoner:
- **≥5** → vægttab-zone (grøn)
- **4** → hold vægten (gul)
- **≤3** → risiko for at tage på (rød)

## Målkurve

Start 93,2 kg d. 17-08-2026, −0,07 kg/dag, floor ved 76,0 kg.
Rammer 76 kg omkring 20. april 2027 — derefter fladt.

## Setup — 5 minutter

### 1. Firebase-projekt

1. [console.firebase.google.com](https://console.firebase.google.com/) → **Add project** → navn: `vaegt`
2. Analytics kan slås fra

### 2. Auth

**Build → Authentication → Get started → Sign-in method → Google** → aktivér.

### 3. Firestore

**Build → Firestore Database → Create database** → location `eur3` → production mode.

### 4. Deploy security rules

Åbn `firebase/firestore.rules`, kopiér indholdet, indsæt i **Firestore → Rules → Publish**.

Eller via Firebase CLI:
```bash
firebase deploy --only firestore:rules
```

### 5. Registrér web-app

**Project settings → Your apps → </>** → nickname `vaegt-web` → **Register**.

Kopiér `firebaseConfig`-objektet.

### 6. Sæt config

Åbn `assets/js/config.js` og udskift værdierne. Ret evt. også `ALLOWED_EMAIL` hvis du bruger en anden konto (husk også at ændre den i `firestore.rules`).

### 7. Auth-domæne

**Authentication → Settings → Authorized domains** → tilføj `larsmollerchristensen.github.io`.

### 8. Deploy til GitHub Pages

```bash
git init
git add .
git commit -m "Initial vægt-app"
git remote add origin git@github.com:larsmollerchristensen/vaegt.git
git push -u origin main
```

Enable Pages i repo-settings.

## Datamodel (Firestore)

```
users/
  {uid}/
    entries/
      2026-08-17: {
        weight: 93.2,
        activities: { run: true, fit: false, ... },
        score: 6,
        updatedAt: "2026-08-17T09:12:00Z"
      }
```

Én dokument pr. dag, dokument-ID = ISO-dato.

## Vægt-input

Feltet accepterer både komma og punktum. Ved blur normaliseres visning til dansk format (`93,2`). Værdien lagres altid som float i Firestore.
