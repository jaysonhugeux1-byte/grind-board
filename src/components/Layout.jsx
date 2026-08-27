import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Upload, ListOrdered, Wallet, LogOut, Spade, Grid3x3, BarChart3, Flame, Users, LineChart, Search, Settings as SettingsIcon, Zap, Monitor, Waypoints, TrendingUp, Shield, Scale, Layers } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useMode } from "../contexts/ModeContext";
import { useProfil } from "../contexts/ProfilContext";
import { salleDe } from "../lib/salles";
import { useSubscription } from "../contexts/SubscriptionContext";
import { DataProvider } from "../contexts/DataContext";

// `modes` indique dans quels modes l'entrée est visible. Le cash game et le
// spin ne partagent pas les mêmes analyses : le bb/100 n'a aucun sens en
// tournoi, et les ranges d'ouverture y cèdent la place au push/fold.
const NAV_ITEMS = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true, modes: ["cash", "spin"] },
  { to: "/import", label: "Importer", icon: Upload, modes: ["cash", "spin"] },
  { to: "/lecteur", label: "Lecteur en direct", icon: Monitor, modes: ["spin"] },
  { to: "/adversaires", label: "Adversaires", icon: Users, modes: ["cash", "spin"] },
  // « option » marque une entree reservee a une formule : elle reste visible et
  // porte un point tant qu'elle n'est pas accessible.
  { to: "/solveur", label: "Solveur", icon: Scale, modes: ["cash", "spin"], option: "solveur" },
  { to: "/carte-mentale", label: "Carte mentale", icon: Waypoints, modes: ["cash", "spin"] },
  { to: "/projection", label: "Projection", icon: TrendingUp, modes: ["cash", "spin"] },
  { to: "/gestion-bankroll", label: "Gestion de bankroll", icon: Shield, modes: ["cash", "spin"] },
  { to: "/sessions", label: "Sessions", icon: ListOrdered, modes: ["cash"] },
  { to: "/ranges", label: "Ranges", icon: Grid3x3, modes: ["cash"] },
  // L'équivalent spin des ranges, mais il fait plus : il JUGE, parce qu'à
  // tapis court il existe une référence calculable — ce qui n'est pas le cas
  // du cash game profond.
  { to: "/fuites", label: "Chercheur de fuites", icon: Grid3x3, modes: ["spin"] },
  { to: "/ev", label: "EV par position", icon: BarChart3, modes: ["cash"] },
  { to: "/statistics", label: "Statistiques", icon: LineChart, modes: ["cash"] },
  { to: "/stats-hero", label: "Mes spots", icon: Layers, modes: ["cash"] },
  { to: "/search", label: "Recherche de mains", icon: Search, modes: ["cash"] },
  { to: "/top-hands", label: "Grosses mains", icon: Flame, modes: ["cash"] },
  { to: "/table-tendencies", label: "Tendances table", icon: Users, modes: ["cash"] },
  { to: "/bankroll", label: "Bankroll", icon: Wallet, modes: ["cash", "spin"] },
  { to: "/settings", label: "Paramètres", icon: SettingsIcon, modes: ["cash", "spin"] },
];

export default function Layout() {
  const { user, signOutUser } = useAuth();
  const { mode, setMode } = useMode();
  const { profil } = useProfil() || {};
  const salle = salleDe(profil?.salle);
  const { aAcces } = useSubscription();

  const items = NAV_ITEMS.filter((item) => item.modes.includes(mode));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          {/* LA MARQUE DE LA SALLE REMPLACE CELLE DU LOGICIEL. C'est la salle
              qu'on regarde toute la journée : la voir en haut à gauche dit
              d'un coup d'œil sur quoi porte l'écran — et sur quelle base, quand
              on en a deux qui suivent deux salles différentes. */}
          {salle ? (
            <span
              className="brand-mark salle"
              style={{ background: salle.fond, borderColor: salle.bord, color: salle.texte }}
              title={`${salle.nom} — ${salle.formats}`}
            >
              {salle.initiale}
            </span>
          ) : (
            <span className="brand-mark">₮</span>
          )}
          <div>
            <h1>{salle ? salle.nom : "GrindBoard"}</h1>
            <p>{salle ? "GrindBoard" : "Bankroll tracker"}</p>
          </div>
        </div>

        <div className="mode-switch" role="group" aria-label="Mode de jeu">
          <button
            className={mode === "cash" ? "active" : ""}
            onClick={() => setMode("cash")}
            aria-pressed={mode === "cash"}
          >
            <Spade size={13} /> Cash
            {!aAcces("cash") && <span className="mode-lock" title="Abonnement requis">•</span>}
          </button>
          <button
            className={mode === "spin" ? "active" : ""}
            onClick={() => setMode("spin")}
            aria-pressed={mode === "spin"}
          >
            <Zap size={13} /> Spin
            {!aAcces("spin") && <span className="mode-lock" title="Abonnement requis">•</span>}
          </button>
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              <item.icon size={17} />
              {item.label}
              {/* Une option non activée reste VISIBLE et cliquable : la masquer
                  ferait ignorer qu'elle existe, et la page explique elle-même ce
                  qu'elle contient. Le point signale seulement qu'il y a un pas
                  de plus à faire. */}
              {item.option && !aAcces(item.option) && (
                <span className="mode-lock" title="Option à activer">•</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="avatar" />
          ) : (
            <div className="avatar avatar-fallback"><Spade size={14} /></div>
          )}
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.displayName || user?.email}</span>
          </div>
          <button className="icon-btn" onClick={signOutUser} title="Se déconnecter">
            <LogOut size={16} />
          </button>
        </div>
        <p className="sidebar-version">GrindBoard v{__APP_VERSION__}</p>
      </aside>

      <main className="main-content">
        <DataProvider>
          <Outlet />
        </DataProvider>
      </main>
    </div>
  );
}
