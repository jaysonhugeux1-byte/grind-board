import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { ModeProvider } from "./contexts/ModeContext";
import { BaseProvider } from "./contexts/BaseContext";
import { ProfilProvider } from "./contexts/ProfilContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <SubscriptionProvider>
          <ModeProvider>
            {/* La base doit être posée AVANT que le contexte de données ne
                lance sa première requête : elle englobe donc l'application,
                et non l'inverse. */}
            <BaseProvider>
              <ProfilProvider>
                <App />
              </ProfilProvider>
            </BaseProvider>
          </ModeProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
