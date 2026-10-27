import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, BarChart3, IndianRupee, ArrowUpDown, SortAsc, LogOut, AlertTriangle } from "lucide-react";
import { Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

function useSmallScreen() {
  const [isSmall, setIsSmall] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsSmall(mql.matches);
    mql.addEventListener("change", onChange);
    setIsSmall(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isSmall;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompact(amount: number) {
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return String(amount);
}

interface CityRisk {
  city: string;
  critical: { count: number; amount: number };
  warning: { count: number; amount: number };
  healthy: { count: number; amount: number };
  total: number;
}

interface RiskDistributionData {
  cities: CityRisk[];
  totals: {
    criticalCount: number;
    warningCount: number;
    healthyCount: number;
    totalValueAtRisk: number;
  };
  masterFlagActive?: boolean;
}

type SegmentKey = "critical" | "warning" | "healthy";
type ViewMode = "count" | "amount";
type SortMode = "total" | "critical" | "alpha";

const SEGMENT_CONFIG: Record<
  SegmentKey,
  { label: string; gradientFrom: string; gradientTo: string; dotColor: string; description: string }
> = {
  critical: {
    label: "Critical",
    gradientFrom: "#FCA5A5",
    gradientTo: "#F87171",
    dotColor: "#EF4444",
    description: "High overdue amount or repeated defaults requiring immediate action",
  },
  warning: {
    label: "Warning",
    gradientFrom: "#FDBA74",
    gradientTo: "#FB923C",
    dotColor: "#F97316",
    description: "Moderate risk with partial payments or missed follow-ups needing attention",
  },
  healthy: {
    label: "Healthy",
    gradientFrom: "#6EE7B7",
    gradientTo: "#34D399",
    dotColor: "#10B981",
    description: "Tenants with dues but no escalation flags, on track with payments",
  },
};

const SEGMENTS: SegmentKey[] = ["critical", "warning", "healthy"];

function CustomTooltipContent({ active, payload, label, viewMode }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-md border bg-card p-3 shadow-lg text-xs"
      style={{ minWidth: 160 }}
    >
      <p className="font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
        {label}
      </p>
      {payload.map((entry: any) => {
        const rawKey = entry.dataKey as string;
        const key = rawKey.replace("Amount", "") as SegmentKey;
        const cfg = SEGMENT_CONFIG[key];
        if (!cfg) return null;
        const cityData = entry.payload;
        const count = cityData[key] || 0;
        const amount = cityData[`${key}Amount`] || 0;
        return (
          <div key={key} className="flex items-center justify-between gap-3 py-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: cfg.dotColor }}
              />
              <span className="text-slate-900 dark:text-slate-200">{cfg.label}</span>
            </div>
            <span className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
              {viewMode === "amount" ? formatCurrency(amount) : `${count} (${formatCurrency(amount)})`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface CollectionHeatChartProps {
  cityFilter?: string[];
  propertyFilter?: string[];
}

export default function CollectionHeatChart({ cityFilter = [], propertyFilter = [] }: CollectionHeatChartProps) {
  const isSmall = useSmallScreen();
  const [, setLocation] = useLocation();
  const [ghosted, setGhosted] = useState<Record<SegmentKey, boolean>>({
    critical: false,
    warning: false,
    healthy: false,
  });
  const [viewMode, setViewMode] = useState<ViewMode>("count");
  const [sortMode, setSortMode] = useState<SortMode>("total");
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const [checkoutNoticeOnly, setCheckoutNoticeOnly] = useState(false);

  const riskUrl = useMemo(() => {
    const params = new URLSearchParams();
    const realCities = cityFilter.filter(x => x !== "__none__");
    if (realCities.length > 0) params.set("city", realCities.join(","));
    const realProps = propertyFilter.filter(x => x !== "__none__");
    if (realProps.length > 0) params.set("property", realProps.join(","));
    if (checkoutNoticeOnly) params.set("checkoutNotice", "true");
    const qs = params.toString();
    return `/api/analytics/risk-distribution${qs ? `?${qs}` : ""}`;
  }, [cityFilter, propertyFilter, checkoutNoticeOnly]);

  const { data: riskData, isLoading } = useQuery<RiskDistributionData>({
    queryKey: [riskUrl],
  });

  const chartData = useMemo(() => {
    if (!riskData?.cities) return [];
    const mapped = riskData.cities.map((c) => ({
      city: c.city,
      critical: c.critical.count,
      criticalAmount: c.critical.amount,
      warning: c.warning.count,
      warningAmount: c.warning.amount,
      healthy: c.healthy.count,
      healthyAmount: c.healthy.amount,
      total: c.total,
      totalAmount: c.critical.amount + c.warning.amount + c.healthy.amount,
      hasCritical: c.critical.count > 0,
    }));

    if (sortMode === "critical") {
      mapped.sort((a, b) => b.critical + b.criticalAmount * 0.0001 - (a.critical + a.criticalAmount * 0.0001));
    } else if (sortMode === "alpha") {
      mapped.sort((a, b) => a.city.localeCompare(b.city));
    } else {
      mapped.sort((a, b) => b.total - a.total);
    }

    return mapped;
  }, [riskData, sortMode]);

  const totalEscalated = useMemo(() => {
    if (!riskData?.totals) return 0;
    return riskData.totals.criticalCount + riskData.totals.warningCount;
  }, [riskData]);

  const toggleGhost = (key: SegmentKey) => {
    setGhosted((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBarClick = (city: string, level: SegmentKey) => {
    const p = new URLSearchParams();
    p.set("from", "dashboard");
    p.set("city", city);
    p.set("escalation", level);
    const fp = propertyFilter.filter(x => x !== "__none__");
    if (fp.length > 0) p.set("property", fp.join(","));
    setLocation(`/tenants?${p}`);
  };

  const cycleSortMode = () => {
    setSortMode((prev) => {
      if (prev === "total") return "critical";
      if (prev === "critical") return "alpha";
      return "total";
    });
  };

  const sortLabel = sortMode === "total" ? "By Total" : sortMode === "critical" ? "By Critical" : "A-Z";

  if (isLoading) {
    return (
      <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="h-[280px] w-full rounded-md" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasData = chartData.length > 0;
  const masterFlagActive = riskData?.masterFlagActive ?? false;

  if (!masterFlagActive) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                <Flame className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100" data-testid="text-collection-heat-title">
                  Collection Heat
                </CardTitle>
                <p className="text-xs text-muted-foreground/80 mt-0.5">City-wise risk distribution</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20" data-testid="card-heat-chart-inactive-warning">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Master Flag is inactive. Enable it in Settings to view risk distribution data.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <Card className="glass-card rounded-2xl border border-slate-400 dark:border-slate-500 overflow-visible">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                <Flame className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle
                  className="text-sm font-bold text-slate-900 dark:text-slate-100"
                  data-testid="text-collection-heat-title"
                >
                  Collection Heat
                </CardTitle>
                <p className="text-xs text-muted-foreground/80 mt-0.5">
                  City-wise risk distribution
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center rounded-full border bg-muted/30 p-0.5">
                {(["count", "amount"] as const).map((mode) => {
                  const isActive = viewMode === mode;
                  const Icon = mode === "count" ? BarChart3 : IndianRupee;
                  return (
                    <Button
                      key={mode}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode(mode)}
                      className={`rounded-full text-xs ${isActive ? "shadow-md" : ""}`}
                      data-testid={`button-view-${mode}`}
                    >
                      <Icon className="w-3.5 h-3.5 mr-1" />
                      {mode === "count" ? "Count" : "Amount"}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={cycleSortMode}
                className="rounded-full text-xs"
                data-testid="button-sort-toggle"
              >
                {sortMode === "alpha" ? <SortAsc className="w-3.5 h-3.5 mr-1" /> : <ArrowUpDown className="w-3.5 h-3.5 mr-1" />}
                {sortLabel}
              </Button>
              <Button
                variant={checkoutNoticeOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setCheckoutNoticeOnly(!checkoutNoticeOnly)}
                className={`rounded-full text-xs toggle-elevate ${checkoutNoticeOnly ? "bg-emerald-600 border-emerald-600 text-white shadow-md" : ""}`}
                data-testid="button-checkout-notice-toggle"
              >
                <LogOut className="w-3.5 h-3.5 mr-1" />
                Checkout Notice
              </Button>

            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {riskData?.totals && (
            <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Value at Risk
                </span>
                <Badge variant="secondary" className="text-xs rounded-full tabular-nums bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 shadow-sm" data-testid="badge-value-at-risk">
                  {formatCurrency(riskData.totals.totalValueAtRisk)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Escalated
                </span>
                <Badge variant="secondary" className="text-xs rounded-full tabular-nums bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 shadow-sm" data-testid="badge-escalated-count">
                  {totalEscalated.toLocaleString("en-IN")} of {(riskData.totals.criticalCount + riskData.totals.warningCount + riskData.totals.healthyCount).toLocaleString("en-IN")} tenants
                </Badge>
              </div>
            </div>
          )}

          {!hasData ? (
            <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">
              No data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={isSmall ? 200 : 280}>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 8, bottom: 4, left: viewMode === "amount" ? 10 : 0 }}
                barCategoryGap="20%"
                onMouseMove={(state: any) => {
                  if (state?.activeTooltipIndex !== undefined) setActiveBarIndex(state.activeTooltipIndex);
                }}
                onMouseLeave={() => setActiveBarIndex(null)}
              >
                <defs>
                  {SEGMENTS.map((key) => {
                    const cfg = SEGMENT_CONFIG[key];
                    return (
                      <linearGradient
                        key={key}
                        id={`heatGrad_${key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={cfg.gradientFrom} stopOpacity={1} />
                        <stop offset="100%" stopColor={cfg.gradientTo} stopOpacity={0.85} />
                      </linearGradient>
                    );
                  })}
                  <filter id="criticalGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#FCA5A5" floodOpacity="0.25" />
                  </filter>
                  <filter id="heatBarGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                <XAxis
                  dataKey="city"
                  tick={{ fontSize: 11, fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                  className="fill-slate-900 dark:fill-slate-200"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={viewMode === "amount" ? 55 : 40}
                  className="fill-slate-900 dark:fill-slate-200"
                  tickFormatter={viewMode === "amount" ? (v: number) => formatCompact(v) : undefined}
                />
                <Tooltip content={<CustomTooltipContent viewMode={viewMode} />} cursor={{ fill: "hsl(var(--muted) / 0.2)" }} />
                {SEGMENTS.map((key, idx) => {
                  const isLast = idx === SEGMENTS.length - 1;
                  const dataKey = viewMode === "amount" ? `${key}Amount` : key;
                  return (
                    <Bar
                      key={dataKey}
                      dataKey={dataKey}
                      stackId="risk"
                      fill={`url(#heatGrad_${key})`}
                      radius={isLast ? [4, 4, 0, 0] : undefined}
                      style={{ cursor: "pointer" }}
                      onClick={(data: any) => {
                        if (data?.city) handleBarClick(data.city, key);
                      }}
                    >
                      {chartData.map((entry, i) => (
                        <Cell
                          key={`${key}-${i}`}
                          fill={`url(#heatGrad_${key})`}
                          style={{
                            filter: activeBarIndex === i ? "url(#heatBarGlow)" : (key === "critical" && entry.hasCritical ? "url(#criticalGlow)" : "none"),
                            opacity: ghosted[key] ? 0.15 : (activeBarIndex !== null && activeBarIndex !== i ? 0.4 : 1),
                            transition: "filter 300ms ease, opacity 300ms ease",
                            cursor: "pointer",
                          }}
                        />
                      ))}
                      {isLast && (
                        <LabelList
                          dataKey={viewMode === "amount" ? "totalAmount" : "total"}
                          position="top"
                          className="fill-slate-900 dark:fill-slate-200"
                          style={{ fontSize: 10, fontWeight: 600 }}
                          formatter={viewMode === "amount" ? (v: number) => formatCompact(v) : undefined}
                        />
                      )}
                    </Bar>
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          )}

          <div className="flex items-center gap-4 flex-wrap" data-testid="legend-collection-heat">
            {SEGMENTS.map((key) => {
              const cfg = SEGMENT_CONFIG[key];
              const isGhosted = ghosted[key];
              const count = riskData?.totals ? (riskData.totals as any)[`${key}Count`] : 0;
              return (
                <ShadTooltip key={key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => toggleGhost(key)}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-opacity duration-200 ${
                        isGhosted
                          ? "opacity-40 line-through text-muted-foreground"
                          : "text-slate-900 dark:text-slate-200"
                      }`}
                      data-testid={`button-legend-${key}`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{
                          background: cfg.dotColor,
                          opacity: isGhosted ? 0.3 : 1,
                        }}
                      />
                      {cfg.label}
                      <span className="tabular-nums font-semibold" data-testid={`text-legend-count-${key}`}>{count}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    <p>{cfg.description}</p>
                  </TooltipContent>
                </ShadTooltip>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
