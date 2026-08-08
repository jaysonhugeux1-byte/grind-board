# Grand Livre — Bankroll Tracker

Site web (React + Firebase) pour suivre ta bankroll de cash game, avec connexion
Google et une base de données accessible depuis n'importe quel appareil.

Pages : Tableau de bord, Importer, Sessions, Bankroll (dépôts/retraits).

---

## 0. Prérequis

- [Node.js](https://nodejs.org/) installé (version 18 ou plus). Pour vérifier :
  ```
  node -v
  ```

---

## 1. Créer le projet Firebase

1. Va sur https://console.firebase.google.com
2. Clique **Ajouter un projet**, donne-lui un nom (ex. `grand-livre`), continue avec les
   options par défaut, puis **Créer le projet**.

---

## 2. Activer la connexion Google

1. Dans le menu de gauche : **Build > Authentication**.
2. Clique **Commencer** (Get started).
3. Onglet **Sign-in method** → clique **Google** → **Activer** → choisis un email
   d'assistance → **Enregistrer**.

---

## 3. Créer la base de données Firestore

1. Menu de gauche : **Build > Firestore Database**.
2. **Créer une base de données**.
3. Choisis l'emplacement (ex. `eur3 (europe-west)` si tu es en France), mode
   **production**.
4. Une fois créée, va dans l'onglet **Règles** et remplace tout le contenu par
   celui du fichier `firestore.rules` fourni dans ce projet, puis **Publier**.
   (Ces règles garantissent que chacun ne peut lire/écrire que ses propres
   données.)

---

## 4. Récupérer la configuration de l'app web

1. Dans **Paramètres du projet** (icône engrenage en haut à gauche) → onglet
   **Général**.
2. Descends jusqu'à **Vos applications**, clique l'icône **`</>`** (Web).
3. Donne un nom à l'app (ex. `grand-livre-web`), **pas** besoin de cocher
   Firebase Hosting pour l'instant, clique **Enregistrer l'application**.
4. Firebase affiche un bloc `firebaseConfig` avec des valeurs comme
   `apiKey`, `authDomain`, etc. Garde cette page ouverte, tu en as besoin à
   l'étape suivante.

---

## 5. Configurer le projet en local

1. Dézippe le projet, ouvre un terminal dedans.
2. Installe les dépendances :
   ```
   npm install
   ```
3. Copie `.env.example` en `.env` :
   ```
   cp .env.example .env
   ```
4. Ouvre `.env` et colle les valeurs récupérées à l'étape 4 :
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

---

## 6. Tester en local

```
npm run dev
```

Ouvre l'adresse affichée (en général `http://localhost:5173`). Tu devrais voir
la page de connexion. Clique **Continuer avec Google** — ça doit fonctionner
directement, `localhost` est autorisé par défaut par Firebase.

---

## 7. Déployer le site en ligne

### Option recommandée : Firebase Hosting (gratuit)

1. Installe l'outil Firebase :
   ```
   npm install -g firebase-tools
   ```
2. Connecte-toi :
   ```
   firebase login
   ```
3. Initialise Hosting dans le dossier du projet :
   ```
   firebase init hosting
   ```
   - Choisis **Use an existing project** → sélectionne ton projet Firebase.
   - Dossier public : `dist`
   - Configurer comme single-page app : **Oui**
   - Ne pas écraser `index.html` si demandé.
4. Construis le site :
   ```
   npm run build
   ```
5. Déploie :
   ```
   firebase deploy
   ```
6. Le terminal affiche une URL du type `https://grand-livre.web.app` — c'est
   ton site en ligne.

### 8. Autoriser le domaine pour la connexion Google

1. Retourne dans **Authentication > Settings > Authorized domains**.
2. Vérifie que le domaine affiché à l'étape 7 (ex. `grand-livre.web.app`) y
   figure — Firebase Hosting l'ajoute normalement tout seul.

---

## Mises à jour futures

Après toute modification du code :
```
npm run build
firebase deploy
```

## Structure des données

- `users/{uid}/hands/{handId}` — une main importée (l'ID de la main sert d'ID
  de document, ce qui évite les doublons même en réimportant un fichier qui
  se chevauche).
- `users/{uid}/entries/{autoId}` — dépôts et retraits manuels.

Chaque utilisateur ne voit que ses propres données (voir `firestore.rules`).
