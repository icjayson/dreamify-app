import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter } from 'recharts';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';

type NormalizedRow = {
  Ad_ID: string;
  Clicks: number;
  Impressions: number;
  Cost: number;
  Leads: number;
  Conversions: number;
  Sale: number;
  AdDate: Date | null;
  AdDateStr: string;
  Keyword: string;
  Device: string;
  Raw: Record<string, any>;
};

// small color palette
const COLORS: string[] = ['#4F46E5', '#06B6D4', '#F97316', '#10B981', '#EF4444', '#8B5CF6'];

// Tiny fallback sample data (string CSV) so the dashboard works out-of-the-box
const SAMPLE_CSV = `Ad_ID,Campaign,Clicks,Impressions,Cost,Leads,Conversions,ConversionRate,Sale_Amount,Ad_Date,Location,Device,Keyword
A1000,DataAnalyt,104,4498,$231.88,14,7,0.058,$1,892,2024-11-01,hyderabad,desktop,learn data analytics
A1001,DataAnalyt,173,5107,$216.84,10,8,0.046,$1,679,2024-11-20,hyderabad,mobile,data analytics course
A1002,DataAnalyt,90,4544,$203.66,26,9,0.059,$1,624,2024-11-06,hyderabad,Desktop,data analytics online
A1003,DataAnalyt,142,3185,$237.66,17,6,0.038,$1,225,2024-11-02,HYDERABA,tablet,data analytics training
A1004,DataAnalyt,156,3361,$195.90,30,8,0.050,$1,091,2024-11-15,hyderabad,desktop,online data analytic`;

const safeNumber = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  try {
    const cleaned = String(v).replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  } catch (_e) {
    return 0;
  }
};

const parseDateSmart = (s: unknown): Date | null => {
  if (!s) return null;
  const d = new Date(String(s));
  if (!isNaN(d.getTime())) return d;
  const parts = String(s).split(/[\/\-.]/).map((p) => p.trim());
  if (parts.length === 3) {
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    const maybe = new Date(year, month, day);
    if (!isNaN(maybe.getTime())) return maybe;
    const maybe2 = new Date(year, day - 1, month + 1);
    if (!isNaN(maybe2.getTime())) return maybe2;
  }
  return new Date();
};

const normalizeRow = (row: Record<string, any>): NormalizedRow => {
  const get = (kCandidates: string[]): any => {
    for (const k of kCandidates) {
      if (row[k] !== undefined) return row[k];
      const found = Object.keys(row).find((rk) => rk.toLowerCase().trim() === k.toLowerCase().trim());
      if (found) return row[found];
    }
    return '';
  };

  const clicks = safeNumber(get(['Clicks', 'clicks']));
  const impressions = safeNumber(get(['Impression', 'Impressions', 'impressions']));
  const cost = safeNumber(get(['Cost', 'cost']));
  const leads = safeNumber(get(['Leads', 'leads']));
  const conversions = safeNumber(get(['Conversions', 'Conversion', 'conversions']));
  const saleAmount = safeNumber(get(['Sale_Amount', 'Sale Amount', 'SaleAmount', 'sale_amount', 'sale']));
  const adDateRaw = get(['Ad_Date', 'AdDate', 'Date', 'ad_date', 'ad date']);
  const adDate = parseDateSmart(adDateRaw);
  const keyword = String(get(['Keyword', 'keyword'])).trim();
  const device = String(get(['Device', 'device'])).trim().toLowerCase();
  const adId = String(get(['Ad_ID', 'AdID', 'ad_id']));

  return {
    Ad_ID: adId,
    Clicks: clicks,
    Impressions: impressions,
    Cost: cost,
    Leads: leads,
    Conversions: conversions,
    Sale: saleAmount,
    AdDate: adDate,
    AdDateStr: adDate ? adDate.toISOString().slice(0, 10) : '',
    Keyword: keyword || '—',
    Device: device || 'unknown',
    Raw: row,
  };
};

export default function HighVisualAdDashboard({ processedData, className = '', style = {} as React.CSSProperties }: { processedData?: any; className?: string; style?: React.CSSProperties }) {
  const [rows, setRows] = useState<NormalizedRow[]>(() => {
    const parsed = Papa.parse(SAMPLE_CSV, { header: true, skipEmptyLines: true });
    return (parsed.data as Record<string, any>[]).map(normalizeRow);
  });

  const [deviceFilter, setDeviceFilter] = useState<string>('all');
  const [keywordFilter, setKeywordFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const onFile = (file: File | undefined) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const cleaned = (results.data as Record<string, any>[]).map(normalizeRow);
        setRows(cleaned);
      },
    });
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (deviceFilter !== 'all' && r.Device.toLowerCase() !== deviceFilter.toLowerCase()) return false;
      if (keywordFilter && !r.Keyword.toLowerCase().includes(keywordFilter.toLowerCase())) return false;
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) {
          if (r.AdDate && r.AdDate < from) return false;
        }
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) {
          if (r.AdDate && r.AdDate > to) return false;
        }
      }
      return true;
    });
  }, [rows, deviceFilter, keywordFilter, dateFrom, dateTo]);

  const metrics = useMemo(() => {
    const totals = {
      impressions: 0,
      clicks: 0,
      cost: 0,
      leads: 0,
      conversions: 0,
      sales: 0,
    };

    const byDate: Record<string, { date: string; clicks: number; conversions: number; sales: number }> = {};
    const byDevice: Record<string, { device: string; clicks: number; sales: number; conversions: number }> = {};
    const byKeyword: Record<string, { keyword: string; clicks: number; conversions: number; sales: number }> = {};

    filtered.forEach((r) => {
      totals.impressions += r.Impressions;
      totals.clicks += r.Clicks;
      totals.cost += r.Cost;
      totals.leads += r.Leads;
      totals.conversions += r.Conversions;
      totals.sales += r.Sale;

      const d = r.AdDateStr || 'unknown';
      if (!byDate[d]) byDate[d] = { date: d, clicks: 0, conversions: 0, sales: 0 };
      byDate[d].clicks += r.Clicks;
      byDate[d].conversions += r.Conversions;
      byDate[d].sales += r.Sale;

      const dv = r.Device || 'unknown';
      if (!byDevice[dv]) byDevice[dv] = { device: dv, clicks: 0, sales: 0, conversions: 0 };
      byDevice[dv].clicks += r.Clicks;
      byDevice[dv].sales += r.Sale;
      byDevice[dv].conversions += r.Conversions;

      const kw = r.Keyword || '—';
      if (!byKeyword[kw]) byKeyword[kw] = { keyword: kw, clicks: 0, conversions: 0, sales: 0 };
      byKeyword[kw].clicks += r.Clicks;
      byKeyword[kw].conversions += r.Conversions;
      byKeyword[kw].sales += r.Sale;
    });

    const dateSeries = Object.values(byDate).sort((a, b) => (a.date > b.date ? 1 : -1));
    const deviceSeries = Object.values(byDevice).sort((a, b) => b.clicks - a.clicks);
    const keywordSeries = Object.values(byKeyword).sort((a, b) => b.sales - a.sales).slice(0, 12);

    const CTR = totals.impressions ? totals.clicks / totals.impressions : 0;
    const CPC = totals.clicks ? totals.cost / totals.clicks : 0;
    const CPA = totals.conversions ? totals.cost / totals.conversions : totals.cost;
    const ROAS = totals.cost ? (totals.cost ? totals.sales / totals.cost : 0) : 0;

    return { totals, CTR, CPC, CPA, ROAS, dateSeries, deviceSeries, keywordSeries };
  }, [filtered]);

  const downloadCSV = () => {
    const header = ['Ad_ID', 'Clicks', 'Impressions', 'Cost', 'Leads', 'Conversions', 'Sale', 'AdDateStr', 'Device', 'Keyword'];
    const lines = [header.join(',')];
    filtered.forEach((r) => {
      const row = [r.Ad_ID, r.Clicks, r.Impressions, r.Cost, r.Leads, r.Conversions, r.Sale, r.AdDateStr, r.Device, `"${r.Keyword.replace(/\\"/g, "'")}"`];
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ad_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const KPI = ({ title, value, suffix = '', small }: { title: string; value: number | string; suffix?: string; small?: boolean }) => (
    <motion.div whileHover={{ y: -4 }} className={`p-4 rounded-2xl shadow-md bg-white ${small ? 'text-sm' : ''}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value} {suffix}</div>
    </motion.div>
  );

  const Funnel = ({ totals }: { totals: { impressions: number; clicks: number; leads: number; conversions: number } }) => {
    const steps = [
      { name: 'Impressions', value: totals.impressions },
      { name: 'Clicks', value: totals.clicks },
      { name: 'Leads', value: totals.leads },
      { name: 'Conversions', value: totals.conversions },
    ];
    const max = Math.max(...steps.map((s) => s.value), 1);
    return (
      <div className="p-4 bg-white rounded-2xl shadow-md">
        <div className="text-sm text-gray-500">Conversion Funnel</div>
        <div className="mt-4 space-y-3">
          {steps.map((s) => (
            <div key={s.name}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <div>{s.name}</div>
                <div>{s.value.toLocaleString()}</div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div style={{ width: `${(s.value / max) * 100}%` }} className={`h-3 rounded-full`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`p-6 min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 ${className}`} style={style}>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Ad Performance — Visual Dashboard</h1>
            <p className="text-sm text-gray-500">Interactive monitoring workspace with animated KPI cards & rich charts</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-white px-3 py-2 rounded-2xl shadow-sm cursor-pointer">
              <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files ? e.target.files[0] : undefined)} className="hidden" />
              <span className="text-sm">Upload CSV</span>
            </label>
            <button onClick={() => { const parsed = Papa.parse(SAMPLE_CSV, { header: true, skipEmptyLines: true }); setRows((parsed.data as Record<string, any>[]).map(normalizeRow)); }} className="px-4 py-2 rounded-2xl bg-white shadow-sm">Load Sample</button>
            <button onClick={downloadCSV} className="px-4 py-2 rounded-2xl bg-indigo-600 text-white flex items-center gap-2"><Download size={16}/> Export</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="p-2 rounded-lg bg-white shadow-inner" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="p-2 rounded-lg bg-white shadow-inner" />
          <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} className="p-2 rounded-lg bg-white shadow-inner">
            <option value="all">All Devices</option>
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="unknown">Unknown</option>
          </select>
          <input placeholder="Search keyword" value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)} className="p-2 rounded-lg bg-white shadow-inner" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KPI title="Total Impressions" value={metrics.totals.impressions} />
          <KPI title="Total Clicks" value={metrics.totals.clicks} />
          <KPI title="Total Cost (USD)" value={metrics.totals.cost} />
          <KPI title="Total Sales (USD)" value={metrics.totals.sales} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="col-span-2 p-4 bg-white rounded-2xl shadow-md">
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm text-gray-500">Trend: Clicks / Conversions / Sales</div>
              <div className="text-xs text-gray-400">Hover points for details — click legend to toggle</div>
            </div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={metrics.dateSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="clicks" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="conversions" stroke={COLORS[1]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="sales" stroke={COLORS[2]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-md">
            <div className="text-sm text-gray-500 mb-3">Device Distribution (Clicks)</div>
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={metrics.deviceSeries} dataKey="clicks" nameKey="device" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {metrics.deviceSeries.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-3 text-xs text-gray-600">
                {metrics.deviceSeries.map((d, i) => (
                  <div key={d.device} className="flex items-center gap-2"><span style={{width:12,height:12,background:COLORS[i%COLORS.length],display:'inline-block',borderRadius:4}} /> {d.device} — {d.clicks.toLocaleString()}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow-md col-span-2">
            <div className="text-sm text-gray-500 mb-2">Top Keywords by Sales</div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={metrics.keywordSeries} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="keyword" width={200} />
                  <Tooltip />
                  <Bar dataKey="sales" fill={COLORS[3]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-md">
            <Funnel totals={metrics.totals} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow-md">
            <div className="text-sm text-gray-500 mb-2">Cost vs Sales (each ad)</div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid />
                  <XAxis type="number" dataKey="Cost" name="Cost" />
                  <YAxis type="number" dataKey="Sale" name="Sales" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter data={filtered.map((r) => ({ Cost: r.Cost, Sale: r.Sale, conversions: r.Conversions, id: r.Ad_ID }))} fill={COLORS[4]} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-md">
            <div className="text-sm text-gray-500 mb-2">Top Raw Rows</div>
            <div className="overflow-auto max-h-72">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs text-gray-500"><th>Ad ID</th><th>Clicks</th><th>Conversions</th><th>Cost</th><th>Sales</th><th>Device</th></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map((r) => (
                    <tr key={r.Ad_ID} className="border-b"><td className="py-2">{r.Ad_ID}</td><td>{r.Clicks}</td><td>{r.Conversions}</td><td>{r.Cost.toLocaleString()}</td><td>{r.Sale.toLocaleString()}</td><td>{r.Device}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-400">Note: This dashboard is a React single-file demo — adjust column mapping and visual preferences to match your real dataset. Consider wiring this into your ETL pipeline for regular refreshes.</div>
      </div>
    </div>
  );
}


