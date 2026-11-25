import React from 'react';
import { Button } from './CleanUi';
import { isSafeRegexPattern } from '../../shared/validation';
import type {
  PasteFilterField,
  PasteFilterOp,
  PasteFilterRule,
  PasteMatchMode,
} from '../../shared/types';

type FiltersBarProps = {
  rules: PasteFilterRule[];
  matchMode: PasteMatchMode;
  onRulesChange: (rules: PasteFilterRule[]) => void;
  onMatchModeChange: (mode: PasteMatchMode) => void;
  onApply: () => void;
  onClear: () => void;
};

const FIELD_LABELS: Record<PasteFilterField, string> = {
  any: 'any field',
  name: 'name',
  content: 'content',
  id: 'uuid',
  owner: 'owner',
};

const OP_LABELS: Record<PasteFilterOp, string> = {
  contains: 'contains',
  exact: 'equals',
  starts: 'starts with',
  regex: 'regex',
};

function emptyRule(): PasteFilterRule {
  return { field: 'any', op: 'contains', value: '', negate: false };
}

export default function FiltersBar({
  rules,
  matchMode,
  onRulesChange,
  onMatchModeChange,
  onApply,
  onClear,
}: FiltersBarProps) {
  const updateRule = (index: number, patch: Partial<PasteFilterRule>) => {
    onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="cb-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="cb-label">Match</span>
        <select
          className="cb-select"
          style={{ width: 'auto' }}
          value={matchMode}
          onChange={(e) => onMatchModeChange(e.target.value as PasteMatchMode)}
        >
          <option value="AND">all rules (AND)</option>
          <option value="OR">any rule (OR)</option>
        </select>
        <span className="cb-section-sub">Combine conditions to narrow down pastes.</span>
      </div>

      {rules.length === 0 && <div className="cb-section-sub">No rules configured yet.</div>}

      {rules.map((rule, idx) => {
        const invalidRegex =
          rule.op === 'regex' && rule.value.trim().length > 0 && !isSafeRegexPattern(rule.value);
        return (
          <div
            key={idx}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <select
              className="cb-select"
              style={{ width: 'auto' }}
              value={rule.field}
              onChange={(e) => updateRule(idx, { field: e.target.value as PasteFilterField })}
            >
              {(Object.keys(FIELD_LABELS) as PasteFilterField[]).map((f) => (
                <option key={f} value={f}>
                  {FIELD_LABELS[f]}
                </option>
              ))}
            </select>

            <select
              className="cb-select"
              style={{ width: 'auto' }}
              value={rule.op}
              onChange={(e) => updateRule(idx, { op: e.target.value as PasteFilterOp })}
            >
              {(Object.keys(OP_LABELS) as PasteFilterOp[]).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>

            <input
              className="cb-input"
              style={{ flex: '1 1 180px' }}
              placeholder="value…"
              value={rule.value}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
            />

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}>
              <input
                type="checkbox"
                className="cb-checkbox"
                checked={rule.negate}
                onChange={(e) => updateRule(idx, { negate: e.target.checked })}
              />
              not
            </label>

            <Button size="sm" onClick={() => removeRule(idx)}>
              remove
            </Button>

            {invalidRegex && (
              <span style={{ fontSize: 11, color: '#e07a7a' }}>invalid or unsafe regex</span>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button size="sm" onClick={() => onRulesChange([...rules, emptyRule()])}>
          + add rule
        </Button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={onClear}>
            clear
          </Button>
          <Button size="sm" variant="primary" onClick={onApply}>
            apply
          </Button>
        </div>
      </div>
    </div>
  );
}
