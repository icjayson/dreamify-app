import React, { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import { motion } from "framer-motion";
// removed Card components; using plain divs styled with Tailwind
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line, Brush, Treemap } from "recharts";
import { RefreshCw, Download, Search, IndianRupee } from "lucide-react";

// Lightweight number/currency formatters
const n = new Intl.NumberFormat("en-IN");
const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v || 0);

// Utilities
function parseDateStr(d: string) {
  // Handles formats like 04-30-22, 2022-04-30, 30/04/2022
  if (!d) return null as Date | null;
  // try ISO
  const iso = new Date(d);
  if (!isNaN(+iso)) return iso;
  const s = d.replace(/\s.*/, "");
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) {
    const [mm, dd, yy] = s.split("-").map(Number);
    const year = yy + (yy < 50 ? 2000 : 1900);
    return new Date(year, mm - 1, dd);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  }
  return null;
}

function toNum(x: any) {
  if (x === null || x === undefined) return 0;
  const v = typeof x === "number" ? x : parseFloat(String(x).replace(/,/g, ""));
  return isNaN(v) ? 0 : v;
}

function truthy(x: any) {
  if (typeof x === "boolean") return x;
  if (x === null || x === undefined) return false;
  const s = String(x).trim().toLowerCase();
  return !(s === "" || s === "na" || s === "none" || s === "null" || s === "false");
}

export default function AmazonDashboard({ processedData, className = "", style = {} as React.CSSProperties }: { processedData?: any; className?: string; style?: React.CSSProperties }) {
  const [isReady, setIsReady] = useState(false);
  const [raw, setRaw] = useState<any[]>([]);
  const [sampleLoaded, setSampleLoaded] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [fulfillmentSel, setFulfillmentSel] = useState<Set<string>>(new Set());
  const [b2bOnly, setB2bOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [categorySel, setCategorySel] = useState<Set<string>>(new Set());

  // File upload handler
  const handleFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => {
        const rows = (res.data as any[]).map((r) => {
          const date = parseDateStr(r["Date"] || r["order-date"] || r["Purchase Date"]) as any;
          const qty = toNum(r["Qty"] || r["quantity"] || r["quantity-purchased"]);
          const amount = toNum(r["Amount"] || r["item-price"] || r["item-total"] || r["item-amount"]);
          const currency = r["currency"] || r["Currency"] || "INR";
          const status = (r["Status"] || r["order-status"] || "").toString();
          const category = (r["Category"] || r["product-category"] || r["item-category"] || "").toString();
          const sku = (r["SKU"] || r["sku"] || "").toString();
          const style = (r["Style"] || r["product-name"] || r["title"] || "").toString();
          const state = (r["ship-state"] || r["State"] || r["Ship State"] || "").toString();
          const city = (r["ship-city"] || r["City"] || r["Ship City"] || "").toString();
          const orderId = (r["Order ID"] || r["amazon-order-id"] || r["OrderID"] || "").toString();
          const fulfilment = (r["fulfilled-by"] || r["Fulfilment"] || r["fulfillment-channel"] || "").toString();
          const promo = r["promotion-ids"] || r["promotion-id"] || r["promo"] || "";
          const b2b = truthy(r["B2B"] || r["is-business-order"]);
          return { date, qty, amount, currency, status, category, sku, style, state, city, orderId, fulfilment, promo, b2b };
        });
        setRaw(rows.filter((r) => r.date));
      },
    });
  };

  // Provide a small sample to explore layout quickly
  const loadSample = () => {
    if (sampleLoaded) return;
    const today = new Date();
    const mk = (dOff: number, category: string, fulfilment: string, status: string, amount: number, qty = 1, b2b = false) => ({
      date: new Date(+today - dOff * 86400000),
      qty,
      amount,
      currency: "INR",
      status,
      category,
      sku: category.slice(0,3).toUpperCase()+"-"+Math.floor(Math.random()*9999),
      style: category + " Style",
      state: ["Maharashtra","Karnataka","Delhi","Tamil Nadu","Gujarat"][Math.floor(Math.random()*5)],
      city: ["Mumbai","Bengaluru","Delhi","Chennai","Ahmedabad"][Math.floor(Math.random()*5)],
      orderId: "SAMPLE-"+Math.floor(Math.random()*100000),
      fulfilment,
      promo: Math.random() < 0.35 ? "PROMO" : "",
      b2b,
    });
    const demo: any[] = [];
    for (let i=0;i<1200;i++) {
      const cat = ["Kurta","Western Dress","Top","Set","Other"][Math.floor(Math.random()*5)];
      const ful = ["Amazon","Merchant","Easy Ship"][Math.floor(Math.random()*3)];
      const st = Math.random()<0.18?"Cancelled":"Shipped";
      const amt = Math.round(300 + Math.random()*1200);
      const qty = 1 + Math.floor(Math.random()*3);
      const b2b = Math.random()<0.06;
      demo.push(mk(Math.floor(Math.random()*365), cat, ful, st, amt, qty, b2b));
    }
    setRaw(demo);
    setSampleLoaded(true);
  };

  // Auto-load sample data on mount if no data is present
  useEffect(() => {
    if (!sampleLoaded && raw.length === 0) {
      loadSample();
    }
  }, []);

  // Gate initial render with a 4-second delay
  useEffect(() => {
    const timerId = setTimeout(() => setIsReady(true), 4000);
    return () => clearTimeout(timerId);
  }, []);

  // Derive filter domain
  const minDate = useMemo(() => raw.length ? new Date(Math.min(...raw.map(r=>+r.date))) : null, [raw]);
  const maxDate = useMemo(() => raw.length ? new Date(Math.max(...raw.map(r=>+r.date))) : null, [raw]);

  useEffect(() => {
    if (minDate && !dateFrom) setDateFrom(minDate.toISOString().slice(0,10));
    if (maxDate && !dateTo) setDateTo(maxDate.toISOString().slice(0,10));
  }, [minDate, maxDate]);

  // Apply filters
  const filtered = useMemo(() => {
    if (!raw.length) return [] as any[];
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;
    const txt = searchText.trim().toLowerCase();
    return raw.filter(r => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (b2bOnly && !r.b2b) return false;
      if (statusSel.size && !statusSel.has(r.status)) return false;
      if (fulfillmentSel.size && !fulfillmentSel.has(r.fulfilment)) return false;
      if (categorySel.size && !categorySel.has(r.category)) return false;
      if (txt) {
        const target = `${r.sku} ${r.style} ${r.category}`.toLowerCase();
        if (!target.includes(txt)) return false;
      }
      return true;
    });
  }, [raw, dateFrom, dateTo, statusSel, fulfillmentSel, b2bOnly, searchText, categorySel]);

  // Helpers to group
  const by = (arr: any[], key: (x:any)=>string) => arr.reduce((acc, cur) => { const k = key(cur) || "(blank)"; (acc[k] ||= []).push(cur); return acc; }, {} as Record<string, any[]>);
  const uniq = (arr: any[]) => Array.from(new Set(arr));

  // Business metrics (computed on filtered set)
  const metrics = useMemo(() => {
    const totalLines = filtered.length;
    const totalUnits = filtered.reduce((s, r) => s + toNum(r.qty), 0);
    const totalRevenue = filtered.reduce((s, r) => s + toNum(r.amount), 0);
    const shipped = filtered.filter(r => /shipped|delivered/i.test(r.status || ""));
    const cancelled = filtered.filter(r => /cancel/i.test(r.status || ""));
    const shippedRevenue = shipped.reduce((s, r) => s + toNum(r.amount), 0);
    const shippedUnits = shipped.reduce((s, r) => s + toNum(r.qty), 0);

    // Order-level metrics (unique by orderId among the subset)
    const ordersAll = uniq(filtered.map(r => r.orderId)).length;
    const ordersShipped = uniq(shipped.map(r => r.orderId)).length;
    const ordersCancelled = uniq(cancelled.map(r => r.orderId)).length;

    const aov = ordersShipped ? shippedRevenue / ordersShipped : 0;
    const asp = shippedUnits ? shippedRevenue / shippedUnits : 0;
    const uPo = ordersShipped ? shippedUnits / ordersShipped : 0;

    const promoRev = filtered.filter(r => truthy(r.promo)).reduce((s, r) => s + toNum(r.amount), 0);
    const promoPenetration = totalRevenue ? (promoRev / totalRevenue) : 0;

    const b2bRev = filtered.filter(r => r.b2b).reduce((s, r) => s + toNum(r.amount), 0);
    const b2bShare = totalRevenue ? b2bRev / totalRevenue : 0;

    const statusCounts = Object.entries(by(filtered, (r)=>r.status)).map(([k, v]: [string, any[]]) => ({ name: k || "(blank)", value: v.length }));

    const byDayMap = by(shipped, (r)=> new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()).toISOString().slice(0,10));
    const byDay = Object.entries(byDayMap).sort(([a],[b])=> a.localeCompare(b)).map(([d, rows]: [string, any[]]) => {
      const rev = rows.reduce((s: number, r: any)=> s + toNum(r.amount), 0);
      const ids = uniq(rows.map((r: any)=>r.orderId)).length;
      return { date: d, revenue: rev, orders: ids };
    });

    const byCategory = Object.entries(by(shipped, (r)=> r.category)).map(([k, rows]: [string, any[]])=> ({ name: k || "(blank)", value: rows.reduce((s: number,r: any)=> s+toNum(r.amount),0) }));
    const byState = Object.entries(by(shipped, (r)=> r.state)).map(([k, rows]: [string, any[]])=> ({ state: k || "(blank)", orders: uniq(rows.map((r: any)=>r.orderId)).length }));
    const byFulfill = Object.entries(by(shipped, (r)=> r.fulfilment)).map(([k, rows]: [string, any[]])=> ({ name: k || "(blank)", value: rows.length }));

    // Top SKUs by shipped revenue
    const bySku = Object.entries(by(shipped, (r)=> r.sku)).map(([sku, rows]: [string, any[]])=> {
      const rev = rows.reduce((s: number,r: any)=> s+toNum(r.amount),0);
      const units = rows.reduce((s: number,r: any)=> s+toNum(r.qty),0);
      const orders = uniq(rows.map((r: any)=>r.orderId)).length;
      const cat = (rows[0] as any)?.category || "";
      const style = (rows[0] as any)?.style || "";
      return { sku, style, category: cat, revenue: rev, units, orders, asp: units? rev/units: 0, aov: orders? rev/orders: 0 };
    }).sort((a,b)=> b.revenue - a.revenue).slice(0, 12);

    return {
      totalLines, totalUnits, totalRevenue, ordersAll,
      shippedRevenue, shippedUnits, ordersShipped,
      ordersCancelled, aov, asp, uPo,
      promoPenetration, b2bShare,
      statusCounts, byDay, byCategory, byState, byFulfill, bySku
    };
  }, [filtered]);

  // Options for quick filtering
  const allStatuses = useMemo(()=> Array.from(new Set(raw.map(r=>r.status).filter(Boolean))), [raw]);
  const allFulfill = useMemo(()=> Array.from(new Set(raw.map(r=>r.fulfilment).filter(Boolean))), [raw]);
  const allCategories = useMemo(()=> Array.from(new Set(raw.map(r=>r.category).filter(Boolean))).sort(), [raw]);

  // Default-select all chips once options are known
  useEffect(() => {
    if (allStatuses.length && statusSel.size === 0) {
      setStatusSel(new Set(allStatuses));
    }
  }, [allStatuses]);
  useEffect(() => {
    if (allFulfill.length && fulfillmentSel.size === 0) {
      setFulfillmentSel(new Set(allFulfill));
    }
  }, [allFulfill]);
  useEffect(() => {
    if (allCategories.length && categorySel.size === 0) {
      setCategorySel(new Set(allCategories));
    }
  }, [allCategories]);

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#955196", "#A3E635", "#F97316", "#06B6D4"]; // accessible palette

  const resetFilters = () => {
    setStatusSel(new Set());
    setFulfillmentSel(new Set());
    setCategorySel(new Set());
    setB2bOnly(false);
    if (minDate) setDateFrom(minDate.toISOString().slice(0,10));
    if (maxDate) setDateTo(maxDate.toISOString().slice(0,10));
    setSearchText("");
  };

  const downloadFiltered = () => {
    const csv = Papa.unparse(filtered.map(({date, ...r}) => ({...r, date: new Date(date).toISOString().slice(0,10)})));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `amazon_filtered_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // Listen for external export trigger from project header
  useEffect(() => {
    const handler = () => downloadFiltered();
    window.addEventListener('amazon-dashboard:export-view', handler as EventListener);
    return () => {
      window.removeEventListener('amazon-dashboard:export-view', handler as EventListener);
    };
  }, [filtered]);

  if (!isReady) {
    return (
      <div aria-busy="true" aria-live="polite" data-testid="amazon-dashboard-loading" />
    );
  }

  return (
    <div className={`p-6 space-y-6 bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`} style={style}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Amazon Sales Report</h1>
          <p className="text-sm text-muted-foreground">Amazon sales report by time, status, fulfillment, category, geography, and promotions.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input className="rounded-xl border-gray-200 bg-white text-gray-400" type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input className="rounded-xl border-gray-200 bg-white text-gray-400" type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Search (SKU / Style / Category)</label>
              <div className="flex gap-2">
                <Input className="rounded-xl border-gray-200 bg-white text-gray-400" placeholder="e.g. KUR-1234 or Kurta" value={searchText} onChange={(e)=>setSearchText(e.target.value)} />
                <button type="button" aria-label="Clear search" onClick={()=>setSearchText("")} className="rounded-2xl inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 transition"><Search className="h-4 w-4"/></button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={resetFilters} className="rounded-2xl inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 transition"><RefreshCw className="h-4 w-4"/> <span>Reset</span></button>
              <button type="button" onClick={()=>setB2bOnly(v=>!v)} className={b2bOnly ? "rounded-2xl inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white hover:bg-gray-800 transition" : "rounded-2xl inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 transition"}>
                <span className="mr-2 rounded-2xl px-2 py-0.5 text-xs bg-gray-900 text-white">B2B</span>
                {b2bOnly?"Only":"Include"}
              </button>
            </div>
          </div>

          {/* Quick pickers */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {allStatuses.map(s => (
                  <span
                    key={s}
                    onClick={()=> setStatusSel(prev => { const n = new Set(prev); n.has(s)? n.delete(s): n.add(s); return n; })}
                    className={`cursor-pointer rounded-2xl px-3 py-1 text-xs inline-flex items-center ${statusSel.has(s)?"bg-gray-900 text-white":"bg-gray-100 text-gray-700"}`}
                  >
                    {s || "(blank)"}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Fulfillment</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {allFulfill.map(s => (
                  <span
                    key={s}
                    onClick={()=> setFulfillmentSel(prev => { const n = new Set(prev); n.has(s)? n.delete(s): n.add(s); return n; })}
                    className={`cursor-pointer rounded-2xl px-3 py-1 text-xs inline-flex items-center ${fulfillmentSel.has(s)?"bg-gray-900 text-white":"bg-gray-100 text-gray-700"}`}
                  >
                    {s || "(blank)"}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Category</label>
              <div className="overflow-y-auto rounded-xl p-2">
                <div className="flex flex-wrap gap-2">
                  {allCategories.map(c => (
                    <span
                      key={c}
                      onClick={()=> setCategorySel(prev => { const n = new Set(prev); n.has(c)? n.delete(c): n.add(c); return n; })}
                      className={`cursor-pointer rounded-2xl px-3 py-1 text-xs inline-flex items-center ${categorySel.has(c)?"bg-gray-900 text-white":"bg-gray-100 text-gray-700"}`}
                    >
                      {c || "(blank)"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}>
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="p-4">
              <p className="text-xs text-gray-600">Orders (unique)</p>
              <div className="text-2xl text-gray-900 font-semibold">{n.format(metrics.ordersAll || 0)}</div>
            </div>
          </div>
        </motion.div>
        <motion.div layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}>
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="p-4">
              <p className="text-xs text-gray-600">Shipped Revenue</p>
              <div className="text-2xl text-gray-900 font-semibold flex items-center gap-1"><IndianRupee className="h-5 w-5"/>{n.format(Math.round(metrics.shippedRevenue || 0))}</div>
            </div>
          </div>
        </motion.div>
        <motion.div layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}>
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="p-4">
              <p className="text-xs text-gray-600">AOV (Shipped)</p>
              <div className="text-2xl text-gray-900 font-semibold">{inr(Math.round(metrics.aov || 0))}</div>
            </div>
          </div>
        </motion.div>
        <motion.div layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}>
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="p-4">
              <p className="text-xs text-gray-600">Cancellation Rate</p>
              <div className="text-2xl text-gray-900 font-semibold">{metrics.ordersAll ? ((metrics.ordersCancelled / metrics.ordersAll) * 100).toFixed(1) + "%" : "0%"}</div>
            </div>
          </div>
        </motion.div>
      </div>

      <Tabs defaultValue="trend" className="w-full">
        <TabsList className="bg-gray-100 rounded-2xl p-1">
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="trend">Revenue & Orders Trend</TabsTrigger>
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="status">Status Mix</TabsTrigger>
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="fulfill">Fulfillment</TabsTrigger>
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="category">Category Share</TabsTrigger>
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="geo">By State</TabsTrigger>
          <TabsTrigger className="rounded-xl data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm" value="skus">Top SKUs</TabsTrigger>
        </TabsList>

        {/* Trend */}
        <TabsContent value="trend">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={metrics.byDay} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#8884d8" dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="orders" name="Orders" stroke="#82ca9d" dot={false} />
              <Brush dataKey="date" height={20} />
            </LineChart>
          </ResponsiveContainer>
        </TabsContent>

        {/* Status mix */}
        <TabsContent value="status">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={metrics.statusCounts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Lines" fill="#0088FE" />
            </BarChart>
          </ResponsiveContainer>
        </TabsContent>

        {/* Fulfillment */}
        <TabsContent value="fulfill">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={metrics.byFulfill} dataKey="value" nameKey="name" outerRadius={120} label>
                {metrics.byFulfill.map((entry: any, idx: number) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </TabsContent>

        {/* Category Share via Treemap */}
        <TabsContent value="category">
          <ResponsiveContainer width="100%" height={360}>
            <Treemap data={metrics.byCategory} dataKey="value" nameKey="name" stroke="#fff" fill="#82ca9d"/>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm"><div className="p-4"><p className="text-xs text-muted-foreground">Promo Penetration</p><div className="text-xl font-semibold">{((metrics.promoPenetration||0)*100).toFixed(1)}%</div></div></div>
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm"><div className="p-4"><p className="text-xs text-muted-foreground">B2B Revenue Share</p><div className="text-xl font-semibold">{((metrics.b2bShare||0)*100).toFixed(1)}%</div></div></div>
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm"><div className="p-4"><p className="text-xs text-muted-foreground">ASP (Shipped)</p><div className="text-xl font-semibold">{inr(Math.round(metrics.asp||0))}</div></div></div>
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm"><div className="p-4"><p className="text-xs text-muted-foreground">Units / Order</p><div className="text-xl font-semibold">{(metrics.uPo||0).toFixed(2)}</div></div></div>
          </div>
        </TabsContent>

        {/* Geography */}
        <TabsContent value="geo">
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={[...metrics.byState].sort((a,b)=> b.orders - a.orders).slice(0, 15)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="state" angle={-30} textAnchor="end" interval={0} height={60}/>
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="orders" name="Orders" fill="#00C49F" />
            </BarChart>
          </ResponsiveContainer>
        </TabsContent>

        {/* Top SKUs Table */}
        <TabsContent value="skus">
          <div className="overflow-auto rounded-2xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted sticky top-0 text-white">
                <tr>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">Style</th>
                  <th className="text-left p-2">Category</th>
                  <th className="text-right p-2">Revenue</th>
                  <th className="text-right p-2">Units</th>
                  <th className="text-right p-2">Orders</th>
                  <th className="text-right p-2">ASP</th>
                  <th className="text-right p-2">AOV</th>
                </tr>
              </thead>
              <tbody>
                {metrics.bySku.map((r: any) => (
                  <tr key={r.sku} className="odd:bg-white even:bg-muted/40">
                    <td className="p-2 font-mono">{r.sku}</td>
                    <td className="p-2">{r.style}</td>
                    <td className="p-2">{r.category}</td>
                    <td className="p-2 text-right">{inr(Math.round(r.revenue))}</td>
                    <td className="p-2 text-right">{n.format(r.units)}</td>
                    <td className="p-2 text-right">{n.format(r.orders)}</td>
                    <td className="p-2 text-right">{inr(Math.round(r.asp))}</td>
                    <td className="p-2 text-right">{inr(Math.round(r.aov))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
