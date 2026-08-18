import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { ModeProvider } from "./contexts/ModeContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <SubscriptionProvider>
          <ModeProvider>
            <App />
          </ModeProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
