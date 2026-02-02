import React from 'react';

interface FilterRule {
    field: 'any' | 'name' | 'content' | 'id';
    op: 'contains' | 'exact' | 'starts' | 'regex';
    value: string;
    permanent?: 'yes' | 'no' | 'any';
}

interface AdvancedFiltersProps {
    advancedFilters: FilterRule[];
    setAdvancedFilters: React.Dispatch<React.SetStateAction<FilterRule[]>>;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    setShowAdvancedFilter: React.Dispatch<React.SetStateAction<boolean>>;
}

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
    advancedFilters,
    setAdvancedFilters,
    setSearchTerm,
    setShowAdvancedFilter,
}) => {
    const updateFilter = (index: number, field: keyof FilterRule, value: any) => {
        const newFilters = [...advancedFilters];
        newFilters[index] = { ...newFilters[index], [field]: value };
        setAdvancedFilters(newFilters);
    };

    const removeFilter = (index: number) => {
        setAdvancedFilters(advancedFilters.filter((_, idx) => idx !== index));
    };

    const addFilter = () => {
        setAdvancedFilters([...advancedFilters, { field: 'any', op: 'contains', value: '', permanent: 'any' }]);
    };

    const applyFilters = () => {
        const filterString = advancedFilters
            .map(f => {
                const prefix = f.field === 'any' ? '' : `${f.field}:`;
                const val = f.value.trim();
                if (!val) return '';
                return `${prefix}${val}`;
            })
            .filter(Boolean)
            .join(', ');
        setSearchTerm(filterString);
        setShowAdvancedFilter(false);
    };

    const clearFilters = () => {
        setAdvancedFilters([{ field: 'any', op: 'contains', value: '', permanent: 'any' }]);
        setSearchTerm('');
        setShowAdvancedFilter(false);
    };

    return (
        <div style={{
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
        }}>
            {advancedFilters.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        value={f.field}
                        onChange={(e) => updateFilter(i, 'field', e.target.value)}
                        style={{ background: '#2a2a2a', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, padding: '4px 8px' }}
                    >
                        <option value="any">Any</option>
                        <option value="name">Name</option>
                        <option value="content">Content</option>
                        <option value="id">ID</option>
                    </select>
                    <select
                        value={f.op}
                        onChange={(e) => updateFilter(i, 'op', e.target.value)}
                        style={{ background: '#2a2a2a', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, padding: '4px 8px' }}
                    >
                        <option value="contains">Contains</option>
                        <option value="exact">Exact</option>
                        <option value="starts">Starts with</option>
                        <option value="regex">Regex</option>
                    </select>
                    <input
                        type="text"
                        placeholder="Value"
                        value={f.value}
                        onChange={(e) => updateFilter(i, 'value', e.target.value)}
                        style={{ background: '#2a2a2a', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, padding: '4px 8px', flex: 1, minWidth: 120 }}
                    />
                    <select
                        value={f.permanent || 'any'}
                        onChange={(e) => updateFilter(i, 'permanent', e.target.value)}
                        style={{ background: '#2a2a2a', color: '#e0e0e0', border: '1px solid #555', borderRadius: 4, padding: '4px 8px' }}
                    >
                        <option value="any">Any</option>
                        <option value="yes">Permanent</option>
                        <option value="no">Temporary</option>
                    </select>
                    {advancedFilters.length > 1 && (
                        <button
                            onClick={() => removeFilter(i)}
                            style={{ background: '#555', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}
                        >
                            Remove
                        </button>
                    )}
                </div>
            ))}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                    onClick={addFilter}
                    style={{ background: '#444', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
                >
                    Add Rule
                </button>
                <button
                    onClick={applyFilters}
                    style={{ background: '#1e88e5', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
                >
                    Apply
                </button>
                <button
                    onClick={clearFilters}
                    style={{ background: '#666', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
                >
                    Clear
                </button>
            </div>
        </div>
    );
};

export default AdvancedFilters;
