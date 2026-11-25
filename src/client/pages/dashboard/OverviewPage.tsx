import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiExternalLink } from 'react-icons/fi';
import { Button, IconButton } from '../../components/CleanUi';
import { useNotification } from '../../components/NotificationProvider';
import { useSession } from '../../hooks/useSession';
import { formatBytes, formatDateTime } from '../../utils/format';
import type { ListedPaste } from '../../../shared/types';

const SAMPLE_SIZE = 1000;

export default function OverviewPage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [pastes, setPastes] = useState<ListedPaste[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [storedBytes, setStoredBytes] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/pastes?page=1&limit=${SAMPLE_SIZE}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => {
        if (!active) return;
        setPastes(Array.isArray(body.items) ? body.items : []);
        setTotal(typeof body.total === 'number' ? body.total : 0);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetch('/api/users')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((list) => {
        if (active) setUsersCount(Array.isArray(list) ? list.length : 0);
      })
      .catch(() => {});
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (active && typeof data?.storage?.storedBytes === 'number') {
          setStoredBytes(data.storage.storedBytes);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const permanentCount = useMemo(() => pastes.filter((p) => p.permanent).length, [pastes]);
  const temporaryCount = pastes.length - permanentCount;
  const recentPastes = useMemo(() => pastes.slice(0, 10), [pastes]);

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(
      () => addNotification('UUID copied'),
      () => addNotification('Could not copy UUID')
    );
  };

  return (
    <>
      <div className="cb-stats">
        <div className="cb-stat">
          <span className="cb-stat-label">total pastes</span>
          <span className="cb-stat-val">{loading ? '—' : total}</span>
        </div>
        <div className="cb-stat">
          <span className="cb-stat-label">permanent</span>
          <span className="cb-stat-val cb-stat-val--perm">{loading ? '—' : permanentCount}</span>
        </div>
        <div className="cb-stat">
          <span className="cb-stat-label">temporary</span>
          <span className="cb-stat-val cb-stat-val--warn">{loading ? '—' : temporaryCount}</span>
        </div>
        {isAdmin && (
          <div className="cb-stat">
            <span className="cb-stat-label">on disk</span>
            <span className="cb-stat-val cb-stat-val--perm">
              {storedBytes !== null ? formatBytes(storedBytes) : '—'}
            </span>
          </div>
        )}
        {isAdmin && (
          <div className="cb-stat">
            <span className="cb-stat-label">accounts</span>
            <span className="cb-stat-val">{usersCount ?? '—'}</span>
          </div>
        )}
      </div>

      <div className="cb-section-head">
        <span className="cb-section-title">recent pastes</span>
        <Button size="sm" onClick={() => navigate('/dashboard/pastes')}>
          view all →
        </Button>
      </div>

      {loading ? (
        <div className="cb-empty">Loading…</div>
      ) : recentPastes.length === 0 ? (
        <div className="cb-empty">No pastes stored yet.</div>
      ) : (
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr>
                <th>name</th>
                <th>uuid</th>
                <th>type</th>
                <th>created</th>
                <th className="cb-right" />
              </tr>
            </thead>
            <tbody>
              {recentPastes.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cb-truncate">{row.name || 'untitled'}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cb-id-btn"
                      title={`Copy ${row.id}`}
                      onClick={() => copyId(row.id)}
                    >
                      {row.id.slice(0, 8)}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`cb-tag ${
                        row.permanent ? 'cb-tag--perm' : row.burnAfterRead ? 'cb-tag--warn' : ''
                      }`}
                    >
                      {row.permanent ? 'perm' : row.burnAfterRead ? '1 read' : 'temp'}
                    </span>
                  </td>
                  <td style={{ color: '#666', whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                  <td className="cb-right">
                    <IconButton
                      label="Open paste"
                      size="sm"
                      onClick={() =>
                        window.open(
                          import.meta.env.VITE_DEMO_MODE === '1'
                            ? `${import.meta.env.BASE_URL}#/${row.id}`
                            : `/${row.id}`,
                          '_blank'
                        )
                      }
                    >
                      <FiExternalLink size={14} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
