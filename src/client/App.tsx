import React, { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { NotificationProvider } from './components/NotificationProvider';
import DashboardShell from './components/DashboardShell';
import { SessionProvider, useSession } from './hooks/useSession';
import EditorPage from './pages/EditorPage';
import PasteViewPage from './pages/PasteViewPage';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import OverviewPage from './pages/dashboard/OverviewPage';
import PastesPage from './pages/dashboard/PastesPage';
import UsersPage from './pages/dashboard/UsersPage';
import SettingsPage from './pages/dashboard/SettingsPage';
import AccountPage from './pages/dashboard/AccountPage';

const isDemo = import.meta.env.VITE_DEMO_MODE === '1';
const DemoBanner = isDemo ? lazy(() => import('./demo/DemoBanner')) : null;

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
      <Outlet />
    </DashboardShell>
  );
}

const Router = isDemo ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <NotificationProvider>
      <SessionProvider>
        <Router>
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
