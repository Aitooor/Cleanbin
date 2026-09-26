import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PageHeadProps, TableColumn } from './types';

// Reusable dashboard primitives. Every style lives in styles/dashboard.css as a
// `.dash-*` class, so components only compose class names.

type CardProps = {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    /** Stagger the entry animation (index * step). */
    animationDelay?: number;
};

export function Card({ title, description, actions, children, className = '', animationDelay }: CardProps) {
    const hasHead = title || description || actions;
    return (
        <section
            className={`dash-card dash-anim ${className}`.trim()}
            style={animationDelay != null ? { animationDelay: `${animationDelay}ms` } : undefined}
        >
            {hasHead && (
                <header className="dash-card-head">
                    <div>
                        {title && <h2 className="dash-card-title">{title}</h2>}
                        {description && <p className="dash-card-desc">{description}</p>}
                    </div>
                    {actions && <div className="dash-row">{actions}</div>}
                </header>
            )}
            {children}
        </section>
    );
}

type StatCardProps = {
    label: string;
    value: ReactNode;
    hint?: string;
    tone?: 'default' | 'accent' | 'permanent' | 'warning';
    animationDelay?: number;
};

export function StatCard({ label, value, hint, tone = 'default', animationDelay }: StatCardProps) {
    const toneClass = tone === 'default' ? '' : `dash-stat--${tone}`;
    return (
        <div
            className={`dash-stat dash-anim ${toneClass}`.trim()}
            style={animationDelay != null ? { animationDelay: `${animationDelay}ms` } : undefined}
        >
            <span className="dash-stat-label">{label}</span>
            <span className="dash-stat-value">{value}</span>
            {hint && <span className="dash-stat-hint">{hint}</span>}
        </div>
    );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-ghost' | 'warning' | 'permanent' | 'ghost';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
    icon?: ReactNode;
    block?: boolean;
};

export function Button({
    variant = 'secondary',
    size = 'md',
    icon,
    block = false,
    children,
    className = '',
    type = 'button',
    ...rest
}: ButtonProps) {
    const classes = [
        'dash-btn',
        variant !== 'secondary' ? `dash-btn--${variant}` : '',
        size === 'sm' ? 'dash-btn--sm' : '',
        block ? 'dash-btn--block' : '',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <button type={type} className={classes} {...rest}>
            {icon}
            {children}
        </button>
    );
}

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Required: icon-only buttons must be announced. */
    label: string;
    tone?: 'default' | 'danger';
    children: ReactNode;
};

export function IconButton({ label, tone = 'default', children, className = '', type = 'button', ...rest }: IconButtonProps) {
    const classes = ['dash-icon-btn', tone === 'danger' ? 'dash-icon-btn--danger' : '', className]
        .filter(Boolean)
        .join(' ');
    return (
        <button type={type} className={classes} aria-label={label} title={label} {...rest}>
            {children}
        </button>
    );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Input({ label, className = '', ...rest }: InputProps) {
    const field = <input className={`dash-input ${className}`.trim()} {...rest} />;
    if (!label) return field;
    return (
        <label className="dash-field">
            <span className="dash-label">{label}</span>
            {field}
        </label>
    );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string };

export function Textarea({ label, className = '', ...rest }: TextareaProps) {
    const field = <textarea className={`dash-textarea ${className}`.trim()} {...rest} />;
    if (!label) return field;
    return (
        <label className="dash-field">
            <span className="dash-label">{label}</span>
            {field}
        </label>
    );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string };

export function Select({ label, className = '', children, ...rest }: SelectProps) {
    const field = (
        <select className={`dash-select ${className}`.trim()} {...rest}>
            {children}
        </select>
    );
    if (!label) return field;
    return (
        <label className="dash-field">
            <span className="dash-label">{label}</span>
            {field}
        </label>
    );
}

type BadgeTone = 'neutral' | 'accent' | 'permanent' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
    const toneClass = tone === 'neutral' ? '' : `dash-badge--${tone}`;
    return <span className={`dash-badge ${toneClass}`.trim()}>{children}</span>;
}

type TableProps<T> = {
    columns: TableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    loadingLabel?: string;
    empty?: ReactNode;
    compact?: boolean;
};

export function Table<T>({
    columns,
    rows,
    rowKey,
    loading = false,
    loadingLabel = 'Loading...',
    empty = null,
    compact = false,
}: TableProps<T>) {
    // Only replace the table with the loading state on the first load. Refreshes
    // keep the current rows visible instead of flashing the loading label.
    if (loading && rows.length === 0) return <LoadingState label={loadingLabel} />;
    if (rows.length === 0) return <>{empty}</>;

    return (
        <div className="dash-table-wrap">
            <table className={`dash-table ${compact ? 'dash-table--compact' : ''}`.trim()}>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th
                                key={column.key}
                                className={column.align === 'right' ? 'dash-align-right' : column.align === 'center' ? 'dash-align-center' : undefined}
                                style={column.width ? { width: column.width } : undefined}
                            >
                                {column.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={rowKey(row)}>
                            {columns.map((column) => (
                                <td
                                    key={column.key}
                                    className={[
                                        column.align === 'right' ? 'dash-align-right' : column.align === 'center' ? 'dash-align-center' : '',
                                        column.className ?? '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    {column.render(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
    return (
        <div className="dash-empty">
            {icon && <div className="dash-empty-icon">{icon}</div>}
            <div className="dash-empty-title">{title}</div>
            {description && <p className="dash-empty-desc">{description}</p>}
            {action && <div style={{ marginTop: 8 }}>{action}</div>}
        </div>
    );
}

export function PageHeader({ title, description, actions }: PageHeadProps) {
    return (
        <header className="dash-page-head">
            <div>
                <h1 className="dash-page-title">{title}</h1>
                {description && <p className="dash-page-desc">{description}</p>}
            </div>
            {actions && <div className="dash-page-actions">{actions}</div>}
        </header>
    );
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
    return (
        <div className="dash-loading" role="status" aria-live="polite">
            <span className="dash-spinner" aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}

export function Callout({ tone = 'default', children }: { tone?: 'default' | 'warning' | 'danger'; children: ReactNode }) {
    const toneClass = tone === 'default' ? '' : `dash-callout--${tone}`;
    return <div className={`dash-callout ${toneClass}`.trim()}>{children}</div>;
}

type ModalProps = {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    wide?: boolean;
};

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div className="dash-modal-backdrop" onClick={onClose}>
            <div
                className={`dash-modal ${wide ? 'dash-modal--wide' : ''}`.trim()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="dash-modal-head">
                    <h2 className="dash-modal-title">{title}</h2>
                    <IconButton label="Close" onClick={onClose}>
                        <span aria-hidden="true">×</span>
                    </IconButton>
                </div>
                {children}
                {footer && <div className="dash-modal-actions">{footer}</div>}
            </div>
        </div>
    );
}
