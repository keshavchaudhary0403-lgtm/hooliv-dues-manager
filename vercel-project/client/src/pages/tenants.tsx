import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, MapPin, Building2, Phone, Eye, Download, CalendarClock, CalendarDays, Filter, Upload, ChevronLeft, ChevronRight, X, Flag, AlertTriangle, ShieldAlert, IndianRupee, RefreshCw, LogOut, SlidersHorizontal, Check, Wallet, Users, ChevronsUpDown } from "lucide-react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { TenantDetailDrawer } from "@/components/tenant-detail-drawer";
import { useAuth } from "@/components/auth-provider";
import { exportTenantsCsv } from "@/lib/apiAdapter";
import type { Tenant } from "@shared/schema";

type EnrichedTenant = Tenant & { latestFollowUpDate: string | null; missedCommitment?: boolean; rentalBillingCycle?: string | null; checkoutNoticeDate?: string | null; expectedCheckoutDate?: string | null; masterFlagScore?: number; masterFlagLevel?: "critical" | "warning" | "none" };

interface PaginatedResponse {
  items: EnrichedTenant[];
  total: number;
  totalDueAmount?: number;
  page: number;
  pageSize: number;
  escalationSummary?: { totalValueAtRisk: number; escalatedCount: number };
  masterFlagActive?: boolean;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function getDaysOverdue(dueDate: string | null, paymentStatus: string): number | null {
  if (paymentStatus === "paid" || paymentStatus === "already_paid" || paymentStatus === "refund_adjustment" || paymentStatus === "payment_not_updated") return 0;
  if (!dueDate) return null;
  const diff = Math.floor((new Date().getTime() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function getFlagLevel(daysDiff: number, orangeThreshold: number, redThreshold: number): "none" | "warning" | "critical" {
  if (daysDiff >= redThreshold) return "critical";
  if (daysDiff >= orangeThreshold) return "warning";
  return "none";
}

function StatusIcon({ level, size = "sm" }: { level: "warning" | "critical"; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-3.5 h-3.5 flex-shrink-0" : "w-4 h-4 flex-shrink-0";
  if (level === "warning") return <AlertTriangle className={`${cls} text-orange-600 dark:text-orange-400`} aria-label="Warning" />;
  return <ShieldAlert className={`${cls} text-red-600 dark:text-red-400`} aria-label="Critical" />;
}

function getDueAgingDisplay(dueDate: string | null, paymentStatus: string, thresholds?: AllFlagThresholds) {
  if (paymentStatus === "paid" || paymentStatus === "already_paid" || paymentStatus === "refund_adjustment" || paymentStatus === "payment_not_updated") {
    return <span className="text-sm text-muted-foreground">&mdash;</span>;
  }
  if (!dueDate) return <span className="text-sm font-medium text-foreground/80">No date</span>;
  const diff = getDaysOverdue(dueDate, paymentStatus);
  if (diff === null) return null;
  if (diff <= 0) return <span className="text-sm font-medium text-foreground/80">Not due</span>;
  const level = thresholds ? getFlagLevel(diff, thresholds.orangeFlagDays, thresholds.redFlagDays) : (diff > 15 ? "critical" : diff > 7 ? "warning" : "none");
  if (level === "critical") return <span className="flex items-center gap-1 text-sm font-semibold"><StatusIcon level="critical" />{diff} Days</span>;
  if (level === "warning") return <span className="flex items-center gap-1 text-sm font-semibold"><StatusIcon level="warning" />{diff} Days</span>;
  return <span className="text-sm font-semibold text-foreground">{diff} Days</span>;
}

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

function getStatusBadge(status: string) {
  const label = STATUS_LABELS[status] || status;
  const sizeClass = "text-[11px] md:text-[10px]";
  switch (status) {
    case "paid":
    case "already_paid":
      return <Badge variant="secondary" className={`${sizeClass} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    case "partial_payment":
      return <Badge variant="secondary" className={`${sizeClass} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    case "not_responding":
      return <Badge variant="secondary" className={`${sizeClass} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    case "no_update":
      return <Badge variant="secondary" className={`${sizeClass} bg-slate-200 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    case "refund_adjustment":
      return <Badge variant="secondary" className={`${sizeClass} bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    case "payment_not_updated":
      return <Badge variant="secondary" className={`${sizeClass} bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
    default:
      return <Badge variant="secondary" className={`${sizeClass} bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border-0 shadow-sm rounded-lg`}>{label}</Badge>;
  }
}

function formatFollowUpDate(date: string | null) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return date;
  }
}

type SortField = "latestActivity" | "tenantName" | "totalAmountDue" | "dueDate" | "daysOverdue" | "latestFollowUpDate";
type SortDir = "asc" | "desc";

const DEFAULT_SORT_FIELD: SortField = "totalAmountDue";
const DEFAULT_SORT_DIR: SortDir = "desc";
const LS_KEY = "hooliv_tenants_view_state";

interface SavedViewState {
  cityFilter?: string | string[];
  propertyFilter?: string | string[];
  statusFilter?: string;
  followUpFilter?: string;
  flagOverdueFilter?: string;
  flagDueDateFilter?: string;
  flagFollowUpFilter?: string;
  billingCycleFilter?: string | string[];
  checkoutNoticeOn?: boolean;
  masterEscalationOn?: boolean;
  escalationLevel?: string;
  sortField?: SortField;
  sortDir?: SortDir;
  page?: number;
  search?: string;
  amountAbove?: string;
  amountBelow?: string;
}

function loadSavedState(): SavedViewState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveViewState(state: SavedViewState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

interface AllFlagThresholds {
  orangeFlagDays: number;
  redFlagDays: number;
  dueDateOrangeFlagDays: number;
  dueDateRedFlagDays: number;
  followUpOrangeFlagDays: number;
  followUpRedFlagDays: number;
}


function getMasterFlagIcon(level: "critical" | "warning" | "none" | undefined) {
  if (!level || level === "none") return null;
  if (level === "critical") return <Flag className="w-4 h-4 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400 flex-shrink-0" aria-label="Critical risk" />;
  return <Flag className="w-4 h-4 text-orange-500 dark:text-orange-400 fill-orange-500 dark:fill-orange-400 flex-shrink-0" aria-label="Warning risk" />;
}

function getDueDateFlag(dueDate: string | null, paymentStatus: string, thresholds: AllFlagThresholds | undefined) {
  if (!thresholds) return null;
  if (paymentStatus === "paid" || paymentStatus === "already_paid" || paymentStatus === "refund_adjustment" || paymentStatus === "payment_not_updated") return null;
  if (!dueDate) return null;
  const diff = Math.floor((new Date().getTime() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return null;
  const level = getFlagLevel(diff, thresholds.dueDateOrangeFlagDays, thresholds.dueDateRedFlagDays);
  if (level === "none") return null;
  return <span data-testid={`flag-due-date-${level === "critical" ? "red" : "orange"}`}><StatusIcon level={level} /></span>;
}

function getFollowUpFlag(followUpDate: string | null, thresholds: AllFlagThresholds | undefined) {
  if (!thresholds) return null;
  if (!followUpDate) return null;
  const diff = Math.floor((new Date().getTime() - new Date(followUpDate).getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return null;
  const level = getFlagLevel(diff, thresholds.followUpOrangeFlagDays, thresholds.followUpRedFlagDays);
  if (level === "none") return null;
  return <span data-testid={`flag-follow-up-${level === "critical" ? "red" : "orange"}`}><StatusIcon level={level} /></span>;
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function TenantsPage() {
  const { permissions } = useAuth();

  const [location] = useLocation();
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [location]);
  const saved = useMemo(() => loadSavedState(), []);
  const hasUrlParams = urlParams.toString().length > 0;
  const fromDashboard = urlParams.get("from") === "dashboard";

  const initialCity = (() => {
    const urlCity = urlParams.get("city");
    if (urlCity) return urlCity === "all" ? [] : urlCity.split(",");
    if (hasUrlParams) return [];
    const savedCity = saved?.cityFilter;
    if (savedCity && Array.isArray(savedCity)) return savedCity as string[];
    if (savedCity && savedCity !== "all") return [savedCity as string];
    return [];
  })();
  const initialEscalation = urlParams.get("escalation") || (fromDashboard ? "" : "");
  const initialStatus = urlParams.get("status") || (hasUrlParams ? "all" : saved?.statusFilter || "all");
  const initialProperty = (() => {
    const urlProp = urlParams.get("property");
    if (urlProp) return urlProp === "all" ? [] : urlProp.split(",");
    if (hasUrlParams) return [];
    const savedProp = saved?.propertyFilter;
    if (savedProp && Array.isArray(savedProp)) return savedProp as string[];
    if (savedProp && savedProp !== "all") return [savedProp as string];
    return [];
  })();
  const initialFollowUp = fromDashboard ? "all" : (urlParams.get("followUp") || (hasUrlParams ? "all" : saved?.followUpFilter || "all"));
  const initialFlagOverdue = fromDashboard ? "all" : (urlParams.get("flagOverdue") || (hasUrlParams ? "all" : saved?.flagOverdueFilter || "all"));
  const initialFlagDueDate = fromDashboard ? "all" : (urlParams.get("flagDueDate") || (hasUrlParams ? "all" : saved?.flagDueDateFilter || "all"));
  const initialFlagFollowUp = fromDashboard ? "all" : (urlParams.get("flagFollowUp") || (hasUrlParams ? "all" : saved?.flagFollowUpFilter || "all"));

  const [search, setSearch] = useState(fromDashboard ? "" : (hasUrlParams ? "" : saved?.search || ""));
  const debouncedSearch = useDebounce(search, 300);
  const [cityFilter, setCityFilter] = useState<string[]>(initialCity);
  const [propertyFilter, setPropertyFilter] = useState<string[]>(initialProperty);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [followUpFilter, setFollowUpFilter] = useState(initialFollowUp);
  const [flagOverdueFilter, setFlagOverdueFilter] = useState(initialFlagOverdue);
  const [flagDueDateFilter, setFlagDueDateFilter] = useState(initialFlagDueDate);
  const [flagFollowUpFilter, setFlagFollowUpFilter] = useState(initialFlagFollowUp);
  const [amountAbove, setAmountAbove] = useState(fromDashboard ? "" : (hasUrlParams ? "" : saved?.amountAbove || ""));
  const [amountBelow, setAmountBelow] = useState(fromDashboard ? "" : (hasUrlParams ? "" : saved?.amountBelow || ""));
  const debouncedAmountAbove = useDebounce(amountAbove, 300);
  const debouncedAmountBelow = useDebounce(amountBelow, 300);
  const initialCycle = (() => {
    const urlCycle = urlParams.get("cycle");
    if (urlCycle) return urlCycle === "all" ? [] : urlCycle.split(",");
    if (fromDashboard || hasUrlParams) return [];
    const savedCycle = saved?.billingCycleFilter;
    if (savedCycle && Array.isArray(savedCycle)) return savedCycle as string[];
    if (savedCycle && savedCycle !== "all") return [savedCycle as string];
    return [];
  })();
  const [billingCycleFilter, setBillingCycleFilter] = useState<string[]>(initialCycle);
  const [checkoutNoticeOn, setCheckoutNoticeOn] = useState(fromDashboard ? false : (hasUrlParams ? false : saved?.checkoutNoticeOn || false));
  const [masterEscalationOn, setMasterEscalationOn] = useState(fromDashboard ? false : (initialEscalation ? true : (hasUrlParams ? false : saved?.masterEscalationOn || false)));
  const [escalationLevel, setEscalationLevel] = useState(fromDashboard ? "all" : (initialEscalation === "critical" ? "critical" : initialEscalation === "warning" ? "warning" : initialEscalation === "healthy" ? "healthy" : (hasUrlParams ? "all" : saved?.escalationLevel || "all")));
  const [collectableDate, setCollectableDate] = useState(fromDashboard ? (urlParams.get("collectableDate") || "") : "");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isDashboard = params.get("from") === "dashboard";
    const urlCity = params.get("city");
    const urlEscalation = params.get("escalation");
    const urlStatus = params.get("status");
    const urlProperty = params.get("property");
    const urlFollowUp = params.get("followUp");
    const urlFlagOverdue = params.get("flagOverdue");
    const urlFlagDueDate = params.get("flagDueDate");
    const urlFlagFollowUp = params.get("flagFollowUp");
    const urlCollectableDate = params.get("collectableDate");
    if (isDashboard) {
      setCityFilter(urlCity ? (urlCity === "all" ? [] : urlCity.split(",")) : []);
      setPropertyFilter(urlProperty ? (urlProperty === "all" ? [] : urlProperty.split(",")) : []);
      setStatusFilter(urlStatus || "all");
      setFollowUpFilter(urlFollowUp || "all");
      setFlagOverdueFilter(urlFlagOverdue || "all");
      setFlagDueDateFilter(urlFlagDueDate || "all");
      setFlagFollowUpFilter(urlFlagFollowUp || "all");
      setCollectableDate(urlCollectableDate || "");
      setSearch("");
      setAmountAbove("");
      setAmountBelow("");
      setBillingCycleFilter([]);
      setCheckoutNoticeOn(false);
      if (urlEscalation) {
        setMasterEscalationOn(true);
        setEscalationLevel(urlEscalation === "critical" ? "critical" : urlEscalation === "warning" ? "warning" : urlEscalation === "healthy" ? "healthy" : "all");
      } else {
        setMasterEscalationOn(false);
        setEscalationLevel("all");
      }
      setSortField(DEFAULT_SORT_FIELD);
      setSortDir(DEFAULT_SORT_DIR);
      setDraftStatus(urlStatus || "all");
      setDraftFollowUp(urlFollowUp || "all");
      setDraftFlagOverdue(urlFlagOverdue || "all");
      setDraftFlagDueDate(urlFlagDueDate || "all");
      setDraftFlagFollowUp(urlFlagFollowUp || "all");
      setDraftAmountAbove("");
      setDraftAmountBelow("");
    } else {
      if (urlCity) setCityFilter(urlCity === "all" ? [] : urlCity.split(","));
      if (urlProperty) setPropertyFilter(urlProperty === "all" ? [] : urlProperty.split(","));
      if (urlStatus) setStatusFilter(urlStatus);
      if (urlFollowUp) setFollowUpFilter(urlFollowUp);
      if (urlFlagOverdue) setFlagOverdueFilter(urlFlagOverdue);
      if (urlFlagDueDate) setFlagDueDateFilter(urlFlagDueDate);
      if (urlFlagFollowUp) setFlagFollowUpFilter(urlFlagFollowUp);
      if (urlEscalation) {
        setMasterEscalationOn(true);
        setEscalationLevel(urlEscalation === "critical" ? "critical" : urlEscalation === "warning" ? "warning" : urlEscalation === "healthy" ? "healthy" : "all");
      }
    }
  }, [location]);

  const [sortField, setSortField] = useState<SortField>(hasUrlParams ? DEFAULT_SORT_FIELD : (saved?.sortField as SortField) || DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<SortDir>(hasUrlParams ? DEFAULT_SORT_DIR : (saved?.sortDir as SortDir) || DEFAULT_SORT_DIR);

  const isNonDefaultSort = sortField !== DEFAULT_SORT_FIELD || sortDir !== DEFAULT_SORT_DIR;
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [selectedTenantSnapshot, setSelectedTenantSnapshot] = useState<EnrichedTenant | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState("all");
  const [draftFollowUp, setDraftFollowUp] = useState("all");
  const [draftFlagOverdue, setDraftFlagOverdue] = useState("all");
  const [draftFlagDueDate, setDraftFlagDueDate] = useState("all");
  const [draftFlagFollowUp, setDraftFlagFollowUp] = useState("all");
  const [draftAmountAbove, setDraftAmountAbove] = useState("");
  const [draftAmountBelow, setDraftAmountBelow] = useState("");
  const [touchedCardId, setTouchedCardId] = useState<number | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTouchTimer = useCallback(() => { if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; } }, []);
  useEffect(() => () => clearTouchTimer(), [clearTouchTimer]);
  const handleCardPointerDown = useCallback((id: number, e: React.PointerEvent) => {
    clearTouchTimer();
    setTouchedCardId(id);
    if (e.pointerType === "touch") {
      touchTimerRef.current = setTimeout(() => setTouchedCardId(null), 2000);
    }
  }, [clearTouchTimer]);
  const handleCardPointerUp = useCallback((e: React.PointerEvent) => {
    clearTouchTimer();
    if (e.pointerType === "touch") {
      touchTimerRef.current = setTimeout(() => setTouchedCardId(null), 250);
    } else {
      setTouchedCardId(null);
    }
  }, [clearTouchTimer]);
  const handleCardPointerCancel = useCallback(() => {
    clearTouchTimer();
    touchTimerRef.current = setTimeout(() => setTouchedCardId(null), 150);
  }, [clearTouchTimer]);
  const handleCardPointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") {
      setTouchedCardId(null);
    }
  }, []);
  const [page, setPage] = useState(hasUrlParams ? 1 : saved?.page || 1);
  const pageSize = 50;

  useEffect(() => { setPage(1); }, [debouncedSearch, cityFilter, propertyFilter, statusFilter, followUpFilter, flagOverdueFilter, flagDueDateFilter, flagFollowUpFilter, debouncedAmountAbove, debouncedAmountBelow, billingCycleFilter, checkoutNoticeOn, masterEscalationOn, escalationLevel, collectableDate, sortField, sortDir]);

  useEffect(() => {
    saveViewState({
      cityFilter, propertyFilter, statusFilter, followUpFilter,
      flagOverdueFilter, flagDueDateFilter, flagFollowUpFilter,
      billingCycleFilter, checkoutNoticeOn, masterEscalationOn, escalationLevel,
      sortField, sortDir, page, search, amountAbove, amountBelow,
    });
  }, [cityFilter, propertyFilter, statusFilter, followUpFilter, flagOverdueFilter, flagDueDateFilter, flagFollowUpFilter, billingCycleFilter, checkoutNoticeOn, masterEscalationOn, escalationLevel, sortField, sortDir, page, search, amountAbove, amountBelow]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    if (debouncedSearch) p.set("search", debouncedSearch);
    const realCities = cityFilter.filter(x => x !== "__none__");
    if (realCities.length > 0) p.set("city", realCities.join(","));
    const realProps = propertyFilter.filter(x => x !== "__none__");
    if (realProps.length > 0) p.set("property", realProps.join(","));
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (followUpFilter !== "all") p.set("followUp", followUpFilter);
    if (flagOverdueFilter !== "all") p.set("flagOverdue", flagOverdueFilter);
    if (flagDueDateFilter !== "all") p.set("flagDueDate", flagDueDateFilter);
    if (flagFollowUpFilter !== "all") p.set("flagFollowUp", flagFollowUpFilter);
    if (debouncedAmountAbove) p.set("amountAbove", debouncedAmountAbove);
    if (debouncedAmountBelow) p.set("amountBelow", debouncedAmountBelow);
    const realCycles = billingCycleFilter.filter(x => x !== "__none__");
    if (realCycles.length > 0) p.set("billingCycle", realCycles.join(","));
    if (checkoutNoticeOn) p.set("hasCheckoutNotice", "yes");
    if (masterEscalationOn) p.set("masterEscalation", escalationLevel);
    if (collectableDate) p.set("collectableDate", collectableDate);
    p.set("sortField", sortField);
    p.set("sortDir", sortDir);
    return p.toString();
  }, [page, pageSize, debouncedSearch, cityFilter, propertyFilter, statusFilter, followUpFilter, flagOverdueFilter, flagDueDateFilter, flagFollowUpFilter, debouncedAmountAbove, debouncedAmountBelow, billingCycleFilter, checkoutNoticeOn, masterEscalationOn, escalationLevel, collectableDate, sortField, sortDir]);

  const { data: paginatedData, isLoading, isFetching } = useQuery<PaginatedResponse>({
    queryKey: ["/api/tenants", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/tenants?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch tenants");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const tenants = paginatedData?.items || [];
  const totalTenants = paginatedData?.total || 0;
  const totalPages = Math.ceil(totalTenants / pageSize);
  const escalationSummary = paginatedData?.escalationSummary;
  const masterFlagActive = paginatedData?.masterFlagActive ?? false;

  const { data: uploadHistory = [] } = useQuery<any[]>({ queryKey: ["/api/upload-history"] });
  const hasUploads = uploadHistory.length > 0;

  const { data: flagThresholds } = useQuery<AllFlagThresholds>({
    queryKey: ["/api/settings/flag-thresholds"],
  });

  const { data: filterOptions } = useQuery<{ cities: string[]; properties: string[]; cityPropertyMap: Record<string, string[]>; billingCycles: string[] }>({
    queryKey: ["/api/tenants/filter-options"],
  });

  const cities = filterOptions?.cities || [];
  const billingCycles = filterOptions?.billingCycles || [];
  const properties = useMemo(() => {
    if (!filterOptions) return [];
    if (cityFilter.length === 0) return filterOptions.properties;
    const combined = new Set<string>();
    for (const c of cityFilter.filter(x => x !== "__none__")) {
      for (const p of (filterOptions.cityPropertyMap[c] || [])) combined.add(p);
    }
    return Array.from(combined).sort();
  }, [filterOptions, cityFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        if (field !== DEFAULT_SORT_FIELD || sortDir !== DEFAULT_SORT_DIR) {
          setSortField(DEFAULT_SORT_FIELD);
          setSortDir(DEFAULT_SORT_DIR);
        } else {
          setSortDir("asc");
        }
      }
    } else {
      if (field === DEFAULT_SORT_FIELD) {
        setSortField(DEFAULT_SORT_FIELD);
        setSortDir(DEFAULT_SORT_DIR);
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    }
  };

  const secondaryFilterCount = [
    statusFilter !== "all",
    followUpFilter !== "all",
    flagOverdueFilter !== "all",
    flagDueDateFilter !== "all",
    flagFollowUpFilter !== "all",
    !!amountAbove,
    !!amountBelow,
  ].filter(Boolean).length;

  const activeFilterCount = [
    cityFilter.length > 0,
    propertyFilter.length > 0,
    statusFilter !== "all",
    followUpFilter !== "all",
    flagOverdueFilter !== "all",
    flagDueDateFilter !== "all",
    flagFollowUpFilter !== "all",
    billingCycleFilter.length > 0,
    checkoutNoticeOn,
    masterEscalationOn,
    !!collectableDate,
    debouncedSearch.length > 0,
    !!amountAbove,
    !!amountBelow,
    isNonDefaultSort,
  ].filter(Boolean).length;

  const handleExport = () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    const exportCities = cityFilter.filter(x => x !== "__none__");
    if (exportCities.length > 0) params.set("city", exportCities.join(","));
    const realExportProps = propertyFilter.filter(x => x !== "__none__");
    if (realExportProps.length > 0) params.set("property", realExportProps.join(","));
    if (statusFilter !== "all") params.set("status", statusFilter);
    const exportCycles = billingCycleFilter.filter(x => x !== "__none__");
    if (exportCycles.length > 0) params.set("billingCycle", exportCycles.join(","));
    if (checkoutNoticeOn) params.set("hasCheckoutNotice", "yes");
    if (masterEscalationOn) params.set("masterEscalation", escalationLevel);
    // fetch() can't be intercepted for window.open, so build the CSV client-side.
    exportTenantsCsv(params.toString()).catch((err) => {
      console.error("Export failed:", err);
    });
  };

  const selectedTenantFromList = tenants.find((t) => t.id === selectedTenantId);
  const selectedTenant = selectedTenantFromList || selectedTenantSnapshot;
  useEffect(() => {
    if (selectedTenantFromList) setSelectedTenantSnapshot(selectedTenantFromList);
  }, [selectedTenantFromList]);

  const SortIcon = ({ field }: { field: SortField }) => {
    const isActive = sortField === field;
    if (isActive && sortDir === "asc") return <ArrowUp className="w-3 h-3 text-amber-300" />;
    if (isActive && sortDir === "desc") return <ArrowDown className="w-3 h-3 text-amber-300" />;
    return <ArrowUpDown className="w-3 h-3 text-white/50" />;
  };

  if (isLoading && !paginatedData) {
    return (
      <div className="px-4 md:px-8 py-6 space-y-5">
        <Skeleton className="h-10 w-64 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (!hasUploads && totalTenants === 0) {
    return (
      <div className="px-4 md:px-8 py-6 mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <div className="w-20 h-20 rounded-3xl glass-card flex items-center justify-center">
            <Upload className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold" data-testid="text-no-data-tenants">No tenant data uploaded yet</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload your CRM dump to start collecting payments and managing tenant dues.
            </p>
          </div>
          <Link href="/upload">
            <Button className="shadow-lg shadow-emerald-500/20 rounded-full px-6" data-testid="button-go-upload-tenants">
              <Upload className="w-4 h-4 mr-2" />
              Upload Data
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const getRowColors = (status: string, isEven: boolean) => {
    const zebra = isEven ? "zebra-row-even" : "zebra-row-odd";
    switch (status) {
      case "paid":
      case "already_paid":
        return {
          bg: `${zebra} bg-emerald-50/60 dark:bg-emerald-950/15`,
          hover: "row-hover-emerald"
        };
      case "partial_payment":
        return {
          bg: `${zebra} bg-amber-50/60 dark:bg-amber-950/15`,
          hover: "row-hover-amber"
        };
      case "not_responding":
        return {
          bg: `${zebra} bg-red-50/60 dark:bg-red-950/15`,
          hover: "row-hover-red"
        };
      case "no_update":
        return {
          bg: zebra,
          hover: "row-hover-slate"
        };
      case "refund_adjustment":
        return {
          bg: `${zebra} bg-violet-50/60 dark:bg-violet-950/15`,
          hover: "row-hover-sky"
        };
      case "payment_not_updated":
        return {
          bg: `${zebra} bg-pink-50/60 dark:bg-pink-950/15`,
          hover: "row-hover-sky"
        };
      default:
        return {
          bg: `${zebra} bg-sky-50/60 dark:bg-sky-950/15`,
          hover: "row-hover-sky"
        };
    }
  };

  const getMobileCardColors = (status: string, isActive: boolean) => {
    if (isActive) {
      switch (status) {
        case "paid":
        case "already_paid":
          return "bg-emerald-200 dark:bg-emerald-900/50 border border-emerald-400 dark:border-emerald-600";
        case "partial_payment":
          return "bg-amber-200 dark:bg-amber-900/50 border border-amber-400 dark:border-amber-600";
        case "not_responding":
          return "bg-red-200 dark:bg-red-900/50 border border-red-400 dark:border-red-600";
        case "no_update":
          return "bg-slate-200 dark:bg-slate-900/50 border border-slate-400 dark:border-slate-600";
        case "refund_adjustment":
          return "bg-violet-200 dark:bg-violet-900/50 border border-violet-400 dark:border-violet-600";
        case "payment_not_updated":
          return "bg-pink-200 dark:bg-pink-900/50 border border-pink-400 dark:border-pink-600";
        default:
          return "bg-sky-200 dark:bg-sky-900/50 border border-sky-400 dark:border-sky-600";
      }
    }
    switch (status) {
      case "paid":
      case "already_paid":
        return "bg-emerald-50 dark:bg-emerald-950/15";
      case "partial_payment":
        return "bg-amber-50 dark:bg-amber-950/15";
      case "not_responding":
        return "bg-red-50 dark:bg-red-950/15";
      case "no_update":
        return "bg-white dark:bg-slate-950/15";
      case "refund_adjustment":
        return "bg-violet-50 dark:bg-violet-950/15";
      case "payment_not_updated":
        return "bg-pink-50 dark:bg-pink-950/15";
      default:
        return "bg-sky-50 dark:bg-sky-950/15";
    }
  };

  return (
    <div className="px-4 md:px-6 py-6 space-y-5 w-full">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="shrink-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tenants-title">Collect Payments</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalTenants} tenants &middot; Page {page} of {totalPages || 1}
            </p>
            {activeFilterCount > 0 && (
              <p className="text-xs text-primary font-medium mt-0.5" data-testid="text-active-filters">
                {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
              </p>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-wrap justify-end">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-[130px] rounded-full justify-start ${cityFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                  data-testid="select-city-filter-tenants"
                >
                  <MapPin className={`w-3.5 h-3.5 mr-1 shrink-0 ${cityFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
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
                    data-testid="button-select-all-cities-tenants"
                  >
                    {cityFilter.length === 0 ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                {cities.map((c) => (
                  <label
                    key={c}
                    className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                    data-testid={`checkbox-city-tenants-${c}`}
                  >
                    <Checkbox
                      checked={cityFilter.length === 0 || cityFilter.includes(c)}
                      onCheckedChange={(checked) => {
                        if (cityFilter.length === 0) {
                          setCityFilter(cities.filter(x => x !== c));
                        } else if (checked) {
                          const next = [...cityFilter.filter(x => x !== "__none__"), c];
                          setCityFilter(next.length === cities.length ? [] : next);
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
                  className={`w-[145px] rounded-full justify-start ${propertyFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                  data-testid="select-property-filter-tenants"
                >
                  <Building2 className={`w-3.5 h-3.5 mr-1 shrink-0 ${propertyFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
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
                    data-testid="button-select-all-properties-tenants"
                  >
                    {propertyFilter.length === 0 ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                {properties.map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                    data-testid={`checkbox-property-tenants-${p}`}
                  >
                    <Checkbox
                      checked={propertyFilter.length === 0 || propertyFilter.includes(p)}
                      onCheckedChange={(checked) => {
                        if (propertyFilter.length === 0) {
                          setPropertyFilter(properties.filter(x => x !== p));
                        } else if (checked) {
                          const next = [...propertyFilter.filter(x => x !== "__none__"), p];
                          setPropertyFilter(next.length === properties.length ? [] : next);
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
            {billingCycles.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`w-[130px] rounded-full justify-start ${billingCycleFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                    data-testid="select-billing-cycle-filter"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 shrink-0 ${billingCycleFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="truncate text-xs">
                      {billingCycleFilter.length === 0 ? "All Cycles" :
                       (billingCycleFilter.length === 1 && billingCycleFilter[0] === "__none__") ? "No Cycles" :
                       billingCycleFilter.filter(x => x !== "__none__").length === 1 ? billingCycleFilter.filter(x => x !== "__none__")[0] :
                       `${billingCycleFilter.filter(x => x !== "__none__").length} Cycles`}
                    </span>
                    <ChevronsUpDown className="w-3.5 h-3.5 ml-auto shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-2 max-h-[300px] overflow-auto" align="start">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs font-medium text-muted-foreground">Billing Cycles</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto py-0.5 px-1.5"
                      onClick={() => setBillingCycleFilter(billingCycleFilter.length === 0 ? ["__none__"] : [])}
                      data-testid="button-select-all-cycles"
                    >
                      {billingCycleFilter.length === 0 ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                  {billingCycles.map((c) => (
                    <label
                      key={c}
                      className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                      data-testid={`checkbox-cycle-${c}`}
                    >
                      <Checkbox
                        checked={billingCycleFilter.length === 0 || billingCycleFilter.includes(c)}
                        onCheckedChange={(checked) => {
                          if (billingCycleFilter.length === 0) {
                            setBillingCycleFilter(billingCycles.filter(x => x !== c));
                          } else if (checked) {
                            const next = [...billingCycleFilter.filter(x => x !== "__none__"), c];
                            setBillingCycleFilter(next.length === billingCycles.length ? [] : next);
                          } else {
                            const next = billingCycleFilter.filter(x => x !== c && x !== "__none__");
                            setBillingCycleFilter(next.length === 0 ? ["__none__"] : next);
                          }
                        }}
                      />
                      <span className="truncate">{c}</span>
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <div className="flex items-center gap-1.5">
              <Switch
                checked={checkoutNoticeOn}
                onCheckedChange={setCheckoutNoticeOn}
                data-testid="switch-checkout-notice"
              />
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer" onClick={() => setCheckoutNoticeOn(!checkoutNoticeOn)}>
                Checkout Notice
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch
                checked={masterEscalationOn}
                onCheckedChange={(v) => { setMasterEscalationOn(v); if (!v) setEscalationLevel("all"); }}
                className="data-[state=checked]:bg-rose-600"
                data-testid="switch-master-escalation"
              />
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer" onClick={() => { setMasterEscalationOn(!masterEscalationOn); if (masterEscalationOn) setEscalationLevel("all"); }}>
                Escalation
              </label>
            </div>
            {masterEscalationOn && (
              <Select value={escalationLevel} onValueChange={setEscalationLevel}>
                <SelectTrigger className="w-[140px] rounded-full border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs" data-testid="select-escalation-level">
                  <SelectValue placeholder="Escalation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Escalations</SelectItem>
                  <SelectItem value="critical">Critical Only</SelectItem>
                  <SelectItem value="warning">Warning Only</SelectItem>
                  <SelectItem value="healthy">Healthy Only</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="sm:hidden space-y-2">
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`flex-1 rounded-full justify-start ${cityFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                    data-testid="select-city-filter-tenants-mobile"
                  >
                    <MapPin className={`w-3.5 h-3.5 mr-1 shrink-0 ${cityFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
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
                      data-testid="button-select-all-cities-tenants-mobile"
                    >
                      {cityFilter.length === 0 ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                  {cities.map((c) => (
                    <label
                      key={c}
                      className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                      data-testid={`checkbox-city-tenants-mobile-${c}`}
                    >
                      <Checkbox
                        checked={cityFilter.length === 0 || cityFilter.includes(c)}
                        onCheckedChange={(checked) => {
                          if (cityFilter.length === 0) {
                            setCityFilter(cities.filter(x => x !== c));
                          } else if (checked) {
                            const next = [...cityFilter.filter(x => x !== "__none__"), c];
                            setCityFilter(next.length === cities.length ? [] : next);
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
                    className={`flex-1 rounded-full justify-start ${propertyFilter.length > 0 ? "border-primary bg-primary/10" : "border-border/50 bg-transparent"}`}
                    data-testid="select-property-filter-tenants-mobile"
                  >
                    <Building2 className={`w-3.5 h-3.5 mr-1 shrink-0 ${propertyFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
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
                      data-testid="button-select-all-properties-tenants-mobile"
                    >
                      {propertyFilter.length === 0 ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                  {properties.map((p) => (
                    <label
                      key={p}
                      className="flex items-center gap-2 px-1 py-1.5 rounded-md hover-elevate cursor-pointer text-xs"
                      data-testid={`checkbox-property-tenants-mobile-${p}`}
                    >
                      <Checkbox
                        checked={propertyFilter.length === 0 || propertyFilter.includes(p)}
                        onCheckedChange={(checked) => {
                          if (propertyFilter.length === 0) {
                            setPropertyFilter(properties.filter(x => x !== p));
                          } else if (checked) {
                            const next = [...propertyFilter.filter(x => x !== "__none__"), p];
                            setPropertyFilter(next.length === properties.length ? [] : next);
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
            </div>
            <div className="flex items-center gap-3 justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={checkoutNoticeOn}
                    onCheckedChange={setCheckoutNoticeOn}
                    data-testid="switch-checkout-notice-mobile"
                  />
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer" onClick={() => setCheckoutNoticeOn(!checkoutNoticeOn)}>
                    Checkout
                  </label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={masterEscalationOn}
                    onCheckedChange={(v) => { setMasterEscalationOn(v); if (!v) setEscalationLevel("all"); }}
                    className="data-[state=checked]:bg-rose-600"
                    data-testid="switch-master-escalation-mobile"
                  />
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap cursor-pointer" onClick={() => { setMasterEscalationOn(!masterEscalationOn); if (masterEscalationOn) setEscalationLevel("all"); }}>
                    Escalation
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {masterEscalationOn && (
                  <Select value={escalationLevel} onValueChange={setEscalationLevel}>
                    <SelectTrigger className="w-[120px] rounded-full border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs" data-testid="select-escalation-level-mobile">
                      <SelectValue placeholder="Escalation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Escalations</SelectItem>
                      <SelectItem value="critical">Critical Only</SelectItem>
                      <SelectItem value="warning">Warning Only</SelectItem>
                      <SelectItem value="healthy">Healthy Only</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {permissions.canExportData && (
            <Button onClick={handleExport} className="rounded-full font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md border-0" data-testid="button-export">
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export
            </Button>
          )}
          <div className="flex-1" />
          <div className="relative w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone or room..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 rounded-xl"
              data-testid="input-search-tenants"
            />
          </div>
          <Button variant="outline" className="rounded-full gap-1.5" onClick={() => {
            setDraftStatus(statusFilter);
            setDraftFollowUp(followUpFilter);
            setDraftFlagOverdue(flagOverdueFilter);
            setDraftFlagDueDate(flagDueDateFilter);
            setDraftFlagFollowUp(flagFollowUpFilter);
            setDraftAmountAbove(amountAbove);
            setDraftAmountBelow(amountBelow);
            setFiltersOpen(true);
          }} data-testid="button-open-filters">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {secondaryFilterCount > 0 && (
              <span className="ml-0.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                {secondaryFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" className="rounded-full gap-1.5" onClick={() => setSortOpen(true)} data-testid="button-open-sort">
            <ArrowUpDown className="w-3.5 h-3.5" />
            Sort
          </Button>
          <Dialog open={sortOpen} onOpenChange={setSortOpen}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle className="text-base">Sort By</DialogTitle>
              </DialogHeader>
              <div className="space-y-1 py-2">
                {([
                  { field: "daysOverdue" as SortField, label: "Days Overdue" },
                  { field: "totalAmountDue" as SortField, label: "Amount Due" },
                  { field: "dueDate" as SortField, label: "Due Date" },
                  { field: "tenantName" as SortField, label: "Tenant Name" },
                  { field: "latestFollowUpDate" as SortField, label: "Follow-Up Date" },
                  { field: "latestActivity" as SortField, label: "Latest Activity" },
                ]).map((opt) => {
                  const isActive = sortField === opt.field;
                  const isDefault = opt.field === DEFAULT_SORT_FIELD && sortField === DEFAULT_SORT_FIELD && sortDir === DEFAULT_SORT_DIR;
                  return (
                    <button
                      key={opt.field}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted/50"}`}
                      onClick={() => toggleSort(opt.field)}
                      data-testid={`button-sort-${opt.field}`}
                    >
                      <span className="flex items-center gap-2">
                        {isActive ? (sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 text-primary" /> : <ArrowDown className="w-3.5 h-3.5 text-primary" />) : <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        {opt.label}
                      </span>
                      {(isDefault || isActive) && (
                        <span className="text-xs text-primary/80">
                          {isDefault ? "Default" : sortDir === "asc" ? "Low \u2192 High" : "High \u2192 Low"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <DialogFooter>
                <Button className="rounded-md shadow-lg shadow-primary/20" onClick={() => setSortOpen(false)} data-testid="button-apply-sort">
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent className="sm:max-w-[640px]">
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 pr-6">
                  <DialogTitle className="text-base">Advanced Filters</DialogTitle>
                  {(draftStatus !== "all" || draftFollowUp !== "all" || draftFlagOverdue !== "all" || draftFlagDueDate !== "all" || draftFlagFollowUp !== "all" || !!draftAmountAbove || !!draftAmountBelow) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-md text-xs"
                      onClick={() => { setDraftStatus("all"); setDraftFollowUp("all"); setDraftFlagOverdue("all"); setDraftFlagDueDate("all"); setDraftFlagFollowUp("all"); setDraftAmountAbove(""); setDraftAmountBelow(""); }}
                      data-testid="button-clear-advanced-filters"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear All
                    </Button>
                  )}
                </div>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <Select value={draftStatus} onValueChange={setDraftStatus}>
                      <SelectTrigger className="w-full rounded-md" data-testid="select-status-filter-tenants">
                        <SelectValue placeholder="All Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="no_update">No Update</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="partial_payment">Partial Payment</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="not_responding">Not Responding</SelectItem>
                        <SelectItem value="refund_adjustment">Refund Adjustment</SelectItem>
                        <SelectItem value="payment_not_updated">Payment Not Updated</SelectItem>
                        <SelectItem value="collectable">Collectable Due</SelectItem>
                        <SelectItem value="suspense">Non Collectable Due</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Follow-Up Schedule</label>
                    <Select value={draftFollowUp} onValueChange={setDraftFollowUp}>
                      <SelectTrigger className="w-full rounded-md" data-testid="select-followup-filter-tenants">
                        <SelectValue placeholder="All Follow-Ups" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Follow-Ups</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="tomorrow">Tomorrow</SelectItem>
                        <SelectItem value="this_week">This Week</SelectItem>
                        <SelectItem value="this_month">This Month</SelectItem>
                        <SelectItem value="overdue">Overdue Follow-ups</SelectItem>
                        <SelectItem value="later">Later</SelectItem>
                        <SelectItem value="none">No Follow-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Overdue Flag</label>
                    <Select value={draftFlagOverdue} onValueChange={setDraftFlagOverdue}>
                      <SelectTrigger className="w-full rounded-md" data-testid="select-flag-overdue-filter">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="any">Any Flag</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="orange">Orange</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Due Date Flag</label>
                    <Select value={draftFlagDueDate} onValueChange={setDraftFlagDueDate}>
                      <SelectTrigger className="w-full rounded-md" data-testid="select-flag-due-date-filter">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="any">Any Flag</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="orange">Orange</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Follow-Up Flag</label>
                    <Select value={draftFlagFollowUp} onValueChange={setDraftFlagFollowUp}>
                      <SelectTrigger className="w-full rounded-md" data-testid="select-flag-follow-up-filter">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="any">Any Flag</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="orange">Orange</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Amount Due Range</label>
                  <div className="flex items-center gap-2 sm:max-w-[360px]">
                    <div className="relative flex-1">
                      <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="Min"
                        value={draftAmountAbove}
                        onChange={(e) => setDraftAmountAbove(e.target.value)}
                        className="pl-7 rounded-md text-sm"
                        data-testid="input-amount-above"
                        min="0"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">to</span>
                    <div className="relative flex-1">
                      <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="Max"
                        value={draftAmountBelow}
                        onChange={(e) => setDraftAmountBelow(e.target.value)}
                        className="pl-7 rounded-md text-sm"
                        data-testid="input-amount-below"
                        min="0"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="outline"
                  className="rounded-md"
                  onClick={() => setFiltersOpen(false)}
                  data-testid="button-cancel-filters"
                >
                  Cancel
                </Button>
                <Button
                  className="rounded-md shadow-lg shadow-primary/20"
                  onClick={() => {
                    setStatusFilter(draftStatus);
                    setFollowUpFilter(draftFollowUp);
                    setFlagOverdueFilter(draftFlagOverdue);
                    setFlagDueDateFilter(draftFlagDueDate);
                    setFlagFollowUpFilter(draftFlagFollowUp);
                    setAmountAbove(draftAmountAbove);
                    setAmountBelow(draftAmountBelow);
                    setFiltersOpen(false);
                  }}
                  data-testid="button-apply-filters"
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {activeFilterCount > 0 && (
            <Button
              variant="outline"
              className="rounded-full text-xs"
              onClick={() => { setSearch(""); setCityFilter([]); setPropertyFilter([]); setStatusFilter("all"); setFollowUpFilter("all"); setFlagOverdueFilter("all"); setFlagDueDateFilter("all"); setFlagFollowUpFilter("all"); setAmountAbove(""); setAmountBelow(""); setBillingCycleFilter([]); setCheckoutNoticeOn(false); setMasterEscalationOn(false); setEscalationLevel("all"); setCollectableDate(""); setSortField(DEFAULT_SORT_FIELD); setSortDir(DEFAULT_SORT_DIR); setPage(1); }}
              data-testid="button-clear-filters-tenants"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear All
            </Button>
          )}
        </div>
      </motion.div>

      {collectableDate && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <Card className="border border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl overflow-visible" data-testid="card-collectable-date-filter">
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <CalendarDays className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Showing tenants with collectable dues on <span className="font-semibold">{new Date(collectableDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 text-xs"
                onClick={() => setCollectableDate("")}
                data-testid="button-clear-collectable-date"
              >
                <X className="w-3 h-3 mr-1" />
                Clear
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {masterEscalationOn && !masterFlagActive && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl overflow-visible" data-testid="card-master-flag-inactive-warning">
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Master Flag is inactive. Escalation data will not be available.
              </p>
              <Link href="/settings">
                <Button variant="outline" size="sm" className="border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-300 text-xs" data-testid="button-go-to-settings">
                  Enable in Settings
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!masterEscalationOn && totalTenants > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 rounded-xl overflow-visible" data-testid="card-summary-tile">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider">Total Due Amount</p>
                    <p className="text-xl font-bold text-sky-700 dark:text-sky-300 tabular-nums" data-testid="text-total-due-amount">{formatCurrency(paginatedData?.totalDueAmount ?? 0)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1.5 justify-end">
                    <Users className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                    <p className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider">Total Tenants</p>
                  </div>
                  <p className="text-xl font-bold text-sky-700 dark:text-sky-300 tabular-nums" data-testid="text-total-tenants-summary">{totalTenants.toLocaleString("en-IN")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {masterEscalationOn && masterFlagActive && escalationSummary && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 rounded-xl overflow-visible" data-testid="card-value-at-risk">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wider">Value at Risk</p>
                    <p className="text-xl font-bold text-rose-700 dark:text-rose-300 tabular-nums" data-testid="text-value-at-risk">{formatCurrency(escalationSummary.totalValueAtRisk)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wider">High-Risk Tenants</p>
                  <p className="text-xl font-bold text-rose-700 dark:text-rose-300 tabular-nums" data-testid="text-escalated-count">{escalationSummary.escalatedCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="hidden md:block"
      >
        <Card className="glass-card border rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 4px 24px -6px rgba(0,0,0,0.07), 0 2px 8px -2px rgba(0,0,0,0.04)" }}
        >
          {isFetching && (
            <div className="h-0.5 w-full bg-muted overflow-hidden">
              <div className="h-full w-1/3 bg-primary rounded-full animate-[slideProgress_1s_ease-in-out_infinite]" />
            </div>
          )}
          <CardContent className="p-0 overflow-x-auto">
            <Table className="text-[13px] w-full">
              <colgroup>
                <col style={{ width: "14%", minWidth: "120px" }} />
                <col style={{ width: "11%", minWidth: "90px" }} />
                <col style={{ width: "15%", minWidth: "110px" }} />
                <col style={{ width: "10%", minWidth: "72px" }} />
                <col style={{ width: "12%", minWidth: "82px" }} />
                <col style={{ width: "10%", minWidth: "70px" }} />
                <col style={{ width: "10%", minWidth: "75px" }} />
                <col style={{ width: "14%", minWidth: "90px" }} />
                <col style={{ width: "36px" }} />
              </colgroup>
              <TableHeader>
                <TableRow className="border-b-2 border-border/40 dark:border-border/20 table-header-navy hover:bg-transparent">
                  <TableHead className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-white px-2" onClick={() => toggleSort("tenantName")}>
                    <span className="flex items-center gap-1">Tenant <SortIcon field="tenantName" /></span>
                  </TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-white px-2">Phone</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-white px-2">City / Property</TableHead>
                  <TableHead className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-white px-2 text-center" onClick={() => toggleSort("totalAmountDue")}>
                    <span className="flex items-center gap-1 justify-center">Amount <SortIcon field="totalAmountDue" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-white px-2" onClick={() => toggleSort("dueDate")}>
                    <span className="flex items-center gap-1">Due Date <SortIcon field="dueDate" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-white px-2" onClick={() => toggleSort("daysOverdue")}>
                    <span className="flex items-center gap-1">Overdue <SortIcon field="daysOverdue" /></span>
                  </TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-white px-2">Status</TableHead>
                  <TableHead className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-white px-2" onClick={() => toggleSort("latestFollowUpDate")}>
                    <span className="flex items-center gap-1">Follow-Up <SortIcon field="latestFollowUpDate" /></span>
                  </TableHead>
                  <TableHead className="px-1"><Eye className="w-3.5 h-3.5 text-white/70 mx-auto" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                      No tenants found matching your criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  tenants.map((tenant, idx) => {
                    const isEven = idx % 2 === 0;
                    const { bg: rowBg, hover: rowHover } = getRowColors(tenant.paymentStatus, isEven);
                    return (
                      <TableRow
                        key={tenant.id}
                        className={`transition-colors duration-150 border-b border-border/25 dark:border-border/10 ${rowBg} ${rowHover}`}
                        data-testid={`row-tenant-${tenant.id}`}
                      >
                        <TableCell className="text-sm px-2 align-top">
                          <div className="flex items-start gap-1.5">
                            <span className="flex-shrink-0 mt-0.5">{getMasterFlagIcon(tenant.masterFlagLevel)}</span>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold tenant-name-wrap" title={tenant.tenantName}>{tenant.tenantName}</span>
                              {tenant.roomNo && (
                                <span className="text-xs font-medium text-muted-foreground" data-testid={`text-room-${tenant.id}`}>
                                  Room: {tenant.roomNo}
                                </span>
                              )}
                              {tenant.checkoutNoticeDate && (
                                <Badge variant="secondary" className="text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-0 rounded-lg w-fit" data-testid={`badge-checkout-notice-${tenant.id}`}>
                                  <LogOut className="w-2.5 h-2.5 mr-0.5" />
                                  {tenant.expectedCheckoutDate ? `Notice: ${tenant.expectedCheckoutDate}` : "Notice Given"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm px-2 align-top">
                          {tenant.primaryPhone && (
                            <a href={`tel:${tenant.primaryPhone}`} className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium transition-colors whitespace-nowrap" data-testid={`link-phone-${tenant.id}`}>
                              <Phone className="w-3 h-3 flex-shrink-0" />{tenant.primaryPhone}
                            </a>
                          )}
                        </TableCell>
                        <TableCell className="px-2 align-top">
                          <div className="text-sm font-semibold text-foreground" title={tenant.city}>{tenant.city}</div>
                          <div className="text-xs font-medium text-foreground/85 dark:text-foreground/75" title={tenant.propertyName}>{tenant.propertyName}</div>
                          {tenant.rentalBillingCycle && (
                            <div className="flex items-center gap-1 text-[10px] font-medium text-foreground/75 dark:text-foreground/65 mt-0.5">
                              <RefreshCw className="w-2.5 h-2.5" />
                              {tenant.rentalBillingCycle}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-bold tabular-nums text-sm px-2 text-center align-top whitespace-nowrap">{formatCurrency(tenant.totalAmountDue)}</TableCell>
                        <TableCell className="px-2 align-top">
                          <span className="flex items-center gap-1 text-sm font-medium text-foreground whitespace-nowrap">
                            {getDueDateFlag(tenant.dueDate, tenant.paymentStatus, flagThresholds)}
                            {tenant.dueDate || "\u2014"}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 align-top">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {getDueAgingDisplay(tenant.dueDate, tenant.paymentStatus, flagThresholds)}
                            {tenant.missedCommitment && (
                              <Badge variant="secondary" className="text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-0 shadow-sm rounded-lg whitespace-nowrap" data-testid={`badge-missed-commitment-${tenant.id}`}>
                                Missed
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-2 align-top" data-testid={`text-status-${tenant.id}`}>
                          <div className="inline-flex items-center max-w-full">
                            {getStatusBadge(tenant.paymentStatus)}
                          </div>
                        </TableCell>
                        <TableCell className="px-2 align-top">
                          {(tenant.paymentStatus === 'paid' || tenant.paymentStatus === 'refund_adjustment') ? (
                            <span className="text-sm text-muted-foreground" data-testid={`text-followup-${tenant.id}`}>–</span>
                          ) : tenant.latestFollowUpDate ? (
                            <span className="flex items-center gap-1 text-sm font-medium text-foreground" data-testid={`text-followup-${tenant.id}`}>
                              {getFollowUpFlag(tenant.latestFollowUpDate, flagThresholds)}
                              {formatFollowUpDate(tenant.latestFollowUpDate)}
                            </span>
                          ) : (
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400" data-testid={`text-followup-${tenant.id}`}>Not Scheduled</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="rounded-lg bg-primary/[0.07] dark:bg-primary/[0.12] text-primary"
                            onClick={() => { setSelectedTenantId(tenant.id); setSelectedTenantSnapshot(tenant); }}
                            data-testid={`button-view-${tenant.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      <div className="md:hidden space-y-4">
        {tenants.length === 0 ? (
          <Card className="glass-card rounded-2xl border-0">
            <CardContent className="p-6 text-center text-muted-foreground">
              No tenants found
            </CardContent>
          </Card>
        ) : (
          tenants.map((tenant, index) => {
            const daysOver = getDaysOverdue(tenant.dueDate, tenant.paymentStatus);
            const isOverdue = daysOver !== null && daysOver > 0 && tenant.paymentStatus !== "paid" && tenant.paymentStatus !== "already_paid";
            const isActive = touchedCardId === tenant.id || hoveredCardId === tenant.id;
            const cardColors = getMobileCardColors(tenant.paymentStatus, isActive);
            return (
              <motion.div
                key={tenant.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  className={`rounded-2xl p-5 space-y-3.5 transition-colors duration-150 mobile-card-depth ${cardColors} ${isOverdue ? "ring-1 ring-red-300/70 dark:ring-red-900/40" : ""}`}
                  data-testid={`card-tenant-${tenant.id}`}
                  onPointerDown={(e) => handleCardPointerDown(tenant.id, e)}
                  onPointerUp={handleCardPointerUp}
                  onPointerCancel={handleCardPointerCancel}
                  onPointerLeave={handleCardPointerLeave}
                  onMouseEnter={() => setHoveredCardId(tenant.id)}
                  onMouseLeave={() => setHoveredCardId(null)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      {getMasterFlagIcon(tenant.masterFlagLevel) && (
                        <div className="mt-0.5 shrink-0">{getMasterFlagIcon(tenant.masterFlagLevel)}</div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-[1rem] text-foreground tenant-name-wrap">{tenant.tenantName}</p>
                        {tenant.roomNo && (
                          <p className="text-xs font-medium text-muted-foreground" data-testid={`text-room-mobile-${tenant.id}`}>Room: {tenant.roomNo}</p>
                        )}
                        {tenant.checkoutNoticeDate && (
                          <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-0 rounded-lg mt-0.5" data-testid={`badge-checkout-notice-mobile-${tenant.id}`}>
                            <LogOut className="w-2.5 h-2.5 mr-0.5" />
                            {tenant.expectedCheckoutDate ? `Notice: ${tenant.expectedCheckoutDate}` : "Notice Given"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0" data-testid={`text-status-mobile-${tenant.id}`}>{getStatusBadge(tenant.paymentStatus)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-[1.05rem] tabular-nums text-foreground">{formatCurrency(tenant.totalAmountDue)}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getDueAgingDisplay(tenant.dueDate, tenant.paymentStatus, flagThresholds)}
                      {tenant.missedCommitment && (
                        <Badge variant="secondary" className="text-[11px] bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-0 shadow-sm rounded-lg whitespace-nowrap" data-testid={`badge-missed-commitment-mobile-${tenant.id}`}>
                          Missed
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[0.8rem]">
                    <span className="flex items-center gap-1 font-semibold text-foreground/90 dark:text-foreground/80">
                      {getDueDateFlag(tenant.dueDate, tenant.paymentStatus, flagThresholds)}
                      Due: {tenant.dueDate || "\u2014"}
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-foreground/90 dark:text-foreground/80">
                      {(tenant.paymentStatus !== 'paid' && tenant.paymentStatus !== 'refund_adjustment') && getFollowUpFlag(tenant.latestFollowUpDate, flagThresholds)}
                      FU: {(tenant.paymentStatus === 'paid' || tenant.paymentStatus === 'refund_adjustment') ? "–" : tenant.latestFollowUpDate ? formatFollowUpDate(tenant.latestFollowUpDate) : "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[0.8rem] font-medium text-foreground/80 dark:text-foreground/70">
                    <span><span className="font-bold text-foreground">{tenant.city}</span> &middot; {tenant.propertyName}</span>
                    {tenant.rentalBillingCycle && (
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        {tenant.rentalBillingCycle}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/20">
                    <a href={`tel:${tenant.primaryPhone}`} className="text-[0.9rem] font-semibold flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors" data-testid={`link-phone-mobile-${tenant.id}`}>
                      <Phone className="w-4 h-4" />{tenant.primaryPhone}
                    </a>
                    <Button variant="outline" className="border-primary/40 bg-primary/5 text-primary font-semibold text-[0.9rem] px-4" onClick={() => { setSelectedTenantId(tenant.id); setSelectedTenantSnapshot(tenant); }} data-testid={`button-view-mobile-${tenant.id}`}>
                      <Eye className="w-4 h-4 mr-1.5" /> View
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="flex items-center justify-center gap-3 pt-2"
        >
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-full" data-testid="button-prev-page">
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-page-info">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-full" data-testid="button-next-page">
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </motion.div>
      )}

      {selectedTenant && (
        <TenantDetailDrawer
          tenant={selectedTenant}
          open={!!selectedTenantId}
          onClose={() => { setSelectedTenantId(null); setSelectedTenantSnapshot(null); }}
        />
      )}
    </div>
  );
}
