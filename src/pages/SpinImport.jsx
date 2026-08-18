import React, { useMemo, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, Trash2, Calculator } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { PageHeader, fmtDate } from "../components/ui";
import { lireZip } from "../lib/zip";
import {
  parseBetclicSpin, groupTournaments, computeSpinHandEV, looksLikeBetclicSpin,
} from "../lib/betclicSpin";
import { importSpinData, deleteSpinTournaments } from "../lib/supabaseData";
import { apprendreDepuisHistorique, contexteDepuisMains } from "../lib/apprentissageAuto";

const euros = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} €`;

// L'EV se calcule par milliers de tirages sur chaque tapis : sur un import
// complet cela prend une dizaine de secondes. On traite par lots en rendant la
// main au navigateur entre chacun, sinon la fenêtre se fige et Windows la
// déclare « ne répond pas ».
async function calculerEvParLots(mains, onProgress) {
  const LOT = 40;
  for (let i = 0; i < mains.length; i += LOT) {
    for (let j = i; j < Math.min(i + LOT, mains.length); j++) computeSpinHandEV(mains[j]);
    onProgress(Math.round(((i + LOT) / mains.length) * 100));
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress(100);
}

export default function SpinImport() {
  const { user } = useAuth();
  const { tournois, hands, refresh } = useData();
  const fileInputRef = useRef(null);

  const [drag, setDrag] = useState(false);
  const [etape, setEtape] = useState(null); // "lecture" | "ev" | "envoi"
  const [progression, setProgression] = useState(0);
  const [apercu, setApercu] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [nettoyage, setNettoyage] = useState(false);

  const idsTournois = useMemo(() => new Set(tournois.map((t) => t.id)), [tournois]);
  const idsMains = useMemo(() => new Set(hands.map((h) => h.id)), [hands]);

  // Saisies éclair de la période importée : le même tournoi s'y trouve deux
  // fois, une fois à la main et une fois pour de vrai. C'est le doublon qu'il
  // faut proposer de retirer — jamais en silence, l'utilisateur doit voir ce
  // qu'il supprime.
  const doublons = useMemo(() => {
    if (!bilan?.debut) return [];
    return tournois.filter(
      (t) => t.source === "saisie" && t.ts >= bilan.debut - 86400000 && t.ts <= bilan.fin + 86400000
    );
  }, [tournois, bilan]);

  async function lireFichiers(fichiers) {
    setErreur(null);
    setBilan(null);
    setApercu(null);
    setEtape("lecture");
    setProgression(0);

    try {
      const textes = [];
      for (const f of fichiers) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          const extraits = await lireZip(await f.arrayBuffer(), (n) => n.toLowerCase().endsWith(".txt"));
          textes.push(...extraits.map((e) => e.texte));
        } else {
          textes.push(await f.text());
        }
      }

      const texte = textes.join("\n");
      if (!looksLikeBetclicSpin(texte)) {
        setErreur(
          "Aucun historique de spin reconnu. Attendu : l'archive téléchargée depuis Betclic " +
          "(Mon compte → Historique des mains), ou les fichiers .txt qu'elle contient."
        );
        setEtape(null);
        return;
      }

      const mains = parseBetclicSpin(texte);
      if (!mains.length) {
        setErreur("Fichier lisible mais aucune main n'a pu en être extraite.");
        setEtape(null);
        return;
      }

      setEtape("ev");
      await calculerEvParLots(mains, setProgression);

      const tournoisLus = groupTournaments(mains);
      const nouveauxT = tournoisLus.filter((t) => !idsTournois.has(t.id)).length;
      const nouvellesM = mains.filter((h) => !idsMains.has(h.id)).length;
      const avecEv = mains.filter((h) => h.allInStreet).length;

      // L'historique nomme ce que le lecteur d'écran n'a pas su lire. C'est la
      // seule source d'étiquettes exacte : elle couvre tous les signes, y
      // compris ceux qu'on ne croise qu'une fois par mois, et ne se trompe pas.
      let apprentissage = null;
      try {
        const obs = JSON.parse(localStorage.getItem("gl_lecteur_observations") || "[]");
        if (obs.length) {
          const gabarits = JSON.parse(localStorage.getItem("gl_lecteur_gabarits_v2") || "[]");
          const r = apprendreDepuisHistorique(obs, contexteDepuisMains(mains), gabarits);
          if (r.appris.length) {
            localStorage.setItem("gl_lecteur_gabarits_v2", JSON.stringify(r.gabarits));
            // Les observations exploitées ont fait leur office.
            localStorage.setItem("gl_lecteur_observations", "[]");
            apprentissage = r;
          }
        }
      } catch {
        // Un apprentissage raté ne doit jamais empêcher un import.
      }

      setApercu({
        apprentissage,
        fichiers: fichiers.map((f) => f.name),
        mains,
        tournois: tournoisLus,
        nouveauxT,
        nouvellesM,
        avecEv,
        debut: Math.min(...tournoisLus.map((t) => t.ts)),
        fin: Math.max(...tournoisLus.map((t) => t.ts)),
        net: tournoisLus.reduce((s, t) => s + t.net, 0),
        evNet: tournoisLus.reduce((s, t) => s + t.evNet, 0),
      });
    } catch (e) {
      console.error("Lecture de l'historique impossible :", e);
      setErreur(
        e.name === "NotFoundError"
          ? "Impossible de lire le fichier. S'il est dans un dossier synchronisé par OneDrive, " +
            "fais un clic droit dessus dans l'Explorateur → « Toujours conserver sur cet appareil », puis réessaie."
          : e.message || "Erreur pendant la lecture du fichier."
      );
    } finally {
      setEtape((e) => (e === "envoi" ? e : null));
    }
  }

  async function confirmer() {
    if (!apercu) return;
    setEtape("envoi");
    setProgression(0);
    setErreur(null);
    try {
      await importSpinData(user.uid, apercu.tournois, apercu.mains, { onProgress: setProgression });
      setBilan({
        apprentissage: apercu.apprentissage,
        tournois: apercu.tournois.length,
        mains: apercu.mains.length,
        nouveauxT: apercu.nouveauxT,
        nouvellesM: apercu.nouvellesM,
        avecEv: apercu.avecEv,
        net: apercu.net,
        evNet: apercu.evNet,
        debut: apercu.debut,
        fin: apercu.fin,
      });
      setApercu(null);
      await refresh();
    } catch (e) {
      console.error("Import impossible :", e);
      setErreur(e.message || "L'import a échoué.");
    } finally {
      setEtape(null);
    }
  }

  async function retirerDoublons() {
    setNettoyage(true);
    try {
      await deleteSpinTournaments(user.uid, doublons.map((t) => t.id));
      await refresh();
    } catch (e) {
      setErreur(e.message || "Suppression impossible.");
    } finally {
      setNettoyage(false);
    }
  }

  const occupe = etape !== null;
  const libelleEtape =
    etape === "lecture" ? "Lecture du fichier…"
    : etape === "ev" ? "Calcul de l'EV all-in…"
    : etape === "envoi" ? "Envoi…"
    : null;

  return (
    <div className="section">
      <PageHeader
        title="Importer des spins"
        subtitle="L'archive téléchargée depuis Betclic, ou les fichiers .txt qu'elle contient"
      />

      <div className="card">
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onClick={() => !occupe && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!occupe && e.dataTransfer.files.length) lireFichiers([...e.dataTransfer.files]);
          }}
        >
          {occupe ? (
            <>
              <Loader2 size={22} className="spin" />
              <p>{libelleEtape}</p>
            </>
          ) : (
            <>
              <Upload size={22} />
              <p>Dépose ton archive Betclic ici, ou clique pour la choisir</p>
              <p className="dropzone-hint">
                Fichiers .zip ou .txt — plusieurs à la fois si besoin
              </p>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.zip"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files.length) lireFichiers([...e.target.files]);
            e.target.value = "";
          }}
        />

        {occupe && (etape === "ev" || etape === "envoi") && (
          <div className="progress-bar-wrap" style={{ marginTop: 14 }}>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progression}%` }} />
            </div>
            <span className="progress-bar-label mono">{progression}%</span>
          </div>
        )}

        {erreur && (
          <p className="alert-error" style={{ marginTop: 14 }}>
            <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            {erreur}
          </p>
        )}
      </div>

      {apercu && (
        <div className="card preview-box">
          <div className="preview-header">
            <strong>{apercu.fichiers.length} fichier(s) lus</strong>
            <span className="card-sub mono">
              {fmtDate(apercu.debut)} → {fmtDate(apercu.fin)}
            </span>
          </div>

          <div className="import-summary-stats" style={{ marginTop: 12 }}>
            <div className="import-summary-stat">
              <span className="import-summary-stat-label">Tournois</span>
              <span className="import-summary-stat-value mono">{apercu.tournois.length}</span>
              <span className="card-sub">{apercu.nouveauxT} nouveaux</span>
            </div>
            <div className="import-summary-stat">
              <span className="import-summary-stat-label">Mains</span>
              <span className="import-summary-stat-value mono">{apercu.mains.length.toLocaleString("fr-FR")}</span>
              <span className="card-sub">{apercu.nouvellesM.toLocaleString("fr-FR")} nouvelles</span>
            </div>
            <div className="import-summary-stat">
              <span className="import-summary-stat-label">Résultat</span>
              <span className={`import-summary-stat-value mono ${apercu.net >= 0 ? "win" : "loss"}`}>
                {euros(apercu.net)}
              </span>
            </div>
            <div className="import-summary-stat">
              <span className="import-summary-stat-label">Sans la chance</span>
              <span className={`import-summary-stat-value mono ${apercu.evNet >= 0 ? "win" : "loss"}`}>
                {euros(apercu.evNet)}
              </span>
              <span className="card-sub">
                <Calculator size={10} style={{ verticalAlign: -1 }} /> {apercu.avecEv} tapis évalués
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn-primary" onClick={confirmer} disabled={occupe}>
              Importer
            </button>
            <button className="btn-secondary" onClick={() => setApercu(null)} disabled={occupe}>
              Annuler
            </button>
          </div>

          {apercu.apprentissage && (
            <p className="alert-info" style={{ marginTop: 14 }}>
              Le lecteur d'écran a appris{" "}
              <strong className="mono">
                {apercu.apprentissage.appris.map(([s]) => s).join(" ")}
              </strong>{" "}
              en rapprochant ce qu'il avait vu de cet historique — sans que tu aies rien à saisir.
              {apercu.apprentissage.rejetees > 0 &&
                ` ${apercu.apprentissage.rejetees} observation(s) écartée(s) : le cadre n'y capturait pas le bon nombre de signes.`}
            </p>
          )}

          {apercu.nouveauxT === 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Tous ces tournois sont déjà connus. Les réimporter les mettra à jour avec les valeurs
              recalculées — utile après une amélioration de l'analyse, inutile sinon.
            </p>
          )}
        </div>
      )}

      {bilan && (
        <div className="card import-summary">
          <div className="import-summary-header">
            <CheckCircle2 size={20} className="import-msg-icon" />
            <div className="import-summary-title">
              <strong>Import terminé</strong>
              <span className="card-sub">
                {bilan.nouveauxT} tournois et {bilan.nouvellesM.toLocaleString("fr-FR")} mains ajoutés,{" "}
                {bilan.avecEv} tapis évalués.
              </span>
            </div>
          </div>
        </div>
      )}

      {doublons.length > 0 && (
        <div className="card note-card">
          <div className="card-title-row">
            <h2>Saisies éclair en double</h2>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 14px" }}>
            {doublons.length} tournoi(s) saisi(s) à la main tombent dans la période que tu viens d'importer.
            L'import contient les mêmes tournois avec le détail des mains, donc ces saisies comptent une
            seconde fois dans tes statistiques. Tu peux les retirer.
          </p>
          <button className="btn-danger" onClick={retirerDoublons} disabled={nettoyage}>
            {nettoyage ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            Retirer les {doublons.length} saisies
          </button>
        </div>
      )}

      <div className="card note-card">
        <div className="card-title-row">
          <h2>Où trouver le fichier</h2>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          Sur Betclic Poker : <strong>Mon compte → Historique des mains</strong>, puis demande l'export.
          Tu reçois une archive contenant un fichier par jour. Betclic n'autorise qu'un téléchargement par
          jour — d'ici là, la saisie éclair du tableau de bord garde ta courbe à jour.
        </p>
      </div>
    </div>
  );
}
