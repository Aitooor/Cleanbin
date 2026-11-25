import React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
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
import AccountPage from './pages/dashboard/AccountPage';

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

export default function App() {
  return (
    <NotificationProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<EditorPage />} />
            <Route path="/clone/:id" element={<EditorPage cloneMode />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />

            <Route path="/dashboard" element={<ProtectedDashboard />}>
              <Route index element={<OverviewPage />} />
              <Route path="pastes" element={<PastesPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="account" element={<AccountPage />} />
            </Route>

            <Route path="/:id" element={<PasteViewPage />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </NotificationProvider>
  );
}
