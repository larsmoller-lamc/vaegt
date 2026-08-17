# Vægt

Personlig vægt- og aktivitets-tracker med Firebase-backend, låst til din Google-konto.

## Setup — 5 minutter

### 1. Opret Firebase-projekt

1. Gå til [console.firebase.google.com](https://console.firebase.google.com/)
2. **Add project** → navn: `vaegt` (eller genbrug dit eksisterende projekt fra DJ-appen)
3. Slå Google Analytics fra — ikke nødvendigt

### 2. Aktivér Authentication

1. I sidepanelet: **Build → Authentication → Get started**
2. **Sign-in method** → **Google** → aktivér → vælg din projekt-support-email → **Save**

### 3. Aktivér Firestore

1. **Build → Firestore Database → Create database**
2. Vælg location: **eur3 (europe-west)**
3. Start i **production mode**

### 4. Sæt Firestore security rules

Gå til **Firestore → Rules** og indsæt:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                        && request.auth.uid == userId
                        && request.auth.token.email == "larsmollerchristensen@gmail.com";
    }
  }
}
```

**Publish**.

### 5. Registrér din web-app

1. **Project settings** (tandhjul) → **Your apps** → **</>** (web-ikon)
2. Nickname: `vaegt-web` → **Register app**
3. Kopiér `firebaseConfig`-objektet

### 6. Indsæt config i `index.html`

Find denne blok i `index.html` (linje ~700):

```javascript
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  ...
};
```

Udskift med værdierne fra Firebase.

### 7. Tilføj din GitHub Pages-URL i Firebase Auth

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. **Add domain** → `larsmollerchristensen.github.io` (eller hvad du bruger)

### 8. Deploy til GitHub Pages

```bash
git init
git add .
git commit -m "Initial vægt-app"
git remote add origin git@github.com:larsmollerchristensen/vaegt.git
git push -u origin main
```

Enable Pages i repo-settings.

---

## Datamodel

Firestore-struktur:

```
users/
  {uid}/
    entries/
      2026-08-17: { weight: 93.2, activities: { run: true, ... }, score: 6 }
      2026-08-18: { ... }
```

Én dokument pr. dag, dokument-ID er datoen (ISO-format).

## Logik

- **Målkurve**: Start 93.2 kg (17-08-2026), −0.07 kg/dag, floor ved 76 kg
- **Score-zoner**:
  - ≥4 → vægttab-zone (grøn)
  - 3 → hold vægten (gul)
  - ≤2 → tag på-risiko (rød)
- **7-dages snit**: rullende gennemsnit af vægt-målinger

## Withings-integration (senere)

Withings har et REST API. Manuel indtastning nu, automatisk sync kan bygges senere via:
- Withings Developer Portal → OAuth2-app
- En lille Cloud Function der puller vægt-data dagligt og skriver til Firestore

Sig til når du vil have det bygget på.
