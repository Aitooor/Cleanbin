import React, { useEffect } from 'react';

type ButtonVariant = 'default' | 'primary' | 'danger' | 'perm';

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  block?: boolean;
}) {
  const classes = [
    'cb-btn',
    variant !== 'default' ? `cb-btn--${variant}` : '',
    size === 'sm' ? 'cb-btn--sm' : '',
    block ? 'cb-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size = 'md',
  danger = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: 'sm' | 'md';
  danger?: boolean;
}) {
  const classes = [
    'cb-icon-btn',
    size === 'sm' ? 'cb-icon-btn--sm' : '',
    danger ? 'cb-icon-btn--danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}

export function Modal({
  title,
  wide = false,
  onClose,
  footer,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cb-backdrop" onClick={onClose}>
      <div
        className={`cb-modal ${wide ? 'cb-modal--wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cb-modal-head">
          <span className="cb-modal-title">{title}</span>
          <IconButton label="Close" size="sm" onClick={onClose}>
            ×
          </IconButton>
        </div>
        {children}
        {footer && <div className="cb-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmRequest & { busy?: boolean; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ whiteSpace: 'pre-line', color: '#888', fontSize: 12 }}>{description}</p>
    </Modal>
  );
}
