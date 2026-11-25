import React, { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { NotificationProvider } from './components/NotificationProvider';
import DashboardShell from './components/DashboardShell';
import { SessionProvider, useSession } from './hooks/useSession';
import EditorPage from './pages/EditorPage';

const PasteViewPage = lazy(() => import('./pages/PasteViewPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const OverviewPage = lazy(() => import('./pages/dashboard/OverviewPage'));
const PastesPage = lazy(() => import('./pages/dashboard/PastesPage'));
const UsersPage = lazy(() => import('./pages/dashboard/UsersPage'));
const SettingsPage = lazy(() => import('./pages/dashboard/SettingsPage'));
const AccountPage = lazy(() => import('./pages/dashboard/AccountPage'));

const isDemo = import.meta.env.VITE_DEMO_MODE === '1';
const DemoBanner = isDemo ? lazy(() => import('./demo/DemoBanner')) : null;

const routeFallback = <div style={{ minHeight: '100vh', background: '#1e1e1e' }} />;

function ProtectedDashboard() {
  const { loading, authenticated } = useSession();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1e1e1e', color: '#666', padding: 24 }}>
        Loading…
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <DashboardShell>
      <Suspense fallback={<div className="cb-empty">Loading…</div>}>
        <Outlet />
      </Suspense>
    </DashboardShell>
  );
}

const Router = isDemo ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <NotificationProvider>
      <SessionProvider>
        <Router>
          <Suspense fallback={routeFallback}>
            <Routes>
              <Route path="/" element={<EditorPage />} />
              <Route path="/clone/:id" element={<EditorPage cloneMode />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />

              <Route path="/dashboard" element={<ProtectedDashboard />}>
                <Route index element={<OverviewPage />} />
                <Route path="pastes" element={<PastesPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="account" element={<AccountPage />} />
              </Route>

              <Route path="/:id" element={<PasteViewPage />} />
            </Routes>
          </Suspense>
          {DemoBanner && (
            <Suspense fallback={null}>
              <DemoBanner />
            </Suspense>
          )}
        </Router>
      </SessionProvider>
    </NotificationProvider>
  );
}
