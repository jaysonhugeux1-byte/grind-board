import React, { useMemo, useRef, useState } from "react";
import { Upload, Loader2, FileSearch, X, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { parseCoinPokerText } from "../lib/parse";
import { importHands } from "../lib/supabaseData";
import { minimum, maximum } from "../lib/grandsTableaux";
import { relierParPlaces, appliquerIdentites } from "../lib/identitesCash";
import { lireObservations, etatObservations } from "../lib/observationsTable";
import { apprendreCashDepuisHistorique } from "../lib/apprentissageAuto";
import { PageHeader, fmtMoney, fmtDate } from "../components/ui";

const CLE_GABARITS = "gl_lecteur_gabarits_v2";
const CLE_OBSERVATIONS = "gl_lecteur_observations";

/**
 * Etiquette les signes que le lecteur n'a pas su nommer, a partir de l'historique.
 *
 * TOUT SE PASSE EN LOCAL, et rien n'est appris quand le rapprochement n'est pas
 * certain : un signe mal etiquette empoisonnerait toutes les lectures suivantes,
 * en silence et definitivement.
 */
function apprendreSignes(mains) {
  try {
    const observations = JSON.parse(localStorage.getItem(CLE_OBSERVATIONS) || "[]");
    if (!Array.isArray(observations) || !observations.length) return null;
    const gabarits = JSON.parse(localStorage.getItem(CLE_GABARITS) || "[]");
    const r = apprendreCashDepuisHistorique(observations, mains, Array.isArray(gabarits) ? gabarits : []);
    if (r.appris > 0) localStorage.setItem(CLE_GABARITS, JSON.stringify(r.gabarits));
    return {
      appris: r.appris, examinees: r.examinees, rejetees: r.rejetees,
      enMemoire: observations.length,
    };
  } catch {
    // L'apprentissage est un bonus : son echec ne doit jamais empecher un import.
    return null;
  }
}

export default function Import() {
  const { user } = useAuth();
  const { hands, entries, refresh } = useData();
  const fileInputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState(null); // { fileName, parsed, newCount, existingCount }
  const [importing, setImporting] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [summary, setSummary] = useState(null); // fiche récapitulative après un import réussi
  const [error, setError] = useState(null);
  const [importProgress, setImportProgress] = useState(0);

  const existingIds = useMemo(() => new Set(hands.map((h) => h.id)), [hands]);

  const dbReport = useMemo(() => {
    if (!hands.length) return null;
    const missingPosition = hands.filter((h) => !h.position).length;
    const missingCards = hands.filter((h) => !h.notation).length;
    return { total: hands.length, missingPosition, missingCards };
  }, [hands]);

  const handleFile = async (file) => {
    setChecking(true);
    setSummary(null);
    setError(null);
    setPreview(null);
    try {
      const text = await file.text();
      const parsed = parseCoinPokerText(text);
      if (!parsed.length) {
        setError("Aucune main reconnue dans ce fichier. Vérifie qu'il s'agit bien d'un export CoinPoker.");
        return;
      }
      // LES VRAIS NOMS, SI LE LECTEUR LES A VUS.
      //
      // L'export anonymise chaque adversaire, avec un alias neuf a chaque main.
      // Le lecteur, lui, a vu leurs noms a l'ecran pendant qu'on jouait. On
      // rapproche les deux ici, avant l'envoi : les fiches d'adversaires se
      // construiront alors sur des identites reelles.
      //
      // CE QUI NE SE RELIE PAS RESTE ANONYME. Une identite mal attribuee
      // verserait les mains d'un joueur dans la fiche d'un autre, sans que rien
      // ne le signale ; un alias intact, lui, sera simplement ecarte faute de
      // volume.
      const vues = lireObservations();
      const lien = vues.length ? relierParPlaces(parsed, vues) : null;
      const mains = lien ? appliquerIdentites(parsed, lien.liens) : parsed;

      // L'APPRENTISSAGE AUTOMATIQUE DES SIGNES.
      //
      // Le lecteur a vu des chiffres qu'il ne savait pas nommer. L'historique,
      // lui, donne ton tapis exact au debut de chaque main — et l'ecran
      // l'affichait en clair au meme moment. Rapprocher les deux etiquette
      // gratuitement ce qui n'avait pas ete lu, sans une seule saisie.
      //
      // Sur une session reelle de 293 mains, cela couvre les dix chiffres, le
      // point et la lettre B : tout ce dont le lecteur a besoin.
      const apprentissage = apprendreSignes(mains);

      const newCount = mains.filter((h) => !existingIds.has(h.id)).length;
      const existingCount = mains.length - newCount;
      setPreview({
        fileName: file.name,
        parsed: mains,
        newCount,
        existingCount,
        identites: lien
          ? { reliees: lien.mainsReliees, total: lien.mainsTotales, taux: lien.tauxLiaison }
          : null,
        apprentissage,
        vues: etatObservations(),
      });
    } catch (e) {
      console.error("Erreur lors de la lecture/analyse du fichier:", e);
      if (e.name === "NotFoundError") {
        setError(
          "Impossible de lire le contenu du fichier. S'il est dans un dossier synchronisé par OneDrive " +
          "(souvent le cas pour Téléchargements), il n'est peut-être pas encore téléchargé sur ton disque " +
          "— clic droit dessus dans l'Explorateur → « Toujours conserver sur cet appareil », puis réessaie. " +
          "Sinon, vérifie qu'il n'est pas ouvert dans un autre programme."
        );
      } else {
        setError("Erreur lors de la lecture du fichier.");
      }
    } finally {
      setChecking(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setImportProgress(0);
    setError(null);
    try {
      const { imported, updated, skipped } = await importHands(user.uid, preview.parsed, {
        forceUpdate,
        existingIds,
        onProgress: setImportProgress,
      });
      const newHands = preview.parsed.filter((h) => !existingIds.has(h.id));
      const netImported = newHands.reduce((a, h) => a + h.net, 0);
      const tsList = preview.parsed.map((h) => h.ts);
      setSummary({
        fileName: preview.fileName,
        total: preview.parsed.length,
        imported,
        updated,
        skipped,
        netImported,
        newCount: newHands.length,
        periodStart: minimum(tsList),
        periodEnd: maximum(tsList),
      });
      // ------------------------------------------------------------------
      // LES RELEVES CONSOMMES SONT OUBLIES
      // ------------------------------------------------------------------
      //
      // L'import du spin le faisait, celui du cash non : les formes relevees par
      // le lecteur s'accumulaient indefiniment. Elles ont deja ete proposees a
      // cet historique — celles qu'il savait nommer l'ont ete, les autres ne le
      // seront jamais par lui. Les garder ne sert a rien et, le tampon etant
      // plafonne, elles CHASSENT les releves de la prochaine session, qui sont
      // les seuls a pouvoir encore apprendre quelque chose.
      try { localStorage.setItem(CLE_OBSERVATIONS, "[]"); } catch { /* stockage */ }

      setPreview(null);
      await refresh();
    } catch (e) {
      console.error("Erreur lors de l'envoi des mains:", e);
      setError("Erreur lors de l'envoi des mains.");
    } finally {
      setImporting(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };



  return (
    <div className="section">
      <PageHeader title="Importer des mains" subtitle="Export texte CoinPoker (.txt)" />

      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {checking ? (
            <>
              <Loader2 size={22} className="spin" />
              <p>Analyse du fichier…</p>
            </>
          ) : (
            <>
              <Upload size={22} />
              <p>Glisse un fichier ici, ou clique pour en choisir un</p>
              <span className="dropzone-hint">Le fichier est d'abord vérifié — rien n'est écrit avant ta confirmation</span>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {preview && (
          <div className="preview-box">
            <div className="preview-header">
              <FileSearch size={16} />
              <span>{preview.fileName}</span>
              <button className="icon-btn" onClick={() => setPreview(null)}><X size={15} /></button>
            </div>
            <div className="preview-stats">
              <span><strong>{preview.parsed.length}</strong> mains dans le fichier</span>
              <span className="win"><strong>{preview.newCount}</strong> nouvelle(s)</span>
              <span className="muted"><strong>{preview.existingCount}</strong> déjà présente(s)</span>
            </div>

            {/* LE RAPPROCHEMENT DES IDENTITES, DIT FRANCHEMENT.
                Un taux affiche vaut mieux qu'une base qu'on croit complete :
                si le lecteur ne tournait pas, ou si les tapis n'ont pas
                concorde, les adversaires resteront anonymes et il faut le
                savoir avant de chercher pourquoi les fiches sont vides. */}
            {preview.identites && (
              <p className="dashboard-hint" style={{ marginTop: 10 }}>
                <strong>{preview.identites.reliees}</strong> main(s) sur{" "}
                {preview.identites.total} ont pu être reliées aux noms vus à table
                {preview.identites.taux != null && ` (${preview.identites.taux.toFixed(0)} %)`}.
                {preview.identites.reliees === 0
                  && " Aucune : les adversaires resteront anonymes. Vérifie que le lecteur"
                     + " tournait pendant la session, et sur les mêmes tables."}
              </p>
            )}
            {/* UN ZERO DOIT SE DIRE, ET DIRE POURQUOI.
                Cette ligne ne s'affichait que lorsqu'un signe au moins avait ete
                appris. Un echec — le cas qu'on cherche a comprendre — ne laissait
                donc AUCUNE trace a l'ecran, et c'est precisement le chiffre qu'on
                regarde pour savoir si le lecteur sert a quelque chose.
                Les trois nombres se lisent ensemble : des releves en memoire mais
                zero examine veut dire que l'historique ne les rattache a aucune
                main ; des releves examines mais rejetes veut dire que le cadre ne
                rend pas le bon nombre de formes. */}
            {preview.apprentissage && (
              <p className="dashboard-hint" style={{ marginTop: 10 }}>
                {preview.apprentissage.appris > 0 ? (
                  <>
                    <strong>{preview.apprentissage.appris} signe(s) appris</strong> automatiquement
                    depuis cet historique — le lecteur lira mieux les prochaines sessions, sans que
                    tu aies rien à taper.
                  </>
                ) : (
                  <>
                    <strong>Aucun signe appris.</strong>{" "}
                    {preview.apprentissage.enMemoire} relevé(s) du lecteur en mémoire,{" "}
                    {preview.apprentissage.examinees} rattaché(s) à une main de cet historique,{" "}
                    {preview.apprentissage.rejetees} écarté(s).{" "}
                    {preview.apprentissage.examinees === 0
                      ? "Aucun relevé ne tombe entre deux mains de ce fichier : vérifie que le lecteur "
                        + "tournait pendant cette session-là."
                      : "Le nombre de formes découpées ne correspond pas au tapis annoncé : "
                        + "le cadre du tapis déborde ou tronque."}
                  </>
                )}
              </p>
            )}
            {!preview.identites && (
              <p className="dashboard-hint" style={{ marginTop: 10 }}>
                Aucun relevé du lecteur en mémoire : les adversaires resteront anonymes,
                comme dans l'export. Lance le lecteur en direct pendant que tu joues pour
                que leurs vrais noms soient rattachés à ces mains.
              </p>
            )}

            <label className="checkbox-row">
              <input type="checkbox" checked={forceUpdate} onChange={(e) => setForceUpdate(e.target.checked)} />
              Forcer la mise à jour des {preview.existingCount} main(s) déjà présente(s)
            </label>

            {importing && (
              <div className="progress-bar-wrap">
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${importProgress}%` }} />
                </div>
                <span className="progress-bar-label mono">{importProgress}%</span>
              </div>
            )}

            <button className="btn-primary" onClick={confirmImport} disabled={importing || (preview.newCount === 0 && !forceUpdate)}>
              {importing ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              {importing ? `Import en cours… ${importProgress}%` : "Confirmer l'import"}
            </button>
          </div>
        )}

        {summary && (
          <div className="import-summary">
            <div className="import-summary-header">
              <CheckCircle2 size={20} className="import-msg-icon" />
              <div className="import-summary-title">
                <strong>Import terminé</strong>
                <span className="card-sub mono">{summary.fileName}</span>
              </div>
              <button className="icon-btn" onClick={() => setSummary(null)}><X size={15} /></button>
            </div>
            <div className="import-summary-stats">
              <div className="import-summary-stat">
                <span className="import-summary-stat-label">Importées</span>
                <span className="import-summary-stat-value win">{summary.imported}</span>
              </div>
              {forceUpdate ? (
                <div className="import-summary-stat">
                  <span className="import-summary-stat-label">Mises à jour</span>
                  <span className="import-summary-stat-value">{summary.updated}</span>
                </div>
              ) : (
                <div className="import-summary-stat">
                  <span className="import-summary-stat-label">Déjà présentes</span>
                  <span className="import-summary-stat-value muted">{summary.skipped}</span>
                </div>
              )}
              <div className="import-summary-stat">
                <span className="import-summary-stat-label">Période du fichier</span>
                <span className="import-summary-stat-value mono">
                  {fmtDate(summary.periodStart)} → {fmtDate(summary.periodEnd)}
                </span>
              </div>
              <div className="import-summary-stat">
                <span className="import-summary-stat-label">Net des nouvelles mains</span>
                <span className={`import-summary-stat-value ${summary.netImported >= 0 ? "win" : "loss"}`}>
                  {summary.newCount ? fmtMoney(summary.netImported) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Vérification de la base</h2>
          <span className="card-sub">détecte les mains déjà importées avec des données incomplètes</span>
        </div>

        {!dbReport ? (
          <p className="muted" style={{ fontSize: 13 }}>Importe des mains pour pouvoir lancer une vérification.</p>
        ) : (
          <div className="db-report">
            <div className="db-report-row"><span>Total des mains en base</span><span className="mono">{dbReport.total}</span></div>
            <div className="db-report-row"><span>Sans position résolue</span><span className={`mono ${dbReport.missingPosition ? "loss" : "win"}`}>{dbReport.missingPosition}</span></div>
            <div className="db-report-row"><span>Sans cartes / notation</span><span className={`mono ${dbReport.missingCards ? "loss" : "win"}`}>{dbReport.missingCards}</span></div>
            {(dbReport.missingPosition > 0 || dbReport.missingCards > 0) && (
              <p className="db-report-hint">
                Ces mains ont été importées avant l'ajout des positions/ranges. Réimporte le(s) fichier(s)
                correspondant(s) avec « Forcer la mise à jour » cochée pour les compléter.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card note-card">
        <h3>Comment récupérer le fichier</h3>
        <p>
          Dans le client CoinPoker, exporte ton historique de mains cash game au format texte, puis dépose le
          fichier <code>.txt</code> ici. Chaque main est identifiée par son numéro : réimporter un fichier qui
          recouvre une période déjà importée ne crée pas de doublons.
        </p>
      </div>

    </div>
  );
}
