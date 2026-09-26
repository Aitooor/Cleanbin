import type { ReactNode } from 'react';
import { Button, Modal } from './ui';

type ConfirmTone = 'primary' | 'danger' | 'warning';

// Request object stored by each page while a confirmation is pending. Keeping
// it in one shared type avoids re-declaring the same state shape everywhere.
export type ConfirmRequest = {
    title: string;
    description: ReactNode;
    confirmLabel: string;
    tone?: ConfirmTone;
    onConfirm: () => void;
};

type ConfirmModalProps = ConfirmRequest & {
    busy?: boolean;
    onClose: () => void;
};

// App-styled replacement for window.confirm: same message and consequence, but
// rendered with the dashboard Modal so it matches the rest of the UI.
export default function ConfirmModal({
    title,
    description,
    confirmLabel,
    tone = 'primary',
    busy = false,
    onConfirm,
    onClose,
}: ConfirmModalProps) {
    const confirmVariant = tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'primary';

    return (
        <Modal
            title={title}
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant={confirmVariant} disabled={busy} onClick={onConfirm}>
                        {busy ? 'Working...' : confirmLabel}
                    </Button>
                </>
            }
        >
            <p className="dash-modal-desc dash-confirm-desc">{description}</p>
        </Modal>
    );
}
