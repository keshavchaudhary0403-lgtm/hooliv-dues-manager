import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IndianRupee, Building2, MapPin, Upload, TrendingUp, PieChart as PieChartIcon, X, CalendarCheck, Wallet, ShieldAlert, AlertTriangle, ShieldCheck, Flag, Clock, ChevronsUpDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Sector, LabelList } from "recharts";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import CollectionHeatChart from "@/components/collection-heat-chart";
import CollectableTrendChart from "@/components/collectable-trend-chart";

const chartColors = [
  "#10b981",
  "#6366f1",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
];

const STATUS_LABELS: Record<string, string> = {
  no_update: "No Update",
  pending: "Pending",
  paid: "Paid",
  partial_payment: "Partial Payment",
  not_responding: "Not Responding",
  already_paid: "Already Paid",
  refund_adjustment: "Refund Adjustment",
  payment_not_updated: "Payment Not Updated",
};

const STATUS_COLORS: Record<string, string> = {
  no_update: "#94a3b8",
  pending: "#3b82f6",
  paid: "#10b981",
  partial_payment: "#f59e0b",
  not_responding: "#ef4444",
  already_paid: "#6ee7b7",
  refund_adjustment: "#8b5cf6",
  payment_not_updated: "#ec4899",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function AnimatedCounter({ value, prefix = "", duration = 1200 }: { value: number; prefix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    const start = ref.current ?? 0;
    const diff = value - start;
    if (diff === 0) { setDisplay(value); return; }
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setDisplay(current);
      if (progress < 1) requestAnimationFrame(animate);
      else ref.current = value;
    };
    requestAnimationFrame(animate);
    return () => { ref.current = value; };
  }, [value, duration]);

  if (prefix === "\u20B9") return <>{formatCurrency(display)}</>;
  return <>{prefix}{display.toLocaleString("en-IN")}</>;
}

interface DashboardStats {
  hasData: boolean;
  totalTenants: number;
  totalDues: number;
  pendingCount: number;
  totalOutstanding: number;
  outstandingTenantCount: number;
  suspenseDue: number;
  suspenseTenantCount: number;
  collectableDue: number;
  collectableTenantCount: number;
  cities: string[];
  properties: string[];
  cityPropertyMap: Record<string, string[]>;
  statusCounts?: Record<string, { count: number; amount: number }>;
  cityData?: { name: string; amount: number }[];
  propertyData?: { name: string; amount: number }[];
  followUpData?: { bucket: string; count: number }[];
  flagDistribution?: {
    daysOverdue: { notFlagged: number; warning: number; critical: number };
    dueDate: { notFlagged: number; warning: number; critical: number };
    followUp: { notFlagged: number; warning: number; critical: number };
    thresholds: { orangeDays: number; redDays: number; ddOrange: number; ddRed: number; fuOrange: number; fuRed: number };
  };
}

const statCardConfig = [
  { bg: "bg-gradient-to-br from-blue-600 to-blue-700", iconBg: "bg-white/20" },
  { bg: "bg-gradient-to-br from-emerald-500 to-emerald-600", iconBg: "bg-white/20" },
  { bg: "bg-gradient-to-br from-violet-600 to-purple-700", iconBg: "bg-white/20" },
];

function StatCard({
  title,
  numericValue,
  subtitle,
  icon: Icon,
  delay,
  config,
  prefix,
  onClick,
}: {
  title: string;
  numericValue: number;
  subtitle?: string;
  icon: any;
  delay: number;
  config: typeof statCardConfig[0];
  prefix?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div
        className={`float-card rounded-[20px] p-5 ${config.bg} text-white shadow-lg relative ${onClick ? "cursor-pointer transition-all duration-200 hover:shadow-xl hover:scale-[1.02]" : ""}`}
        onClick={onClick}
        data-testid={`card-stat-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className={`absolute top-5 right-5 flex items-center justify-center w-11 h-11 rounded-2xl ${config.iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col gap-1 pr-[60px]">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/70 whitespace-nowrap">{title}</p>
          <p className="font-bold tracking-tight text-white whitespace-nowrap" style={{ fontSize: "clamp(22px, 2vw, 32px)" }} data-testid={`text-stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
            <AnimatedCounter value={numericValue} prefix={prefix} />
          </p>
          {subtitle && <p className="text-xs text-white/60 whitespace-nowrap mt-1">{subtitle}</p>}
        </div>
      </div>
    </motion.div>
  );
}

type FlagType = "daysOverdue" | "dueDate" | "followUp";
const FLAG_TYPE_LABELS: Record<FlagType, string> = {
  daysOverdue: "Days Overdue",
  dueDate: "Due Date",
  followUp: "Follow-Up",
};

const FLAG_BUCKET_CONFIG = {
  notFlagged: { label: "Not Flagged", color: "#64748b", bgClass: "bg-slate-500/15", textClass: "text-slate-800 dark:text-slate-300" },
  warning: { label: "Warning", color: "#c2410c", bgClass: "bg-orange-600/15", textClass: "text-orange-700 dark:text-orange-400" },
  critical: { label: "Critical", color: "#b91c1c", bgClass: "bg-red-700/15", textClass: "text-red-700 dark:text-red-400" },
};

function getFlagBucketIcon(bucket: "notFlagged" | "warning" | "critical", _flagType: FlagType) {
  if (bucket === "notFlagged") return ShieldCheck;
  return bucket === "warning" ? AlertTriangle : ShieldAlert;
}

function FlagDistributionCard({ flagDistribution, cityFilter = [], propertyFilter = [] }: { flagDistribution?: DashboardStats["flagDistribution"]; cityFilter?: string[]; propertyFilter?: string[] }) {
  const [, setLocation] = useLocation();
  const [selectedFlag, setSelectedFlag] = useState<FlagType>("daysOverdue");
  const [flagActiveIndex, setFlagActiveIndex] = useState<number | null>(null);

  const distribution = useMemo(() => {
    if (!flagDistribution) return { notFlagged: 0, warning: 0, critical: 0 };
    return flagDistribution[selectedFlag];
  }, [flagDistribution, selectedFlag]);

  const total = distribution.notFlagged + distribution.warning + distribution.critical;

  const thresholdLabel = useMemo(() => {
    if (!flagDistribution) return { orange: 0, red: 0 };
    const t = flagDistribution.thresholds;
    if (selectedFlag === "daysOverdue") return { orange: t.orangeDays, red: t.redDays };
    if (selectedFlag === "dueDate") return { orange: t.ddOrange, red: t.ddRed };
    return { orange: t.fuOrange, red: t.fuRed };
  }, [flagDistribution, selectedFlag]);

  const chartData = useMemo(() => {
    return (["notFlagged", "warning", "critical"] as const).map((key) => ({
      name: FLAG_BUCKET_CONFIG[key].label,
      count: distribution[key],
      pct: total > 0 ? Math.round((distribution[key] / total) * 100) : 0,
      color: FLAG_BUCKET_CONFIG[key].color,
    }));
  }, [distribution, total]);

  const pct = useCallback((v: number) => total > 0 ? Math.round((v / total) * 100) : 0, [total]);

  return (
    <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible flex flex-col w-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
              <Flag className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100" data-testid="text-flag-distribution-title">Flag Distribution</CardTitle>
              <p className="text-xs text-muted-foreground/80 mt-0.5">By selected flag type</p>
            </div>
          </div>
          <div className="flex items-center rounded-full border bg-muted/30 p-0.5" data-testid="toggle-flag-type">
            {(Object.keys(FLAG_TYPE_LABELS) as FlagType[]).map((type) => {
              const isActive = selectedFlag === type;
              return (
                <Button
                  key={type}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedFlag(type)}
                  className={`rounded-full text-xs ${isActive ? "shadow-md" : ""}`}
                  data-testid={`button-flag-${type}`}
                >
                  {FLAG_TYPE_LABELS[type]}
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 sm:space-y-6 flex-1 flex flex-col">
        <div className="grid grid-cols-3 gap-3">
          {(["notFlagged", "warning", "critical"] as const).map((key) => {
            const cfg = FLAG_BUCKET_CONFIG[key];
            const Icon = getFlagBucketIcon(key, selectedFlag);
            return (
              <motion.div
                key={`${selectedFlag}-${key}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className={`rounded-xl p-3 ${cfg.bgClass}`}
                data-testid={`stat-flag-${key}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3 h-3 ${cfg.textClass}`} />
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.textClass}`}>{cfg.label}</span>
                </div>
                <p className={`text-xl font-bold tabular-nums ${cfg.textClass}`}>
                  {distribution[key].toLocaleString("en-IN")}
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5">{pct(distribution[key])}% of total</p>
              </motion.div>
            );
          })}
        </div>

        <div className="flex-1 min-h-0">
        {total === 0 ? (
          <div className="flex items-center justify-center h-44 text-sm text-muted-foreground">No data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 20, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%">
              <defs>
                {chartData.map((d, i) => (
                  <linearGradient key={i} id={`flagGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={0.85} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.4} />
                  </linearGradient>
                ))}
                <filter id="flagBarGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--foreground) / 0.7)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--foreground) / 0.7)" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                formatter={(value: number, _: string, props: any) => [`${value} tenants (${props.payload.pct}%)`, "Count"]}
                labelFormatter={(label) => `${label} — Thresholds: ${thresholdLabel.orange}d / ${thresholdLabel.red}d`}
                contentStyle={{ fontSize: 11, borderRadius: 14, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", boxShadow: "0 8px 24px -6px rgba(0,0,0,0.1)" }}
                cursor={{ fill: "hsl(var(--muted) / 0.2)" }}
              />
              <Bar dataKey="count" name="Tenants" radius={[8, 8, 0, 0]} animationDuration={600} animationEasing="ease-out" style={{ cursor: "pointer" }}>
                {chartData.map((d, i) => {
                  const bucketKeys = ["notFlagged", "warning", "critical"] as const;
                  const flagFilterMap: Record<FlagType, string> = { daysOverdue: "flagOverdue", dueDate: "flagDueDate", followUp: "flagFollowUp" };
                  const levelMap: Record<string, string> = { notFlagged: "green", warning: "orange", critical: "red" };
                  return (
                    <Cell
                      key={i}
                      fill={`url(#flagGrad${i})`}
                      style={{
                        cursor: "pointer",
                        filter: flagActiveIndex === i ? "url(#flagBarGlow)" : "none",
                        opacity: flagActiveIndex !== null && flagActiveIndex !== i ? 0.4 : 1,
                        transition: "filter 300ms ease, opacity 300ms ease",
                      }}
                      onMouseEnter={() => setFlagActiveIndex(i)}
                      onMouseLeave={() => setFlagActiveIndex(null)}
                      onClick={() => {
                        const filterKey = flagFilterMap[selectedFlag];
                        const level = levelMap[bucketKeys[i]];
                        if (level !== "green") {
                          const p = new URLSearchParams();
                          p.set("from", "dashboard");
                          p.set(filterKey, level);
                          const _nc = cityFilter.filter(x => x !== "__none__"); if (_nc.length > 0) p.set("city", _nc.join(","));
                          const fp = propertyFilter.filter(x => x !== "__none__");
                          if (fp.length > 0) p.set("property", fp.join(","));
                          setLocation(`/tenants?${p}`);
                        }
                      }}
                    />
                  );
                })}
                <LabelList dataKey="count" position="top" style={{ fontSize: 9, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        </div>
      </CardContent>
    </Card>
  );
}

const renderPieActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        style={{ filter: "drop-shadow(0 0 8px rgba(0,0,0,0.25))", transition: "all 300ms ease" }}
      />
    </g>
  );
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [propertyFilter, setPropertyFilter] = useState<string[]>([]);
  const [cityActiveIndex, setCityActiveIndex] = useState<number | null>(null);
  const [pieActiveIndex, setPieActiveIndex] = useState<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    qc.prefetchQuery({
      queryKey: ["/api/tenants", "page=1&pageSize=50&sortField=daysOverdue&sortDir=desc"],
      queryFn: async () => {
        const res = await fetch("/api/tenants?page=1&pageSize=50&sortField=daysOverdue&sortDir=desc", { credentials: "include" });
        if (!res.ok) throw new Error("prefetch failed");
        return res.json();
      },
    });
    qc.prefetchQuery({
      queryKey: ["/api/tenants/filter-options"],
      queryFn: async () => {
        const res = await fetch("/api/tenants/filter-options", { credentials: "include" });
        if (!res.ok) throw new Error("prefetch failed");
        return res.json();
      },
    });
  }, [qc]);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/tenants/stats", { city: cityFilter, properties: propertyFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      const realCities = cityFilter.filter(x => x !== "__none__");
      if (realCities.length > 0) params.set("city", realCities.join(","));
      const realProps = propertyFilter.filter(x => x !== "__none__");
      if (realProps.length > 0) params.set("property", realProps.join(","));
      const res = await fetch(`/api/tenants/stats?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const availableProperties = useMemo(() => {
    if (!stats?.cityPropertyMap) return stats?.properties || [];
    if (cityFilter.length === 0) return stats.properties || [];
    const combined = new Set<string>();
    for (const c of cityFilter.filter(x => x !== "__none__")) {
      for (const p of (stats.cityPropertyMap[c] || [])) combined.add(p);
    }
    return Array.from(combined).sort();
  }, [stats, cityFilter]);

  useEffect(() => {
    if (propertyFilter.length > 0) {
      const valid = propertyFilter.filter(p => p === "__none__" || availableProperties.includes(p));
      if (valid.length !== propertyFilter.length) {
        setPropertyFilter(valid);
      }
    }
  }, [cityFilter, availableProperties, propertyFilter]);

  const alreadyPaidData = useMemo(() => {
    if (!stats?.statusCounts?.already_paid) return null;
    return stats.statusCounts.already_paid;
  }, [stats]);

  const statusData = useMemo(() => {
    if (!stats?.statusCounts) return [];
    return Object.entries(stats.statusCounts)
      .filter(([status]) => status !== "already_paid")
      .map(([status, data]) => ({
        key: status,
        name: STATUS_LABELS[status] || status,
        value: data.count,
        amount: data.amount,
        color: STATUS_COLORS[status] || "#94a3b8",
      }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const filterLabel = useMemo(() => {
    const realProps = propertyFilter.filter(x => x !== "__none__");
    if (propertyFilter.length === 1 && propertyFilter[0] === "__none__") return "No Properties";
    if (realProps.length === 1) return realProps[0];
    if (realProps.length > 1) return `${realProps.length} Properties Selected`;
    const realCities = cityFilter.filter(x => x !== "__none__");
    if (realCities.length === 1) return realCities[0];
    if (realCities.length > 1) return `${realCities.length} Cities Selected`;
    return "All Properties";
  }, [cityFilter, propertyFilter]);

  const filteredCityCount = stats?.cityData?.length || 0;
  const filteredPropertyCount = stats?.propertyData?.length || 0;

  if (isLoading) {
    return (
      <div className="px-4 md:px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[120px] rounded-[20px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (!stats?.hasData) {
    return (
      <div className="px-4 md:px-8 py-6 mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <div className="w-20 h-20 rounded-3xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold" data-testid="text-no-data-title">No tenant data uploaded yet</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload your first CRM dump to see real-time dues overview, analytics, and charts across all your properties.
            </p>
          </div>
          <Link href="/upload">
            <Button className="rounded-full px-6 shadow-lg shadow-primary/20" data-testid="button-go-upload">
              <Upload className="w-4 h-4 mr-2" />
              Upload Data
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 space-y-7 mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time dues overview &middot; {filterLabel}
          </p>
        </div>
        <div className="glass-filter rounded-full px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`w-[150px] rounded-full justify-start ${cityFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                data-testid="select-city-filter"
              >
                <MapPin className={`w-3.5 h-3.5 mr-1.5 ${cityFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                <span className="truncate text-xs">
                  {cityFilter.length === 0 ? "All Cities" :
                   (cityFilter.length === 1 && cityFilter[0] === "__none__") ? "No Cities" :
                   cityFilter.filter(x => x !== "__none__").length === 1 ? cityFilter.filter(x => x !== "__none__")[0] :
                   `${cityFilter.filter(x => x !== "__none__").length} Cities`}
                </span>
                <ChevronsUpDown className="w-3.5 h-3.5 ml-auto shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-2 max-h-[300px] overflow-auto" align="start">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-medium text-muted-foreground">Cities</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto py-0.5 px-1.5"
                  onClick={() => { setCityFilter(cityFilter.length === 0 ? ["__none__"] : []); setPropertyFilter([]); }}
                  data-testid="button-select-all-cities"
                >
                  {cityFilter.length === 0 ? "Deselect All" : "Select All"}
                </Button>
              </div>
              {(stats.cities || []).map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                  data-testid={`checkbox-city-${c}`}
                >
                  <Checkbox
                    checked={cityFilter.length === 0 || cityFilter.includes(c)}
                    onCheckedChange={(checked) => {
                      const allCities = stats.cities || [];
                      if (cityFilter.length === 0) {
                        setCityFilter(allCities.filter(x => x !== c));
                      } else if (checked) {
                        const next = [...cityFilter.filter(x => x !== "__none__"), c];
                        setCityFilter(next.length === allCities.length ? [] : next);
                      } else {
                        const next = cityFilter.filter(x => x !== c && x !== "__none__");
                        setCityFilter(next.length === 0 ? ["__none__"] : next);
                      }
                      setPropertyFilter([]);
                    }}
                  />
                  <span className="truncate">{c}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`w-[180px] rounded-full justify-start ${propertyFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                data-testid="select-property-filter"
              >
                <Building2 className={`w-3.5 h-3.5 mr-1.5 ${propertyFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                <span className="truncate text-xs">
                  {propertyFilter.length === 0 ? "All Properties" :
                   (propertyFilter.length === 1 && propertyFilter[0] === "__none__") ? "No Properties" :
                   propertyFilter.filter(x => x !== "__none__").length === 1 ? propertyFilter.filter(x => x !== "__none__")[0] :
                   `${propertyFilter.filter(x => x !== "__none__").length} Properties`}
                </span>
                <ChevronsUpDown className="w-3.5 h-3.5 ml-auto shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-2 max-h-[300px] overflow-auto" align="start">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-medium text-muted-foreground">Properties</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto py-0.5 px-1.5"
                  onClick={() => setPropertyFilter(propertyFilter.length === 0 ? ["__none__"] : [])}
                  data-testid="button-select-all-properties"
                >
                  {propertyFilter.length === 0 ? "Deselect All" : "Select All"}
                </Button>
              </div>
              {availableProperties.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                  data-testid={`checkbox-property-${p}`}
                >
                  <Checkbox
                    checked={propertyFilter.length === 0 || propertyFilter.includes(p)}
                    onCheckedChange={(checked) => {
                      if (propertyFilter.length === 0) {
                        setPropertyFilter(availableProperties.filter(x => x !== p));
                      } else if (checked) {
                        const next = [...propertyFilter.filter(x => x !== "__none__"), p];
                        setPropertyFilter(next.length === availableProperties.length ? [] : next);
                      } else {
                        const next = propertyFilter.filter(x => x !== p && x !== "__none__");
                        setPropertyFilter(next.length === 0 ? ["__none__"] : next);
                      }
                    }}
                  />
                  <span className="truncate">{p}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
          {(cityFilter.length > 0 || propertyFilter.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-xs text-muted-foreground"
              onClick={() => { setCityFilter([]); setPropertyFilter([]); }}
              data-testid="button-clear-filters-dashboard"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <StatCard title="Total Outstanding" numericValue={stats.totalOutstanding ?? stats.totalDues} subtitle={`${stats.outstandingTenantCount ?? stats.totalTenants} tenants`} icon={IndianRupee} delay={0.05} config={statCardConfig[0]} prefix={"\u20B9"} onClick={() => {
          const params = new URLSearchParams();
          params.set("from", "dashboard");
          const nc = cityFilter.filter(x => x !== "__none__");
          if (nc.length > 0) params.set("city", nc.join(","));
          const navProps = propertyFilter.filter(x => x !== "__none__");
          if (navProps.length > 0) params.set("property", navProps.join(","));
          setLocation(`/tenants?${params}`);
        }} />
        <StatCard title="Collectable Due" numericValue={stats.collectableDue ?? 0} subtitle={`${stats.collectableTenantCount ?? 0} tenants`} icon={Wallet} delay={0.1} config={statCardConfig[1]} prefix={"\u20B9"} onClick={() => {
          const params = new URLSearchParams();
          params.set("from", "dashboard");
          const nc2 = cityFilter.filter(x => x !== "__none__");
          if (nc2.length > 0) params.set("city", nc2.join(","));
          const navProps2 = propertyFilter.filter(x => x !== "__none__");
          if (navProps2.length > 0) params.set("property", navProps2.join(","));
          params.set("status", "collectable");
          setLocation(`/tenants?${params}`);
        }} />
        <StatCard title="Non Collectable Due" numericValue={stats.suspenseDue ?? 0} subtitle={`${stats.suspenseTenantCount ?? 0} tenants`} icon={Clock} delay={0.12} config={statCardConfig[2]} prefix={"\u20B9"} onClick={() => {
          const params = new URLSearchParams();
          params.set("from", "dashboard");
          const nc3 = cityFilter.filter(x => x !== "__none__");
          if (nc3.length > 0) params.set("city", nc3.join(","));
          const navProps3 = propertyFilter.filter(x => x !== "__none__");
          if (navProps3.length > 0) params.set("property", navProps3.join(","));
          params.set("status", "suspense");
          setLocation(`/tenants?${params}`);
        }} />
      </div>

      <CollectableTrendChart cityFilter={cityFilter} propertyFilter={propertyFilter} onDateClick={(date) => {
          const params = new URLSearchParams();
          params.set("from", "dashboard");
          params.set("collectableDate", date);
          const _nc4 = cityFilter.filter(x => x !== "__none__"); if (_nc4.length > 0) params.set("city", _nc4.join(","));
          const navProps = propertyFilter.filter(x => x !== "__none__");
          if (navProps.length > 0) params.set("property", navProps.join(","));
          setLocation(`/tenants?${params}`);
        }} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }} className="flex">
          <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible flex flex-col w-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="section-icon">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Dues by City</CardTitle>
                  <p className="text-xs text-muted-foreground/80 mt-0.5">City-wise outstanding breakdown</p>
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <Badge variant="secondary" className="text-xs rounded-full">{filteredCityCount} {filteredCityCount === 1 ? "city" : "cities"}</Badge>
                <Badge variant="secondary" className="text-xs rounded-full">{propertyFilter.length > 0 ? propertyFilter.filter(x => x !== "__none__").length : availableProperties.length} {(propertyFilter.length > 0 ? propertyFilter.filter(x => x !== "__none__").length : availableProperties.length) === 1 ? "property" : "properties"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-2 flex-1">
              {(stats.cityData?.length || 0) === 0 ? (
                <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={stats.cityData} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      {chartColors.map((color, i) => (
                        <linearGradient key={i} id={`cityGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                          <stop offset="100%" stopColor={color} stopOpacity={0.4} />
                        </linearGradient>
                      ))}
                      <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--foreground) / 0.7)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--foreground) / 0.7)" }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), "Amount"]}
                      contentStyle={{ fontSize: 11, borderRadius: 14, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", boxShadow: "0 8px 24px -6px rgba(0,0,0,0.1)" }}
                      cursor={{ fill: "hsl(var(--muted) / 0.2)" }}
                    />
                    <Bar dataKey="amount" name="Amount" radius={[8, 8, 0, 0]} animationDuration={800} animationEasing="ease-out" style={{ cursor: "pointer" }}>
                      {(stats.cityData || []).map((entry, i) => (
                        <Cell
                          key={i}
                          fill={`url(#cityGrad${i % chartColors.length})`}
                          style={{
                            cursor: "pointer",
                            filter: cityActiveIndex === i ? "url(#barGlow)" : "none",
                            opacity: cityActiveIndex !== null && cityActiveIndex !== i ? 0.4 : 1,
                            transition: "filter 300ms ease, opacity 300ms ease",
                          }}
                          onMouseEnter={() => setCityActiveIndex(i)}
                          onMouseLeave={() => setCityActiveIndex(null)}
                          onClick={() => {
                            const p = new URLSearchParams();
                            p.set("from", "dashboard");
                            p.set("city", entry.name);
                            const fp = propertyFilter.filter(x => x !== "__none__");
                            if (fp.length > 0) p.set("property", fp.join(","));
                            setLocation(`/tenants?${p}`);
                          }}
                        />
                      ))}
                      <LabelList dataKey="amount" position="top" style={{ fontSize: 9, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }} formatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}k`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }} className="flex">
          <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible flex flex-col w-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="section-icon">
                  <PieChartIcon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Status Distribution</CardTitle>
                  <p className="text-xs text-muted-foreground/80 mt-0.5">Tenant count by payment status</p>
                  {alreadyPaidData && alreadyPaidData.count > 0 && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5" data-testid="text-already-paid-info">
                      {alreadyPaidData.count.toLocaleString("en-IN")} Already Paid ({formatCurrency(alreadyPaidData.amount)})
                    </p>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className="text-xs rounded-full">Total Tenants - {stats.totalTenants}</Badge>
            </CardHeader>
            <CardContent className="pt-2 flex-1 flex items-center">
              {statusData.length === 0 ? (
                <div className="flex items-center justify-center h-56 w-full text-sm text-muted-foreground">No data available</div>
              ) : (
                <div className="flex items-center gap-2 w-full">
                  <div className="relative shrink-0" style={{ width: "48%", height: 200 }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                          dataKey="value"
                          stroke="none"
                          activeIndex={pieActiveIndex !== null ? pieActiveIndex : undefined}
                          activeShape={renderPieActiveShape}
                          onMouseEnter={(_: any, index: number) => setPieActiveIndex(index)}
                          onMouseLeave={() => setPieActiveIndex(null)}
                          onClick={(_: any, index: number) => {
                            const statusKey = statusData[index]?.key;
                            if (statusKey) {
                              const p = new URLSearchParams();
                              p.set("from", "dashboard");
                              p.set("status", statusKey);
                              const _nc = cityFilter.filter(x => x !== "__none__"); if (_nc.length > 0) p.set("city", _nc.join(","));
                              const fp = propertyFilter.filter(x => x !== "__none__");
                              if (fp.length > 0) p.set("property", fp.join(","));
                              setLocation(`/tenants?${p}`);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          {statusData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.color}
                              style={{
                                cursor: "pointer",
                                opacity: pieActiveIndex !== null && pieActiveIndex !== i ? 0.4 : 1,
                                transition: "opacity 300ms ease",
                              }}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, _name: string, props: any) => [`${value} tenants (${formatCurrency(props.payload.amount)})`, props.payload.name]}
                          contentStyle={{ fontSize: 11, borderRadius: 14, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", boxShadow: "0 8px 24px -6px rgba(0,0,0,0.1)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1">
                    {statusData.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-colors duration-200"
                        style={{ backgroundColor: pieActiveIndex === i ? `${s.color}15` : "transparent" }}
                        onMouseEnter={() => setPieActiveIndex(i)}
                        onMouseLeave={() => setPieActiveIndex(null)}
                        onClick={() => {
                          const p = new URLSearchParams();
                          p.set("from", "dashboard");
                          p.set("status", s.key);
                          const _nc = cityFilter.filter(x => x !== "__none__"); if (_nc.length > 0) p.set("city", _nc.join(","));
                          const fp = propertyFilter.filter(x => x !== "__none__");
                          if (fp.length > 0) p.set("property", fp.join(","));
                          setLocation(`/tenants?${p}`);
                        }}
                        data-testid={`status-legend-${s.key}`}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-medium text-slate-900 dark:text-slate-100 truncate">{s.name}</span>
                            <span className="text-xs font-bold tabular-nums" style={{ color: s.color }}>{s.value.toLocaleString("en-IN")}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-3">
              <div className="section-icon">
                <Building2 className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Property-wise Dues</CardTitle>
                <p className="text-xs text-muted-foreground/80 mt-0.5">Ranked by outstanding amount</p>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs rounded-full" data-testid="badge-property-count">
              {filteredPropertyCount > 10 ? `Top 10 of ${filteredPropertyCount}` : filteredPropertyCount} {filteredPropertyCount === 1 ? "property" : "properties"}
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            {(stats.propertyData?.length || 0) === 0 ? (
              <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No data available</div>
            ) : (() => {
              const top10 = (stats.propertyData || []).slice(0, 10);
              const totalDuesAmount = (stats.propertyData || []).reduce((sum, d) => sum + d.amount, 0);
              return (
                <div className="space-y-3">
                  {top10.map((item, i) => {
                    const pct = totalDuesAmount > 0 ? (item.amount / totalDuesAmount) * 100 : 0;
                    const color = chartColors[i % chartColors.length];
                    return (
                      <motion.div
                        key={item.name}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, delay: i * 0.04 }}
                        className="group rounded-lg px-2 py-1.5 -mx-2 transition-colors duration-200 hover:bg-muted/30 cursor-pointer"
                        data-testid={`property-bar-${i}`}
                        onClick={() => {
                          const p = new URLSearchParams();
                          p.set("from", "dashboard");
                          p.set("property", item.name);
                          const _nc = cityFilter.filter(x => x !== "__none__"); if (_nc.length > 0) p.set("city", _nc.join(","));
                          setLocation(`/tenants?${p}`);
                        }}
                      >
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[9px] font-bold w-5 text-center flex-shrink-0 rounded-full py-0.5" style={{ color, backgroundColor: `${color}18` }}>
                              {i + 1}
                            </span>
                            <span className="text-xs font-medium truncate">{item.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-muted/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 visibility-visible" style={{ color }}>
                              {Math.round(pct)}%
                            </span>
                            <span className="text-xs font-bold tabular-nums flex-shrink-0" style={{ color }}>
                              {formatCurrency(item.amount)}
                            </span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted/40 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full progress-bar-shimmer group-hover:progress-bar-shimmer"
                            style={{ background: `linear-gradient(90deg, ${color}66, ${color})` }}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, delay: i * 0.04, ease: [0.25, 0.46, 0.45, 0.94] }}
                          />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <CollectionHeatChart cityFilter={cityFilter} propertyFilter={propertyFilter} />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-6 items-stretch">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }} className="flex">
          <FlagDistributionCard flagDistribution={stats.flagDistribution} cityFilter={cityFilter} propertyFilter={propertyFilter} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }} className="flex">
          <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible flex flex-col w-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="section-icon">
                  <CalendarCheck className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100" data-testid="text-followup-chart-title">Follow-Up Distribution</CardTitle>
                  <p className="text-xs text-muted-foreground/80 mt-0.5">By timeline</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2 pb-4 flex-1 flex flex-col">
              {(!stats.followUpData || stats.followUpData.every((d: any) => d.count === 0)) ? (
                <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No data available</div>
              ) : (() => {
                const followUpColors: Record<string, string> = {
                  'Today': '#10b981',
                  'Tomorrow': '#3b82f6',
                  'This Week': '#6366f1',
                  'This Month': '#8b5cf6',
                  'Overdue': '#ef4444',
                  'Later': '#94a3b8',
                  'No Follow-up': '#6b7280',
                };
                const data = (stats.followUpData || []).filter((d: any) => d.count > 0);
                const total = data.reduce((sum: number, d: any) => sum + d.count, 0);
                return (
                  <div className="flex flex-col justify-between flex-1">
                    {data.map((item: any, i: number) => {
                      const color = followUpColors[item.bucket] || '#6b7280';
                      const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                      const isOverdue = item.bucket === 'Overdue';
                      return (
                        <div key={i} className="group space-y-1.5 rounded-lg px-2 py-3 -mx-2 transition-colors duration-200 hover:bg-muted/30 cursor-pointer" onClick={() => {
                          const bucketToFilter: Record<string, string> = { 'Today': 'today', 'Tomorrow': 'tomorrow', 'This Week': 'this_week', 'This Month': 'this_month', 'Overdue': 'overdue', 'Later': 'later', 'No Follow-up': 'none' };
                          const filterVal = bucketToFilter[item.bucket];
                          if (filterVal) {
                            const p = new URLSearchParams();
                            p.set("from", "dashboard");
                            p.set("followUp", filterVal);
                            const _nc = cityFilter.filter(x => x !== "__none__"); if (_nc.length > 0) p.set("city", _nc.join(","));
                            const fp = propertyFilter.filter(x => x !== "__none__");
                            if (fp.length > 0) p.set("property", fp.join(","));
                            setLocation(`/tenants?${p}`);
                          }
                        }}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOverdue ? 'animate-pulse' : ''}`}
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-xs font-medium text-slate-900 dark:text-slate-100">{item.bucket}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 visibility-visible" style={{ color, backgroundColor: `${color}18` }}>
                                {pct}%
                              </span>
                              <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium tabular-nums">{item.count} tenants</span>
                            </div>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-muted/40 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full transition-transform duration-200 origin-left group-hover:scale-y-125"
                              style={{ background: `linear-gradient(90deg, ${color}66, ${color})` }}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.8, delay: i * 0.06, ease: [0.25, 0.46, 0.45, 0.94] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </motion.div>

      </div>
    </div>
  );
}
