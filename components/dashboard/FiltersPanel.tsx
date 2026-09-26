import { Button, Input, Select } from './ui';
import type { PasteFilterField, PasteFilterOp, PasteFilterRule, PasteMatchMode } from './types';

type FiltersPanelProps = {
    rules: PasteFilterRule[];
    matchMode: PasteMatchMode;
    onRulesChange: (rules: PasteFilterRule[]) => void;
    onMatchModeChange: (mode: PasteMatchMode) => void;
    onApply: () => void;
    onClear: () => void;
};

const FIELD_LABELS: Record<PasteFilterField, string> = {
    any: 'Any field',
    name: 'Name',
    content: 'Content',
    id: 'UUID',
};

const OP_LABELS: Record<PasteFilterOp, string> = {
    contains: 'contains',
    exact: 'is exactly',
    starts: 'starts with',
    regex: 'matches regex',
};

function emptyRule(): PasteFilterRule {
    return { field: 'any', op: 'contains', value: '', negate: false };
}

function isValidRegex(rule: PasteFilterRule): boolean {
    if (rule.op !== 'regex' || !rule.value) return true;
    try {
        new RegExp(rule.value);
        return true;
    } catch {
        return false;
    }
}

// Advanced filtering panel. Edits plain rules that the API accepts as
// `filterRules` and makes the match mode explicit instead of hiding it behind
// an ambiguous "Normal" toggle.
export default function FiltersPanel({
    rules,
    matchMode,
    onRulesChange,
    onMatchModeChange,
    onApply,
    onClear,
}: FiltersPanelProps) {
    const updateRule = (index: number, patch: Partial<PasteFilterRule>) => {
        onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    };

    const removeRule = (index: number) => {
        onRulesChange(rules.filter((_, i) => i !== index));
    };

    const addRule = () => {
        onRulesChange([...rules, emptyRule()]);
    };

    return (
        <section className="dash-filter-panel" aria-label="Advanced filters">
            <div className="dash-filter-head">
                <span className="dash-label">Match</span>
                <Select
                    value={matchMode}
                    onChange={(event) => onMatchModeChange(event.target.value as PasteMatchMode)}
                    aria-label="Combine filter rules"
                >
                    <option value="AND">All rules (AND)</option>
                    <option value="OR">Any rule (OR)</option>
                </Select>
                <p className="dash-filter-note">
                    “All rules” keeps only pastes that satisfy every rule; “Any rule” keeps pastes that satisfy at least one.
                </p>
            </div>

            {rules.length === 0 && <p className="dash-filter-empty">No rules yet. Add one to narrow the list.</p>}

            {rules.map((rule, index) => {
                const regexInvalid = !isValidRegex(rule);
                return (
                    <div className="dash-filter-rule" key={index}>
                        <Select
                            value={rule.field}
                            onChange={(event) => updateRule(index, { field: event.target.value as PasteFilterField })}
                            aria-label="Field"
                        >
                            {(Object.keys(FIELD_LABELS) as PasteFilterField[]).map((field) => (
                                <option key={field} value={field}>
                                    {FIELD_LABELS[field]}
                                </option>
                            ))}
                        </Select>
                        <Select
                            value={rule.op}
                            onChange={(event) => updateRule(index, { op: event.target.value as PasteFilterOp })}
                            aria-label="Operator"
                        >
                            {(Object.keys(OP_LABELS) as PasteFilterOp[]).map((op) => (
                                <option key={op} value={op}>
                                    {OP_LABELS[op]}
                                </option>
                            ))}
                        </Select>
                        <Input
                            className="dash-grow"
                            placeholder="Value"
                            value={rule.value}
                            onChange={(event) => updateRule(index, { value: event.target.value })}
                            aria-invalid={regexInvalid}
                            aria-label="Filter value"
                        />
                        <label className="dash-filter-negate">
                            <input
                                type="checkbox"
                                className="dash-checkbox"
                                checked={rule.negate}
                                onChange={(event) => updateRule(index, { negate: event.target.checked })}
                            />
                            <span className="dash-muted">Exclude</span>
                        </label>
                        <Button size="sm" variant="ghost" onClick={() => removeRule(index)}>
                            Remove
                        </Button>
                        {regexInvalid && <span className="dash-danger-text">Invalid regex</span>}
                    </div>
                );
            })}

            <div className="dash-filter-actions">
                <Button size="sm" onClick={addRule}>
                    Add rule
                </Button>
                <span className="dash-toolbar-spacer" />
                <Button size="sm" variant="ghost" onClick={onClear}>
                    Clear
                </Button>
                <Button size="sm" variant="primary" onClick={onApply}>
                    Apply filters
                </Button>
            </div>
        </section>
    );
}
