import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Upload, ListOrdered, Wallet, LogOut, Spade, Grid3x3, BarChart3, Flame, Users } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { DataProvider } from "../contexts/DataContext";

const NAV_ITEMS = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/import", label: "Importer", icon: Upload },
  { to: "/sessions", label: "Sessions", icon: ListOrdered },
  { to: "/ranges", label: "Ranges", icon: Grid3x3 },
  { to: "/ev", label: "EV par position", icon: BarChart3 },
  { to: "/top-hands", label: "Grosses mains", icon: Flame },
  { to: "/table-tendencies", label: "Tendances table", icon: Users },
  { to: "/bankroll", label: "Bankroll", icon: Wallet },
];

export default function Layout() {
  const { user, signOutUser } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">₮</span>
          <div>
            <h1>Grand Livre</h1>
            <p>Bankroll tracker</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              <item.icon size={17} />
              {item.label}
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
      </aside>

      <main className="main-content">
        <DataProvider>
          <Outlet />
        </DataProvider>
      </main>
    </div>
  );
}
