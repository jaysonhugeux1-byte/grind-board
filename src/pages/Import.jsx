import React, { useMemo, useRef, useState } from "react";
import { Upload, Loader2, FileSearch, X, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { parseCoinPokerText } from "../lib/parse";
import { importHands, resetAllData } from "../lib/supabaseData";
import { PageHeader, fmtMoney, fmtDate } from "../components/ui";

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
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetProgress, setResetProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);
  const [resetCounts, setResetCounts] = useState(null); // figé à l'ouverture (les compteurs live baissent pendant la suppression)

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
      const newCount = parsed.filter((h) => !existingIds.has(h.id)).length;
      const existingCount = parsed.length - newCount;
      setPreview({ fileName: file.name, parsed, newCount, existingCount });
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
        periodStart: Math.min(...tsList),
        periodEnd: Math.max(...tsList),
      });
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

  const handleReset = async () => {
    setResetting(true);
    setResetProgress(0);
    setError(null);
    try {
      await resetAllData(user.uid, hands.map((h) => h.id), entries.map((e) => e.id), setResetProgress);
      setConfirmingReset(false);
      setPreview(null);
      setSummary(null);
      await refresh();
    } catch (e) {
      console.error("Erreur lors de la réinitialisation:", e);
      setError("Erreur lors de la réinitialisation.");
    } finally {
      setResetting(false);
    }
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

      <div className="card danger-zone">
        <div className="card-title-row">
          <h2>Zone dangereuse</h2>
        </div>
        <p className="danger-zone-text">
          Supprime définitivement toutes tes mains, tous tes mouvements (dépôts/retraits/rakeback) et ton
          objectif de challenge. Cette action est irréversible — tu devras réimporter tes fichiers depuis zéro.
        </p>
        <button
          className="btn-danger"
          onClick={() => {
            setResetCounts({ hands: hands.length, entries: entries.length });
            setConfirmingReset(true);
          }}
        >
          <Trash2 size={14} /> Réinitialiser toutes les données
        </button>
      </div>

      {confirmingReset && (
        <div className="modal-overlay" onClick={() => !resetting && setConfirmingReset(false)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><AlertTriangle size={16} className="loss" /> Tout réinitialiser ?</h3>
              <button className="icon-btn" onClick={() => setConfirmingReset(false)} disabled={resetting}><X size={18} /></button>
            </div>
            <p>
              Ça va supprimer définitivement <strong>{resetCounts?.hands ?? hands.length}</strong> main(s) et{" "}
              <strong>{resetCounts?.entries ?? entries.length}</strong> mouvement(s) de bankroll, ainsi que ton
              objectif de challenge. Cette action est irréversible.
            </p>
            {resetting && (
              <div className="progress-bar-wrap">
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${resetProgress}%` }} />
                </div>
                <span className="progress-bar-label mono">{resetProgress}%</span>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmingReset(false)} disabled={resetting}>Annuler</button>
              <button className="btn-danger" onClick={handleReset} disabled={resetting}>
                {resetting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                {resetting ? `Suppression… ${resetProgress}%` : "Tout supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
