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
  appId: "com.grandlivre.bankroll",
  productName: "Grand Livre",
  directories: { output: "C:/Users/Dylan/grand-livre-release" },
  publish: {
    provider: "github",
    owner: "jaysonhugeux1-byte",
    repo: "grind-board",
    releaseType: "release",
  },
  files: ["dist/**/*", "electron/**/*"],
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
