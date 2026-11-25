import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiFilePlus, FiLogOut } from 'react-icons/fi';
import { IconButton } from './CleanUi';
import { useSession } from '../hooks/useSession';

type NavItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'overview' },
  { href: '/dashboard/pastes', label: 'pastes' },
  { href: '/dashboard/users', label: 'users', adminOnly: true },
  { href: '/dashboard/settings', label: 'settings', adminOnly: true },
  { href: '/dashboard/account', label: 'account' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { email, role, signOut } = useSession();
  const isAdmin = role === 'admin';

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="cb-dash">
      <header className="cb-topbar">
        <div className="cb-topbar-inner">
          <Link to="/" className="cb-brand" title="Back to editor">
            cleanbin
          </Link>

          <nav className="cb-nav" aria-label="Dashboard sections">
            {items.map((item) => {
              const active = isActive(location.pathname, item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`cb-nav-link ${active ? 'cb-nav-link--active' : ''}`.trim()}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="cb-topbar-right">
            {email && <span className="cb-whoami" title={email}>{email}</span>}
            <IconButton label="New paste" onClick={() => navigate('/')}>
              <FiFilePlus size={16} />
            </IconButton>
            <IconButton label="Sign out" onClick={() => void handleSignOut()}>
              <FiLogOut size={16} />
            </IconButton>
          </div>
        </div>
      </header>

      <main className="cb-main">{children}</main>
    </div>
  );
}
