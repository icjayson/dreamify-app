import { CHART_THEME_COLORS, type ChartPresetTheme } from '@/utils/chartStyling';

interface TemplateColorPreviewProps {
  theme: string;
  className?: string;
}

/**
 * Mini dashboard preview that renders the actual theme colors as a swatch.
 * Shows metric placeholders, a line chart area, and a bar chart area
 * using the theme's CSS color tokens.
 */
const TemplateColorPreview = ({ theme, className = '' }: TemplateColorPreviewProps) => {
  const colors = CHART_THEME_COLORS[theme as ChartPresetTheme] || CHART_THEME_COLORS['default'];
  const bg = colors['bg-dashboard-color'];
  const card = colors['bg-card-color'];
  const border = colors['border-card-color'];
  const title = colors['title-color'];
  const desc = colors['description-color'];
  const highlight = colors['highlight-color'];
  const dataColors = colors['data-colors'];

  return (
    <div
      className={`w-full h-full select-none ${className}`}
      style={{
        backgroundColor: bg,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Metric row — 4 small cards */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: card,
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: '8px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {/* Title placeholder */}
            <div
              style={{
                width: '60%',
                height: 4,
                borderRadius: 2,
                backgroundColor: desc,
                opacity: 0.5,
              }}
            />
            {/* Value placeholder */}
            <div
              style={{
                width: '80%',
                height: 8,
                borderRadius: 2,
                backgroundColor: highlight,
                opacity: 0.8,
              }}
            />
            {/* Trend indicator */}
            <div
              style={{
                width: '40%',
                height: 3,
                borderRadius: 2,
                backgroundColor: dataColors[0],
                opacity: 0.6,
              }}
            />
          </div>
        ))}
      </div>

      {/* Charts row — line chart + bar chart */}
      <div style={{ display: 'flex', gap: '6px', flex: 1, minHeight: 0 }}>
        {/* Line chart area */}
        <div
          style={{
            flex: 2,
            backgroundColor: card,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden',
          }}
        >
          {/* Chart title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ width: '50%', height: 4, borderRadius: 2, backgroundColor: title, opacity: 0.6 }} />
            <div style={{ width: '35%', height: 3, borderRadius: 2, backgroundColor: desc, opacity: 0.3 }} />
          </div>
          {/* SVG line chart mockup */}
          <svg viewBox="0 0 120 40" style={{ width: '100%', flex: 1, marginTop: 4 }} preserveAspectRatio="none">
            <polyline
              points="0,35 15,28 30,30 45,20 60,22 75,12 90,15 105,8 120,10"
              fill="none"
              stroke={dataColors[0]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="0,35 15,28 30,30 45,20 60,22 75,12 90,15 105,8 120,10"
              fill={dataColors[0]}
              fillOpacity="0.1"
              stroke="none"
            />
            {/* Second line */}
            <polyline
              points="0,38 15,33 30,35 45,28 60,30 75,25 90,27 105,22 120,24"
              fill="none"
              stroke={dataColors[1] || dataColors[0]}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            />
          </svg>
        </div>

        {/* Bar chart area */}
        <div
          style={{
            flex: 1,
            backgroundColor: card,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden',
          }}
        >
          {/* Chart title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ width: '65%', height: 4, borderRadius: 2, backgroundColor: title, opacity: 0.6 }} />
            <div style={{ width: '45%', height: 3, borderRadius: 2, backgroundColor: desc, opacity: 0.3 }} />
          </div>
          {/* Bar chart mockup */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 3,
              flex: 1,
              marginTop: 6,
              paddingBottom: 2,
            }}
          >
            {[70, 90, 55, 80, 65].map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  backgroundColor: dataColors[i % dataColors.length],
                  borderRadius: '2px 2px 0 0',
                  opacity: 0.8,
                  minHeight: 4,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateColorPreview;
