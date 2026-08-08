import React from "react";

export function StatCard({ label, value, icon, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className={`stat-value ${tone || ""}`}>{value}</div>
    </div>
  );
}

export function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export const fmtMoney = (v, decimals = 2) => {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)} ₮`;
};

export const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
