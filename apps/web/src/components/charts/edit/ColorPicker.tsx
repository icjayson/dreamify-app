/**
 * ColorPicker — minimal swatch + native color input.
 * Uses HTML5 <input type="color"> for full picker; preset palette for quick choices.
 */
interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  presets?: string[];
}

const DEFAULT_PRESETS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, label, presets = DEFAULT_PRESETS }) => {
  return (
    <div className="space-y-2" data-edit-control>
      {label && <div className="text-xs font-medium opacity-80">{label}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="color"
          value={normalizeToHex(value) || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 rounded border border-input cursor-pointer p-0"
          aria-label={label || 'color'}
        />
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-7 px-2 text-xs rounded border border-input bg-transparent"
          placeholder="#rrggbb or rgb()"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`h-5 w-5 rounded border ${value === p ? 'ring-2 ring-blue-400' : 'border-input'}`}
            style={{ backgroundColor: p }}
            aria-label={`preset ${p}`}
          />
        ))}
      </div>
    </div>
  );
};

function normalizeToHex(v: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^#([0-9a-f]{6})$/i.test(s)) return s;
  if (/^#([0-9a-f]{3})$/i.test(s)) {
    return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  return null;
}

export default ColorPicker;
