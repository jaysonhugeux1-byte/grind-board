// Configuration d'empaquetage, avec signature de code optionnelle.
//
// Pourquoi un fichier plutôt que la section « build » du package.json : la
// signature ne doit s'activer QUE si un certificat est disponible. Écrite en
// dur, elle ferait échouer tout build sur une machine qui n'en a pas — celle
// d'un contributeur, ou la nôtre avant l'achat du certificat.
//
// Deux voies sont prévues, et elles s'excluent :
//
//   Azure Artifact Signing (ex-Trusted Signing). Rien à brancher, la clé vit
//   dans un module matériel géré par Microsoft. Environ 10 $ par mois, ouvert
//   aux développeurs individuels.
//
//   Certificat classique OV ou EV sur jeton matériel. Depuis juin 2023 la clé
//   privée DOIT résider sur un support certifié : le fichier .pfx qu'on
//   copiait autrefois n'existe plus pour un certificat publiquement reconnu.
//
// Aucune des deux ne supprime SmartScreen du jour au lendemain, sauf l'EV. Les
// autres construisent une réputation attachée au CERTIFICAT : une fois acquise,
// elle vaut pour toutes les versions suivantes, et l'avertissement disparaît
// définitivement. La peine est donc à payer une fois.

const azure = process.env.AZURE_SIGN_ACCOUNT && process.env.AZURE_SIGN_PROFILE;
const jeton = process.env.CSC_LINK || process.env.WIN_CSC_LINK;

const config = {
  // L'IDENTIFIANT NE SUIT PAS LE RENOMMAGE, et c'est volontaire. NSIS s'en sert
  // pour reconnaitre l'installation deja presente et la mettre a jour. Le
  // changer ferait installer une SECONDE application a cote de l'ancienne :
  // deux entrees au menu Demarrer, deux raccourcis, et la vieille version qui
  // continue de se mettre a jour dans son coin. Le nom affiche se change sans
  // toucher a l'identite du produit.
  appId: "com.grandlivre.bankroll",
  productName: "GrindBoard",
  directories: { output: "C:/Users/Dylan/grindboard-release" },
  publish: {
    provider: "github",
    owner: "jaysonhugeux1-byte",
    repo: "grind-board",
    releaseType: "release",
  },
  files: ["dist/**/*", "electron/**/*"],
  // Nom de fichier sans espace, et ce n'est pas cosmétique.
  //
  // electron-builder écrit dans latest.yml le nom NORMALISÉ de l'installateur,
  // espaces remplacés par des tirets. Si le fichier réellement publié garde ses
  // espaces, GitHub les remplace par des points au dépôt — et la mise à jour
  // automatique va chercher « X-Setup-3.5.0.exe » là où dort un
  // « X.Setup.3.5.0.exe ». Elle reçoit un 404 et se tait, sans que personne ne
  // remarque que plus aucune version ne se propage. C'est ce qui menaçait quand
  // le produit s'appelait « Grand Livre », en deux mots.
  //
  // En produisant directement un nom sans espace, le fichier bâti, le manifeste
  // et l'objet publié portent tous le même, quelle que soit la façon dont on
  // publie. La mise à jour d'une installation existante ne souffre pas du
  // changement de nom : electron-updater lit le nom du fichier DANS le
  // manifeste, il ne le devine pas.
  artifactName: "GrindBoard-Setup-${version}.${ext}",
  win: { target: ["nsis"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
};

if (azure) {
  // Le nom de l'éditeur doit correspondre EXACTEMENT à celui du certificat,
  // sans quoi Windows considère la signature comme ne s'appliquant pas au
  // produit.
  config.win.azureSignOptions = {
    publisherName: process.env.SIGN_PUBLISHER_NAME,
    endpoint: process.env.AZURE_SIGN_ENDPOINT || "https://weu.codesigning.azure.net",
    codeSigningAccountName: process.env.AZURE_SIGN_ACCOUNT,
    certificateProfileName: process.env.AZURE_SIGN_PROFILE,
  };
} else if (jeton) {
  config.win.signtoolOptions = {
    publisherName: process.env.SIGN_PUBLISHER_NAME,
    // L'horodatage est indispensable : sans lui, les binaires deviennent
    // « non signés » le jour où le certificat expire, y compris ceux déjà
    // installés chez les utilisateurs. Avec, la signature reste valable après
    // l'expiration puisqu'on prouve qu'elle a été apposée pendant la validité.
    timeStampServer: process.env.SIGN_TIMESTAMP || "http://timestamp.digicert.com",
  };
}

module.exports = config;
