import { StrictMode, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./index.css";
import { api } from "./lib/api.ts";
import Layout, { type User } from "./components/Layout.tsx";
import Login from "./pages/Login.tsx";
import { Spinner } from "./components/ui.tsx";
import { GlobalProvider } from "./lib/global.tsx";

const Overview = lazy(() => import("./pages/Overview.tsx"));
const Mind = lazy(() => import("./pages/Mind.tsx"));
const Seller = lazy(() => import("./pages/Seller.tsx"));
const Radar = lazy(() => import("./pages/Radar.tsx"));
const Lab = lazy(() => import("./pages/Lab.tsx"));
const Cfo = lazy(() => import("./pages/Cfo.tsx"));
const FactoryPage = lazy(() => import("./pages/Factory.tsx"));
const Marketing = lazy(() => import("./pages/Marketing.tsx"));
const Goals = lazy(() => import("./pages/Goals.tsx"));
const Competitors = lazy(() => import("./pages/Competitors.tsx"));
const Imports = lazy(() => import("./pages/Imports.tsx"));
const Routines = lazy(() => import("./pages/Routines.tsx"));
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
    <GlobalProvider>
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout user={state.user} onLogout={logout} />}>
            <Route index element={<Overview />} />
            <Route path="mind" element={<Mind />} />
            <Route path="assistente" element={<Assistant />} />
            <Route path="seller" element={<Seller />} />
            <Route path="anuncios" element={<Listings />} />
            <Route path="radar" element={<Radar />} />
            <Route path="laboratorio" element={<Lab />} />
            <Route path="fabrica" element={<FactoryPage />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="metas" element={<Goals />} />
            <Route path="concorrencia" element={<Competitors />} />
            <Route path="importacao" element={<Imports />} />
            <Route path="rotinas" element={<Routines />} />
            <Route path="rentabilidade" element={<Finance />} />
            <Route path="criar" element={<Studio />} />
            <Route path="pedidos" element={<Orders />} />
            <Route path="perguntas" element={<Questions />} />
            <Route path="estoque" element={<Inventory />} />
            <Route path="financeiro" element={<Cfo />} />
            <Route path="publicidade" element={<Ads />} />
            <Route path="mercado" element={<Market />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="alertas" element={<Alerts />} />
            <Route path="aprovacoes" element={<Approvals />} />
            <Route path="integracoes" element={<Integrations />} />
            <Route path="*" element={<Overview />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
    </GlobalProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
