import { StrictMode, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./index.css";
import { api } from "./lib/api.ts";
import Layout, { type User } from "./components/Layout.tsx";
import Login from "./pages/Login.tsx";
import { Spinner } from "./components/ui.tsx";

const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Assistant = lazy(() => import("./pages/Assistant.tsx"));
const Listings = lazy(() => import("./pages/Listings.tsx"));
const Studio = lazy(() => import("./pages/Studio.tsx"));
const Orders = lazy(() => import("./pages/Orders.tsx"));
const Questions = lazy(() => import("./pages/Questions.tsx"));
const Inventory = lazy(() => import("./pages/Inventory.tsx"));
const Finance = lazy(() => import("./pages/Finance.tsx"));
const Ads = lazy(() => import("./pages/Ads.tsx"));
const Market = lazy(() => import("./pages/Market.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Alerts = lazy(() => import("./pages/Alerts.tsx"));
const Approvals = lazy(() => import("./pages/Approvals.tsx"));
const Integrations = lazy(() => import("./pages/Integrations.tsx"));

function App() {
  const [state, setState] = useState<{ loading: boolean; user: User | null; needsSetup: boolean }>({ loading: true, user: null, needsSetup: false });
  const refresh = () => api("/auth/status").then((s) => setState({ loading: false, user: s.user, needsSetup: s.needsSetup })).catch(() => setState({ loading: false, user: null, needsSetup: false }));
  useEffect(() => {
    refresh();
    const h = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener("mli:unauthorized", h);
    return () => window.removeEventListener("mli:unauthorized", h);
  }, []);
  if (state.loading) return <Spinner />;
  if (!state.user) return <Login needsSetup={state.needsSetup} onDone={refresh} />;
  const logout = () => api("/auth/logout", { body: {} }).finally(refresh);
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout user={state.user} onLogout={logout} />}>
            <Route index element={<Dashboard />} />
            <Route path="assistente" element={<Assistant />} />
            <Route path="anuncios" element={<Listings />} />
            <Route path="criar" element={<Studio />} />
            <Route path="pedidos" element={<Orders />} />
            <Route path="perguntas" element={<Questions />} />
            <Route path="estoque" element={<Inventory />} />
            <Route path="financeiro" element={<Finance />} />
            <Route path="publicidade" element={<Ads />} />
            <Route path="mercado" element={<Market />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="alertas" element={<Alerts />} />
            <Route path="aprovacoes" element={<Approvals />} />
            <Route path="integracoes" element={<Integrations />} />
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
