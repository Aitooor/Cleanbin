import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { FiFileText, FiGrid, FiLogOut, FiUser, FiUsers } from 'react-icons/fi';
import { Badge, IconButton } from './ui';
import type { DashboardSession } from './types';

type NavItem = {
    href: string;
    label: string;
    icon: ReactNode;
    adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: <FiGrid /> },
    { href: '/dashboard/pastes', label: 'Pastes', icon: <FiFileText /> },
    { href: '/dashboard/users', label: 'Users', icon: <FiUsers />, adminOnly: true },
    { href: '/dashboard/account', label: 'Account', icon: <FiUser /> },
];

type DashboardLayoutProps = DashboardSession & { children: ReactNode };

function isActive(pathname: string, href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname === href || pathname.startsWith(`${href}/`);
}

// Common shell for every dashboard page: brand, section nav, account and the
// centred content container.
export default function DashboardLayout({ sessionEmail, sessionRole, children }: DashboardLayoutProps) {
    const router = useRouter();
    const isAdmin = sessionRole === 'admin';
    const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

    const handleLogout = () => {
        localStorage.removeItem('authToken');
        document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
        router.push('/login');
    };

    return (
        <div className="dash-root">
            <header className="dash-topbar">
                <div className="dash-topbar-inner">
                    <Link href="/" className="dash-brand">
                        <span className="dash-brand-mark" aria-hidden="true">
                            &gt;_
                        </span>
                        <span>Cleanbin</span>
                    </Link>

                    <nav className="dash-nav" aria-label="Dashboard sections">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`dash-nav-link ${isActive(router.pathname, item.href) ? 'dash-nav-link--active' : ''}`.trim()}
                                aria-current={isActive(router.pathname, item.href) ? 'page' : undefined}
                            >
                                <span aria-hidden="true">{item.icon}</span>
                                {item.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="dash-topbar-account">
                        <span className="dash-user">
                            <FiUser aria-hidden="true" />
                            <span className="dash-user-email">{sessionEmail}</span>
                            <Badge tone={isAdmin ? 'accent' : 'neutral'}>{sessionRole}</Badge>
                        </span>
                        <IconButton label="Sign out" onClick={handleLogout}>
                            <FiLogOut />
                        </IconButton>
                    </div>
                </div>
            </header>

            <main className="dash-content">{children}</main>
        </div>
    );
}
