import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TrendingUp, CalendarDays, IndianRupee, Users, ArrowUp, ArrowDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";

type TimeMode = "today" | "tomorrow" | "custom";
type ViewMode = "amount" | "tenants";

interface TrendDataPoint {
  date: string;
  amount: number;
  tenantCount: number;
}

interface CollectableTrendChartProps {
  cityFilter?: string[];
  propertyFilter?: string[];
  onDateClick?: (date: string) => void;
}

function formatCurrency(value: number): string {
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString("en-IN");
}

function formatFullCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function CollectableTrendChart({ cityFilter = [], propertyFilter = [], onDateClick }: CollectableTrendChartProps) {
  const [timeMode, setTimeMode] = useState<TimeMode>("custom");
  const [viewMode, setViewMode] = useState<ViewMode>("amount");
  const [customRange, setCustomRange] = useState<{ from: Date | undefined; to: Date | undefined }>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from, to };
  });

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const todayStr = toLocalDateString(today);
    if (timeMode === "today") return { startDate: todayStr, endDate: todayStr };
    if (timeMode === "tomorrow") {
      const tmrw = new Date(today);
      tmrw.setDate(tmrw.getDate() + 1);
      return { startDate: toLocalDateString(tmrw), endDate: toLocalDateString(tmrw) };
    }
    return {
      startDate: customRange.from ? toLocalDateString(customRange.from) : todayStr,
      endDate: customRange.to ? toLocalDateString(customRange.to) : (customRange.from ? toLocalDateString(customRange.from) : todayStr),
    };
  }, [timeMode, customRange]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    const realCities = cityFilter.filter(x => x !== "__none__");
    if (realCities.length > 0) params.set("city", realCities.join(","));
    const realProps = propertyFilter.filter(x => x !== "__none__");
    if (realProps.length > 0) params.set("property", realProps.join(","));
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    const qs = params.toString();
    return `/api/analytics/collectable-trend${qs ? `?${qs}` : ""}`;
  }, [cityFilter, propertyFilter, startDate, endDate]);

  const { data: trendData, isLoading } = useQuery<{ data: TrendDataPoint[] }>({
    queryKey: [queryUrl],
  });

  const chartData = trendData?.data || [];

  const kpis = useMemo(() => {
    if (chartData.length === 0) return null;
    const total = chartData.reduce((s, d) => s + d.amount, 0);
    const totalTenants = chartData.reduce((s, d) => s + d.tenantCount, 0);
    const todayStr = toLocalDateString(new Date());
    const today = chartData.find(d => d.date === todayStr);
    const highest = chartData.reduce((max, d) => d.amount > max.amount ? d : max, chartData[0]);
    const lowest = chartData.reduce((min, d) => d.amount < min.amount ? d : min, chartData[0]);
    return { total, totalTenants, today, highest, lowest };
  }, [chartData]);

  const timeModeLabel = timeMode === "today" ? "Today" : timeMode === "tomorrow" ? "Tomorrow" : "Custom Range";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }} className="flex">
      <Card className="flex-1 flex flex-col border-slate-400 dark:border-slate-500" data-testid="card-collectable-trend">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Collectable Due – Date Wise</CardTitle>
              <p className="text-xs text-muted-foreground/80 mt-0.5">{timeModeLabel}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-full border border-border/50 overflow-visible">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs rounded-full h-7 px-2.5 ${timeMode === "today" ? "bg-primary/10 text-primary font-semibold" : ""}`}
                onClick={() => setTimeMode("today")}
                data-testid="button-trend-today"
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs rounded-full h-7 px-2.5 ${timeMode === "tomorrow" ? "bg-primary/10 text-primary font-semibold" : ""}`}
                onClick={() => setTimeMode("tomorrow")}
                data-testid="button-trend-tomorrow"
              >
                Tomorrow
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`text-xs rounded-full h-7 px-2.5 ${timeMode === "custom" ? "bg-primary/10 text-primary font-semibold" : ""}`}
                    onClick={() => setTimeMode("custom")}
                    data-testid="button-trend-custom"
                  >
                    <CalendarDays className="w-3 h-3 mr-1" />
                    Custom
                  </Button>
                </PopoverTrigger>
                {timeMode === "custom" && (
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="range"
                      selected={{ from: customRange.from, to: customRange.to }}
                      onSelect={(range: any) => {
                        setCustomRange({ from: range?.from, to: range?.to });
                      }}
                      numberOfMonths={1}
                    />
                    {customRange.from && (
                      <div className="px-3 pb-3 text-xs text-muted-foreground text-center">
                        {formatFullDate(toLocalDateString(customRange.from))}
                        {customRange.to ? ` – ${formatFullDate(toLocalDateString(customRange.to))}` : " – Select end date"}
                      </div>
                    )}
                  </PopoverContent>
                )}
              </Popover>
            </div>
            <div className="flex items-center rounded-full border border-border/50 overflow-visible">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs rounded-full h-7 px-2.5 toggle-elevate ${viewMode === "amount" ? "toggle-elevated bg-primary/10 text-primary font-semibold" : ""}`}
                onClick={() => setViewMode("amount")}
                data-testid="button-trend-amount-view"
              >
                <IndianRupee className="w-3 h-3 mr-0.5" />
                Amount
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs rounded-full h-7 px-2.5 toggle-elevate ${viewMode === "tenants" ? "toggle-elevated bg-primary/10 text-primary font-semibold" : ""}`}
                onClick={() => setViewMode("tenants")}
                data-testid="button-trend-tenant-view"
              >
                <Users className="w-3 h-3 mr-0.5" />
                Tenants
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 flex-1 flex flex-col gap-3">
          {isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-md" />)}
              </div>
              <Skeleton className="h-52 rounded-md" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-56 text-sm text-muted-foreground" data-testid="text-collectable-trend-empty">
              No data available for selected period
            </div>
          ) : (
            <>
              {kpis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="kpi-row-collectable-trend">
                  <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/50 dark:border-emerald-800/30 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold mb-0.5">Total</p>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300" data-testid="text-kpi-total">
                      {viewMode === "amount" ? formatFullCurrency(kpis.total) : `${kpis.totalTenants} tenants`}
                    </p>
                  </div>
                  <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/30 p-2.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <CalendarDays className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold">Today</p>
                    </div>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-300" data-testid="text-kpi-today">
                      {kpis.today ? (viewMode === "amount" ? formatCurrency(kpis.today.amount) : kpis.today.tenantCount) : "–"}
                    </p>
                    {kpis.today && <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">{formatDateLabel(kpis.today.date)}</p>}
                  </div>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30 p-2.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <ArrowUp className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">Highest</p>
                    </div>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300" data-testid="text-kpi-highest">
                      {viewMode === "amount" ? formatCurrency(kpis.highest.amount) : kpis.highest.tenantCount}
                    </p>
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70">{formatDateLabel(kpis.highest.date)}</p>
                  </div>
                  <div className="rounded-md bg-violet-50 dark:bg-violet-900/20 border border-violet-200/50 dark:border-violet-800/30 p-2.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <ArrowDown className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                      <p className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400 font-semibold">Lowest</p>
                    </div>
                    <p className="text-sm font-bold text-violet-700 dark:text-violet-300" data-testid="text-kpi-lowest">
                      {viewMode === "amount" ? formatCurrency(kpis.lowest.amount) : kpis.lowest.tenantCount}
                    </p>
                    <p className="text-[10px] text-violet-600/70 dark:text-violet-400/70">{formatDateLabel(kpis.lowest.date)}</p>
                  </div>
                </div>
              )}

              <div className="h-56 sm:h-64" data-testid="chart-collectable-trend">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} onClick={(e: any) => { if (e?.activePayload?.[0]?.payload?.date && onDateClick) { onDateClick(e.activePayload[0].payload.date); } }} style={{ cursor: onDateClick ? "pointer" : undefined }}>
                    <defs>
                      <linearGradient id="collectableGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDateLabel}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={viewMode === "amount" ? (v: number) => formatCurrency(v) : (v: number) => String(v)}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={55}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as TrendDataPoint;
                        return (
                          <div className="bg-popover border border-border rounded-md shadow-md p-2.5 text-xs space-y-1">
                            <p className="font-semibold text-foreground">{formatFullDate(d.date)}</p>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <IndianRupee className="w-3 h-3" />
                              <span>Collectable: <span className="font-semibold text-foreground">{formatFullCurrency(d.amount)}</span></span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <Users className="w-3 h-3" />
                              <span>Tenants: <span className="font-semibold text-foreground">{d.tenantCount}</span></span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={viewMode === "amount" ? "amount" : "tenantCount"}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      fill="url(#collectableGradient)"
                      dot={chartData.length <= 7 ? { r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "hsl(var(--background))" } : false}
                      activeDot={{ r: 5, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
