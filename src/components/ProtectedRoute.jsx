import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="full-page-loader">
        <Loader2 size={22} className="spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return children;
}
