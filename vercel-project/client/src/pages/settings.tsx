import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useUsername } from "@/components/username-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User, Save, Settings as SettingsIcon, Trash2, History, Clock, CalendarClock, RotateCcw, Users, Plus, Edit, Shield, UserPlus, MapPin, Flag, Building2, ChevronRight, Zap, Power, X, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import type { ColumnMapping, ActivityResetLog, MasterFlagConfig, MasterFlagCondition } from "@shared/schema";
import { USER_ROLE_LABELS, PERMISSION_KEYS, PERMISSION_LABELS, MASTER_FLAG_CONDITION_TYPES, MASTER_FLAG_CONDITION_LABELS } from "@shared/schema";
import { Switch } from "@/components/ui/switch";
import { Phone, Key } from "lucide-react";

interface AppUser {
  id: number;
  phone: string;
  displayName: string;
  role: string;
  roleLabel: string;
  assignedCities: string[];
  assignedProperties: string[];
  active: number;
  createdAt: string;
  permissions: {
    canManageUploads: boolean;
    canManageTeam: boolean;
    canManageSettings: boolean;
    canExportData: boolean;
    canManageTickets: boolean;
    canHandlePartialPayments: boolean;
  };
}

const ROLE_OPTIONS = Object.entries(USER_ROLE_LABELS).map(([value, label]) => ({ value, label }));

const CONDITION_TYPE_OPTIONS = Object.entries(MASTER_FLAG_CONDITION_LABELS).map(([value, label]) => ({ value, label }));

const CONDITION_NEEDS_THRESHOLD: Record<string, boolean> = {
  overdue_days: true,
  amount_due: true,
  followup_missed: false,
  checkout_notice_dues: false,
  expected_checkout_days: true,
  partial_payment_remaining: true,
  repeated_overdue: true,
  manual_escalation: false,
};

function MasterFlagConfigSection() {
  const { toast } = useToast();
  const { data: masterFlagConfig, isLoading } = useQuery<MasterFlagConfig>({
    queryKey: ["/api/settings/master-flag"],
  });

  const [localConfig, setLocalConfig] = useState<MasterFlagConfig>({
    enabled: false,
    warningThreshold: 3,
    criticalThreshold: 7,
    conditions: [],
  });

  useEffect(() => {
    if (masterFlagConfig) {
      setLocalConfig(masterFlagConfig);
    }
  }, [masterFlagConfig]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (localConfig.enabled && localConfig.warningThreshold >= localConfig.criticalThreshold && localConfig.criticalThreshold > 0) {
        throw new Error("Warning threshold must be less than Critical threshold");
      }
      await apiRequest("PUT", "/api/settings/master-flag", localConfig);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/master-flag"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/analytics/");
      }});
      toast({ title: "Master Flag config saved", description: "Scoring rules have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const autoSaveConditionMutation = useMutation({
    mutationFn: async (configToSave: MasterFlagConfig) => {
      await apiRequest("PUT", "/api/settings/master-flag", configToSave);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/master-flag"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/analytics/");
      }});
      toast({ title: "Condition updated", description: "Change saved automatically." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addCondition = () => {
    const id = `cond_${Date.now()}`;
    setLocalConfig((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { id, type: "overdue_days", enabled: true, threshold: 15, weight: 2 }],
    }));
  };

  const removeCondition = (id: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((c) => c.id !== id),
    }));
  };

  const updateCondition = (id: string, updates: Partial<MasterFlagCondition>) => {
    setLocalConfig((prev) => {
      const updatedConfig = {
        ...prev,
        conditions: prev.conditions.map((c) => c.id === id ? { ...c, ...updates } : c),
      };

      // Auto-save if the enabled field is being changed
      if ("enabled" in updates) {
        autoSaveConditionMutation.mutate(updatedConfig);
      }

      return updatedConfig;
    });
  };

  const maxPossibleScore = localConfig.conditions
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + (c.weight || 0), 0);

  const warningExceedsMax = localConfig.warningThreshold > maxPossibleScore && maxPossibleScore > 0;
  const criticalExceedsMax = localConfig.criticalThreshold > maxPossibleScore && maxPossibleScore > 0;
  const thresholdsInvalid = warningExceedsMax || criticalExceedsMax;

  const hasChanges = JSON.stringify(localConfig) !== JSON.stringify(masterFlagConfig || { enabled: false, warningThreshold: 3, criticalThreshold: 7, conditions: [] });

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.22 }}>
      <Card className="glass-card rounded-2xl border-0 overflow-visible">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="section-icon">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-semibold" data-testid="text-master-flag-title">Master Flag Configuration</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">Dynamic scoring engine for tenant escalation flags</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="master-flag-enabled" className="text-xs text-muted-foreground">
              {localConfig.enabled ? "Active" : "Inactive"}
            </Label>
            <Switch
              id="master-flag-enabled"
              checked={localConfig.enabled}
              onCheckedChange={(checked) => {
                const updatedConfig = { ...localConfig, enabled: checked };
                setLocalConfig(updatedConfig);
                autoSaveConditionMutation.mutate(updatedConfig);
              }}
              data-testid="switch-master-flag-enabled"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading configuration...</p>
          ) : (
            <>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Thresholds</p>
                  {localConfig.conditions.length > 0 && (
                    <span className="text-xs font-bold text-foreground/70 dark:text-foreground/60 tabular-nums" data-testid="text-max-possible-score">
                      (Max: {maxPossibleScore})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <Flag className="w-3 h-3 text-orange-500 fill-orange-500" />
                    Warning &ge;
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      value={localConfig.warningThreshold}
                      onChange={(e) => setLocalConfig((prev) => ({ ...prev, warningThreshold: parseInt(e.target.value) || 0 }))}
                      className={`rounded-xl w-[70px] ${warningExceedsMax ? "border-red-500 dark:border-red-400 ring-1 ring-red-500/30" : "border-border/50"}`}
                      data-testid="input-master-flag-warning-threshold"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <Flag className="w-3 h-3 text-red-500 fill-red-500" />
                    Critical &ge;
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      value={localConfig.criticalThreshold}
                      onChange={(e) => setLocalConfig((prev) => ({ ...prev, criticalThreshold: parseInt(e.target.value) || 0 }))}
                      className={`rounded-xl w-[70px] ${criticalExceedsMax ? "border-red-500 dark:border-red-400 ring-1 ring-red-500/30" : "border-border/50"}`}
                      data-testid="input-master-flag-critical-threshold"
                    />
                  </div>
                </div>
              </div>
              {(warningExceedsMax || criticalExceedsMax) && (
                <p className="text-[10px] text-red-500 dark:text-red-400">Threshold(s) exceed max possible score ({maxPossibleScore})</p>
              )}

              <Separator className="opacity-30" />

              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scoring Conditions</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Each enabled condition adds its weight to the total score</p>
                </div>

                <div className="hidden md:grid grid-cols-[44px_1fr_100px_80px_40px] gap-3 px-3 pb-1 border-b border-border/30">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">Active</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">Scoring Condition</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">Threshold</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">Weight</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-100">Action</span>
                </div>

                {localConfig.conditions.length === 0 ? (
                  <div className="py-4 text-center">
                    <AlertTriangle className="w-5 h-5 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No conditions configured.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {localConfig.conditions.map((cond, idx) => {
                      const needsThreshold = CONDITION_NEEDS_THRESHOLD[cond.type] ?? false;
                      return (
                        <div
                          key={cond.id}
                          className={`rounded-xl p-3 border ${cond.enabled ? "bg-muted/30 dark:bg-muted/20 border-border/30" : "bg-muted/10 dark:bg-muted/10 border-border/15 opacity-60"}`}
                          data-testid={`condition-row-${idx}`}
                        >
                          <div className="hidden md:grid grid-cols-[44px_1fr_100px_80px_40px] gap-3 items-center">
                            <Switch
                              checked={cond.enabled}
                              onCheckedChange={(checked) => updateCondition(cond.id, { enabled: checked })}
                              data-testid={`switch-condition-${idx}`}
                            />
                            <Select value={cond.type} onValueChange={(val) => updateCondition(cond.id, { type: val, threshold: CONDITION_NEEDS_THRESHOLD[val] ? (cond.threshold ?? 15) : null })}>
                              <SelectTrigger className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100" data-testid={`select-condition-type-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONDITION_TYPE_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {needsThreshold ? (
                              <Input
                                type="number"
                                min="0"
                                value={cond.threshold ?? 0}
                                onChange={(e) => updateCondition(cond.id, { threshold: parseInt(e.target.value) || 0 })}
                                className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100"
                                data-testid={`input-condition-threshold-${idx}`}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground text-center">--</span>
                            )}
                            <Input
                              type="number"
                              min="0"
                              value={cond.weight}
                              onChange={(e) => updateCondition(cond.id, { weight: parseInt(e.target.value) || 0 })}
                              className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100"
                              data-testid={`input-condition-weight-${idx}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeCondition(cond.id)}
                              className="text-destructive shrink-0"
                              data-testid={`button-remove-condition-${idx}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="flex md:hidden flex-col gap-2">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={cond.enabled}
                                onCheckedChange={(checked) => updateCondition(cond.id, { enabled: checked })}
                              />
                              <div className="flex-1 min-w-0">
                                <Select value={cond.type} onValueChange={(val) => updateCondition(cond.id, { type: val, threshold: CONDITION_NEEDS_THRESHOLD[val] ? (cond.threshold ?? 15) : null })}>
                                  <SelectTrigger className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CONDITION_TYPE_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeCondition(cond.id)}
                                className="text-destructive shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-3 pl-12">
                              {needsThreshold && (
                                <div className="flex items-center gap-1.5 flex-1">
                                  <Label className="text-xs text-slate-900 dark:text-slate-100 whitespace-nowrap">Threshold</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={cond.threshold ?? 0}
                                    onChange={(e) => updateCondition(cond.id, { threshold: parseInt(e.target.value) || 0 })}
                                    className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100"
                                  />
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 flex-1">
                                <Label className="text-xs text-slate-900 dark:text-slate-100 whitespace-nowrap">Weight</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={cond.weight}
                                  onChange={(e) => updateCondition(cond.id, { weight: parseInt(e.target.value) || 0 })}
                                  className="rounded-xl border-border/50 text-sm text-slate-900 dark:text-slate-100"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full text-xs"
                  onClick={addCondition}
                  data-testid="button-add-condition"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Condition
                </Button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !hasChanges || (localConfig.enabled && thresholdsInvalid)}
                  className="shadow-lg shadow-emerald-500/20 rounded-full"
                  data-testid="button-save-master-flag"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {saveMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    if (window.confirm("This will remove all current scoring rules. Do you want to start fresh?")) {
                      setLocalConfig((prev) => ({
                        ...prev,
                        warningThreshold: 0,
                        criticalThreshold: 0,
                        conditions: [],
                      }));
                    }
                  }}
                  data-testid="button-reset-master-flag"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Start Fresh
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function UserManagementSection() {
  const { toast } = useToast();
  const { data: appUsers, isLoading } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const { data: filterOptions } = useQuery<{ cities: string[]; properties: string[]; cityPropertyMap: Record<string, string[]> }>({ queryKey: ["/api/tenants/filter-options"] });
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [formPhone, setFormPhone] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formRole, setFormRole] = useState("property_manager");
  const [formCities, setFormCities] = useState<string[]>([]);
  const [formProperties, setFormProperties] = useState<string[]>([]);
  const [formPermissions, setFormPermissions] = useState<Record<string, boolean>>({
    canManageUploads: false,
    canManageTeam: false,
    canManageSettings: false,
    canExportData: false,
    canManageTickets: false,
    canHandlePartialPayments: false,
  });

  const isRegionalHead = formRole === "regional_head";

  const resetForm = () => {
    setFormPhone("");
    setFormName("");
    setFormPassword("");
    setShowPassword(false);
    setFormRole("property_manager");
    setFormCities([]);
    setFormProperties([]);
    setFormPermissions({
      canManageUploads: false,
      canManageTeam: false,
      canManageSettings: false,
      canExportData: false,
      canManageTickets: false,
      canHandlePartialPayments: false,
    });
    setEditingUser(null);
    setShowForm(false);
  };

  const createUserMutation = useMutation({
    mutationFn: async () => {
      if (!formPhone || !formName || !formPassword) throw new Error("Phone, name, and password are required");
      await apiRequest("POST", "/api/users", {
        phone: formPhone,
        password: formPassword,
        displayName: formName,
        role: formRole,
        assignedCities: formCities,
        assignedProperties: formProperties,
        permissions: isRegionalHead
          ? { canManageUploads: true, canManageTeam: true, canManageSettings: true, canExportData: true, canManageTickets: true }
          : formPermissions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User created", description: `${formName} has been added.` });
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return;
      const body: any = {
        displayName: formName,
        role: formRole,
        assignedCities: formCities,
        assignedProperties: formProperties,
        permissions: formRole === "regional_head"
          ? { canManageUploads: true, canManageTeam: true, canManageSettings: true, canExportData: true, canManageTickets: true }
          : formPermissions,
      };
      if (formPhone !== editingUser.phone) body.phone = formPhone;
      if (formPassword) body.password = formPassword;
      await apiRequest("PUT", `/api/users/${editingUser.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User updated" });
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: number }) => {
      await apiRequest("PUT", `/api/users/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [resetPasswordUser, setResetPasswordUser] = useState<AppUser | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [tempPasswordConfirm, setTempPasswordConfirm] = useState("");
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [showTempPasswordConfirm, setShowTempPasswordConfirm] = useState(false);

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!resetPasswordUser) throw new Error("No user selected");
      if (tempPassword.length < 8) throw new Error("Password must be at least 8 characters");
      if (tempPassword !== tempPasswordConfirm) throw new Error("Passwords do not match");
      await apiRequest("POST", `/api/users/${resetPasswordUser.id}/reset-password`, { password: tempPassword });
    },
    onSuccess: () => {
      toast({ title: "Temporary password set", description: "User must change it on next login." });
      setResetPasswordUser(null);
      setTempPassword("");
      setTempPasswordConfirm("");
      setShowTempPassword(false);
      setShowTempPasswordConfirm(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (u: AppUser) => {
    setEditingUser(u);
    setFormPhone(u.phone);
    setFormName(u.displayName);
    setFormPassword("");
    setShowPassword(false);
    setFormRole(u.role);
    setFormCities(u.assignedCities || []);
    setFormProperties(u.assignedProperties || []);
    setFormPermissions(u.permissions || {
      canManageUploads: false,
      canManageTeam: false,
      canManageSettings: false,
      canExportData: false,
      canManageTickets: false,
    });
    setShowForm(true);
  };

  const toggleCity = (city: string) => {
    setFormCities((prev) => {
      const isRemoving = prev.includes(city);
      const updated = isRemoving ? prev.filter((c) => c !== city) : [...prev, city];
      if (isRemoving && filterOptions?.cityPropertyMap) {
        const remainingValidProps = new Set(
          updated.flatMap((c) => filterOptions.cityPropertyMap[c] || [])
        );
        setFormProperties((prevProps) => prevProps.filter((p) => remainingValidProps.has(p)));
      }
      return updated;
    });
  };

  const toggleProperty = (prop: string) => {
    setFormProperties((prev) =>
      prev.includes(prop) ? prev.filter((p) => p !== prop) : [...prev, prop]
    );
  };

  const availableProperties = filterOptions && formCities.length > 0
    ? [...new Set(formCities.flatMap((c) => filterOptions.cityPropertyMap[c] || []))]
    : [];

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.22 }}>
      <Card className="glass-card rounded-2xl border-0 overflow-visible">
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="section-icon">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-semibold">Team Members</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">Manage team access, roles, and permissions</p>
          </div>
          {!showForm && (
            <Button
              size="sm"
              className="rounded-full shadow-lg shadow-emerald-500/20"
              onClick={() => { resetForm(); setShowForm(true); }}
              data-testid="button-add-user"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />
              Add User
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading users...</p>
          ) : (
            <>
              {appUsers && appUsers.length > 0 ? (
                <div className="space-y-2">
                  {appUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-start gap-4 py-3 px-4 rounded-xl bg-muted/30 dark:bg-muted/20"
                      data-testid={`user-row-${u.id}`}
                    >
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{u.displayName}</span>
                          <Badge variant="secondary" className="rounded-full text-[10px]">{u.roleLabel}</Badge>
                          {u.active !== 1 && (
                            <Badge variant="outline" className="rounded-full text-[10px] text-red-500 border-red-200 dark:border-red-800/30">Inactive</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={2.5} />
                          <span className="text-xs text-slate-900 dark:text-slate-100">{u.phone}</span>
                        </div>
                        {u.assignedCities?.length > 0 && (
                          <div className="flex flex-wrap gap-2 gap-y-2 pt-1">
                            {u.assignedCities.map((city) => {
                              const allCityProps = filterOptions?.cityPropertyMap?.[city] || [];
                              const userProps = (u.assignedProperties || []);
                              const cityProps = allCityProps.filter((p) => userProps.includes(p));
                              const allAssigned = allCityProps.length > 0 && cityProps.length >= allCityProps.length;
                              const hasNoExplicitProps = userProps.length === 0;
                              const displayProps = (hasNoExplicitProps || allAssigned) ? allCityProps : cityProps;
                              const countLabel = (hasNoExplicitProps || allAssigned) ? "All" : String(cityProps.length);
                              return (
                                <Popover key={city}>
                                  <PopoverTrigger asChild>
                                    <Badge variant="outline" className="rounded-full text-[10px] py-0.5 cursor-pointer gap-1.5" data-testid={`badge-city-access-${city}`}>
                                      <Building2 className="w-2.5 h-2.5" />
                                      {city}
                                      {allCityProps.length > 0 && (
                                        <span className="inline-flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[9px] font-semibold min-w-[14px] h-[13px] px-1" data-testid={`text-city-prop-count-${city}`}>
                                          {countLabel}
                                        </span>
                                      )}
                                    </Badge>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-56 p-2" align="start" data-testid={`popover-city-props-${city}`}>
                                    <div className="text-xs font-semibold mb-1.5 text-foreground">{city} — Properties</div>
                                    {displayProps.length > 0 ? (
                                      <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                                        {displayProps.map((p) => (
                                          <div key={p} className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-0.5 px-1 rounded" data-testid={`text-city-prop-${city}-${p}`}>
                                            <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                                            {p}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-[11px] text-muted-foreground">All properties in this city</div>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              );
                            })}
                          </div>
                        )}
                        {u.permissions.canHandlePartialPayments && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Badge variant="secondary" className="rounded-full text-[9px] py-0.5 no-default-hover-elevate no-default-active-elevate bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 border-0">
                              <MapPin className="w-2.5 h-2.5 mr-1" />
                              Partial Payment Handler
                            </Badge>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-center">
                        <Switch
                          checked={u.active === 1}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: u.id, active: checked ? 1 : 0 })}
                          data-testid={`switch-user-active-${u.id}`}
                        />
                        <Button size="icon" variant="ghost" onClick={() => startEdit(u)} data-testid={`button-edit-user-${u.id}`}>
                          <Edit className="w-4 h-4" strokeWidth={2.5} />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => { setResetPasswordUser(u); setTempPassword(""); setTempPasswordConfirm(""); setShowTempPassword(false); setShowTempPasswordConfirm(false); }} data-testid={`button-reset-password-${u.id}`}>
                          <Key className="w-4 h-4" strokeWidth={2.5} />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-red-500" data-testid={`button-delete-user-${u.id}`}>
                              <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {u.displayName}? This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
                              <AlertDialogAction className="rounded-full" onClick={() => deleteUserMutation.mutate(u.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No users yet. Create the first account.</p>
              )}

              {showForm && (
                <>
                  <Separator className="opacity-30" />
                  <div className="max-w-[1000px] mx-auto px-1 sm:px-4 space-y-6">
                    <p className="text-sm font-semibold">{editingUser ? `Edit ${editingUser.displayName}` : "Add New User"}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Display Name</Label>
                        <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Full name" className="rounded-md border-border/50" data-testid="input-user-name" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Phone Number</Label>
                        <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="10-digit phone" className="rounded-md border-border/50" data-testid="input-user-phone" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">{editingUser ? "New Password (leave blank to keep)" : "Password"}</Label>
                        <div className="relative">
                          <Input type={showPassword ? "text" : "password"} value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder={editingUser ? "Leave blank to keep" : "Password"} className="rounded-md border-border/50 pr-10" data-testid="input-user-password" />
                          <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowPassword(!showPassword)} data-testid="button-toggle-password">
                            {showPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Role</Label>
                        <Select value={formRole} onValueChange={setFormRole}>
                          <SelectTrigger className="rounded-md border-border/50" data-testid="select-user-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {filterOptions && filterOptions.cities.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground mb-4 block">Assigned Cities</Label>
                        <div className="flex flex-wrap gap-2">
                          {filterOptions.cities.map((c) => (
                            <Badge
                              key={c}
                              variant={formCities.includes(c) ? "default" : "outline"}
                              className="rounded-full cursor-pointer text-xs toggle-elevate"
                              onClick={() => toggleCity(c)}
                              data-testid={`badge-city-${c}`}
                            >
                              <MapPin className="w-2.5 h-2.5 mr-0.5" />
                              {c}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">
                          {formCities.length === 0 ? "No cities assigned - please select at least one city" : `${formCities.length} selected`}
                        </p>
                      </div>
                    )}

                    <div>
                      <Label className="text-xs text-muted-foreground mb-4 block">Assigned Properties</Label>
                      {formCities.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground py-2 px-3 rounded-md bg-muted/30 dark:bg-muted/20" data-testid="text-select-city-hint">
                          Select a city to view its properties
                        </p>
                      ) : availableProperties.length > 0 ? (
                        <>
                          <div className="flex flex-wrap gap-2.5">
                            {availableProperties.map((p) => (
                              <Badge
                                key={p}
                                variant={formProperties.includes(p) ? "default" : "outline"}
                                className="rounded-full cursor-pointer text-xs toggle-elevate"
                                onClick={() => toggleProperty(p)}
                                data-testid={`badge-property-${p}`}
                              >
                                {p}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {formProperties.length === 0 ? "No properties assigned - user sees all properties in assigned cities" : `${formProperties.length} selected`}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground py-2 px-3 rounded-md bg-muted/30 dark:bg-muted/20">
                          No properties found for selected cities
                        </p>
                      )}
                    </div>

                    <Separator className="opacity-30" />
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-3.5 h-3.5 text-primary" />
                        <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Permissions</Label>
                      </div>
                      {isRegionalHead && (
                        <p className="text-[10px] text-muted-foreground mb-3">Regional Head has all permissions by default.</p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {PERMISSION_KEYS.map((key) => (
                          <div key={key} className="flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-muted/30 dark:bg-muted/20">
                            <Label className="text-xs cursor-pointer" htmlFor={`perm-${key}`}>{PERMISSION_LABELS[key]}</Label>
                            <Switch
                              id={`perm-${key}`}
                              checked={isRegionalHead ? true : !!formPermissions[key]}
                              disabled={isRegionalHead}
                              onCheckedChange={(checked) => setFormPermissions((prev) => ({ ...prev, [key]: checked }))}
                              data-testid={`switch-permission-${key}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button
                        onClick={() => editingUser ? updateUserMutation.mutate() : createUserMutation.mutate()}
                        disabled={createUserMutation.isPending || updateUserMutation.isPending || !formName || !formPhone || (!editingUser && !formPassword)}
                        className="shadow-lg shadow-emerald-500/20 rounded-full"
                        data-testid="button-save-user"
                      >
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                        {(createUserMutation.isPending || updateUserMutation.isPending) ? "Saving..." : editingUser ? "Update User" : "Create User"}
                      </Button>
                      <Button variant="outline" className="rounded-full" onClick={resetForm} data-testid="button-cancel-user">Cancel</Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {resetPasswordUser && (
        <AlertDialog open={!!resetPasswordUser} onOpenChange={(open) => { if (!open) setResetPasswordUser(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Key className="w-4 h-4" /> Reset Password for {resetPasswordUser.displayName}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Set a temporary password. The user will be forced to change it on their next login.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Temporary Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showTempPassword ? "text" : "password"}
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="pr-10"
                    data-testid="input-temp-password"
                  />
                  <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowTempPassword(!showTempPassword)} data-testid="button-toggle-temp-password">
                    {showTempPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Confirm Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showTempPasswordConfirm ? "text" : "password"}
                    value={tempPasswordConfirm}
                    onChange={(e) => setTempPasswordConfirm(e.target.value)}
                    placeholder="Re-enter the password"
                    className="pr-10"
                    data-testid="input-temp-password-confirm"
                  />
                  <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowTempPasswordConfirm(!showTempPasswordConfirm)} data-testid="button-toggle-temp-confirm">
                    {showTempPasswordConfirm ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              {tempPassword && tempPasswordConfirm && tempPassword !== tempPasswordConfirm && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-full" onClick={() => setResetPasswordUser(null)}>Cancel</AlertDialogCancel>
              <Button
                className="rounded-full"
                disabled={resetPasswordMutation.isPending || !tempPassword || !tempPasswordConfirm || tempPassword.length < 8 || tempPassword !== tempPasswordConfirm}
                onClick={() => resetPasswordMutation.mutate()}
                data-testid="button-confirm-reset-password"
              >
                {resetPasswordMutation.isPending ? "Setting..." : "Set Temporary Password"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </motion.div>
  );
}

export default function SettingsPage() {
  const { username, setUsername } = useUsername();
  const [nameInput, setNameInput] = useState(username);
  const { toast } = useToast();

  const { data: savedMapping } = useQuery<ColumnMapping>({
    queryKey: ["/api/column-mapping"],
  });

  const { data: resetLogs } = useQuery<ActivityResetLog[]>({
    queryKey: ["/api/activity-reset-log"],
  });

  const { data: filterOptions } = useQuery<{ cities: string[]; properties: string[]; cityPropertyMap: Record<string, string[]> }>({
    queryKey: ["/api/tenants/filter-options"],
  });

  const { data: gracePeriodData } = useQuery<{ gracePeriodDays: number }>({
    queryKey: ["/api/settings/grace-period"],
  });

  const [gracePeriodInput, setGracePeriodInput] = useState<string>("5");

  useEffect(() => {
    if (gracePeriodData) {
      setGracePeriodInput(String(gracePeriodData.gracePeriodDays));
    }
  }, [gracePeriodData]);

  const saveGracePeriod = useMutation({
    mutationFn: async () => {
      const days = parseInt(gracePeriodInput);
      if (isNaN(days) || days < 1 || days > 90) throw new Error("Grace period must be between 1 and 90 days");
      await apiRequest("PUT", "/api/settings/grace-period", { gracePeriodDays: days });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/grace-period"] });
      toast({ title: "Grace period updated", description: `Follow-up dates will be set to due date + ${gracePeriodInput} days.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/activity?resetBy=${encodeURIComponent(username)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-reset-log"] });
      toast({ title: "Activity history cleared", description: "All remarks, follow-ups, and status updates have been permanently deleted." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear history", description: err.message, variant: "destructive" });
    },
  });

  const resetStatusesMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reset-statuses", { resetBy: username });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-reset-log"] });
      toast({ title: "Statuses reset", description: "All tenant statuses have been reset to 'No Update'. Activity history is preserved." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset statuses", description: err.message, variant: "destructive" });
    },
  });

  const [resetCity, setResetCity] = useState("");
  const [resetProperty, setResetProperty] = useState("");

  const resetCityMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reset-statuses/city", { city: resetCity, resetBy: username });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-reset-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      toast({ title: "Statuses reset", description: `Statuses and follow-ups reset for city: ${resetCity}. Activity remarks are preserved.` });
      setResetCity("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset statuses", description: err.message, variant: "destructive" });
    },
  });

  const resetPropertyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reset-statuses/property", { propertyName: resetProperty, resetBy: username });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-reset-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      toast({ title: "Statuses reset", description: `Statuses and follow-ups reset for property: ${resetProperty}. Activity remarks are preserved.` });
      setResetProperty("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset statuses", description: err.message, variant: "destructive" });
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/column-mapping");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/column-mapping"] });
      toast({ title: "Column mapping reset", description: "You'll be prompted to remap columns on your next upload." });
    },
  });

  interface FlagThresholds {
    orangeFlagDays: number;
    redFlagDays: number;
    dueDateOrangeFlagDays: number;
    dueDateRedFlagDays: number;
    followUpOrangeFlagDays: number;
    followUpRedFlagDays: number;
  }

  const { data: flagThresholds } = useQuery<FlagThresholds>({
    queryKey: ["/api/settings/flag-thresholds"],
  });

  const [orangeFlagInput, setOrangeFlagInput] = useState("15");
  const [redFlagInput, setRedFlagInput] = useState("30");
  const [dueDateOrangeInput, setDueDateOrangeInput] = useState("3");
  const [dueDateRedInput, setDueDateRedInput] = useState("7");
  const [followUpOrangeInput, setFollowUpOrangeInput] = useState("2");
  const [followUpRedInput, setFollowUpRedInput] = useState("5");

  useEffect(() => {
    if (flagThresholds) {
      setOrangeFlagInput(String(flagThresholds.orangeFlagDays));
      setRedFlagInput(String(flagThresholds.redFlagDays));
      setDueDateOrangeInput(String(flagThresholds.dueDateOrangeFlagDays));
      setDueDateRedInput(String(flagThresholds.dueDateRedFlagDays));
      setFollowUpOrangeInput(String(flagThresholds.followUpOrangeFlagDays));
      setFollowUpRedInput(String(flagThresholds.followUpRedFlagDays));
    }
  }, [flagThresholds]);

  const saveFlagThresholds = useMutation({
    mutationFn: async () => {
      const orange = parseInt(orangeFlagInput);
      const red = parseInt(redFlagInput);
      const ddOrange = parseInt(dueDateOrangeInput);
      const ddRed = parseInt(dueDateRedInput);
      const fuOrange = parseInt(followUpOrangeInput);
      const fuRed = parseInt(followUpRedInput);
      if (isNaN(orange) || isNaN(red) || orange < 1 || red < 1) throw new Error("All values must be at least 1");
      if (orange >= red) throw new Error("Orange flag days must be less than red flag days");
      if (isNaN(ddOrange) || isNaN(ddRed) || ddOrange < 1 || ddRed < 1) throw new Error("Due Date flag values must be at least 1");
      if (ddOrange >= ddRed) throw new Error("Due Date orange must be less than red");
      if (isNaN(fuOrange) || isNaN(fuRed) || fuOrange < 1 || fuRed < 1) throw new Error("Follow-Up flag values must be at least 1");
      if (fuOrange >= fuRed) throw new Error("Follow-Up orange must be less than red");
      await apiRequest("PUT", "/api/settings/flag-thresholds", {
        orangeFlagDays: orange,
        redFlagDays: red,
        dueDateOrangeFlagDays: ddOrange,
        dueDateRedFlagDays: ddRed,
        followUpOrangeFlagDays: fuOrange,
        followUpRedFlagDays: fuRed,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/flag-thresholds"] });
      toast({ title: "Flag thresholds updated", description: "All flag thresholds have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveName = () => {
    if (nameInput.trim()) {
      setUsername(nameInput.trim());
      toast({ title: "Name updated", description: `You are now logged in as ${nameInput.trim()}` });
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 space-y-7 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your profile and settings
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card className="glass-card rounded-2xl border-0 overflow-visible">
            <CardHeader className="flex flex-row items-center gap-3 pb-3">
              <div className="section-icon">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Profile</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Your identity for activity tracking</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="display-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</Label>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your name"
                  className="rounded-xl border-border/50 flex-1"
                  data-testid="input-display-name"
                />
                <Button onClick={handleSaveName} disabled={!nameInput.trim() || nameInput.trim() === username} className="shadow-lg shadow-emerald-500/20 rounded-full" data-testid="button-save-name">
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Attached to all your remarks and upload activity.
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl border-0 overflow-visible">
            <CardHeader className="flex flex-row items-center gap-3 pb-3">
              <div className="section-icon">
                <CalendarClock className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Grace Period</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Auto-calculated follow-up dates</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="grace-period" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Days after due date</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="grace-period"
                  type="number"
                  min="1"
                  max="90"
                  value={gracePeriodInput}
                  onChange={(e) => setGracePeriodInput(e.target.value)}
                  className="rounded-xl border-border/50 w-[100px]"
                  data-testid="input-grace-period"
                />
                <Button
                  onClick={() => saveGracePeriod.mutate()}
                  disabled={saveGracePeriod.isPending || gracePeriodInput === String(gracePeriodData?.gracePeriodDays)}
                  className="shadow-lg shadow-emerald-500/20 rounded-full"
                  data-testid="button-save-grace-period"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {saveGracePeriod.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Follow-up dates = due date + grace period days.
              </p>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
        <Card className="glass-card rounded-2xl border-0 overflow-visible">
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="section-icon">
              <Flag className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold" data-testid="text-flag-thresholds-title">Visual Flag Thresholds</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Configure when warning flags appear based on overdue days, due dates, and follow-up dates</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 rounded-xl bg-muted/30 dark:bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Days Overdue</p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="orange-flag" className="text-xs text-muted-foreground whitespace-nowrap">Orange</Label>
                  <Input id="orange-flag" type="number" min="1" value={orangeFlagInput} onChange={(e) => setOrangeFlagInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-orange-flag-days" />
                  <Label htmlFor="red-flag" className="text-xs text-muted-foreground whitespace-nowrap">Red</Label>
                  <Input id="red-flag" type="number" min="1" value={redFlagInput} onChange={(e) => setRedFlagInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-red-flag-days" />
                </div>
              </div>
              <div className="space-y-2 rounded-xl bg-muted/30 dark:bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Due Date</p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="dd-orange-flag" className="text-xs text-muted-foreground whitespace-nowrap">Orange</Label>
                  <Input id="dd-orange-flag" type="number" min="1" value={dueDateOrangeInput} onChange={(e) => setDueDateOrangeInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-due-date-orange-flag-days" />
                  <Label htmlFor="dd-red-flag" className="text-xs text-muted-foreground whitespace-nowrap">Red</Label>
                  <Input id="dd-red-flag" type="number" min="1" value={dueDateRedInput} onChange={(e) => setDueDateRedInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-due-date-red-flag-days" />
                </div>
              </div>
              <div className="space-y-2 rounded-xl bg-muted/30 dark:bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Follow-Up Date</p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="fu-orange-flag" className="text-xs text-muted-foreground whitespace-nowrap">Orange</Label>
                  <Input id="fu-orange-flag" type="number" min="1" value={followUpOrangeInput} onChange={(e) => setFollowUpOrangeInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-follow-up-orange-flag-days" />
                  <Label htmlFor="fu-red-flag" className="text-xs text-muted-foreground whitespace-nowrap">Red</Label>
                  <Input id="fu-red-flag" type="number" min="1" value={followUpRedInput} onChange={(e) => setFollowUpRedInput(e.target.value)} className="rounded-xl border-border/50 w-[70px]" data-testid="input-follow-up-red-flag-days" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Orange days must be less than red days. All values must be at least 1.
              </p>
              <Button
                onClick={() => saveFlagThresholds.mutate()}
                disabled={saveFlagThresholds.isPending}
                className="shadow-lg shadow-emerald-500/20 rounded-full"
                data-testid="button-save-flag-thresholds"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saveFlagThresholds.isPending ? "Saving..." : "Save Thresholds"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <MasterFlagConfigSection />

      <UserManagementSection />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25 }}>
        <Card className="glass-card rounded-2xl border-0 overflow-visible">
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="section-icon">
              <SettingsIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Column Mapping</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">CSV column configuration</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {savedMapping ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Active Mapping Configuration</p>
                    <p className="text-xs text-muted-foreground">
                      Saved on {savedMapping.createdAt ? new Date(savedMapping.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}
                    </p>
                  </div>
                  <Badge variant="secondary" className="bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0 shadow-sm rounded-lg">Active</Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(savedMapping.mapping as Record<string, string>).map(([sysField, csvCol]) => (
                    <div key={sysField} className="flex items-center gap-2 text-sm py-2 px-3 rounded-xl bg-muted/30 dark:bg-muted/20">
                      <span className="text-muted-foreground text-xs">{sysField}:</span>
                      <span className="font-semibold text-xs">{csvCol}</span>
                    </div>
                  ))}
                </div>

                <Separator className="opacity-30" />

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMappingMutation.mutate()}
                  disabled={deleteMappingMutation.isPending}
                  className="rounded-full"
                  data-testid="button-reset-mapping"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Reset Mapping
                </Button>
                <p className="text-xs text-muted-foreground">
                  Resetting will require you to remap columns on your next upload.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No column mapping configured yet. Upload a file to set up the mapping.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
        <Card className="glass-card rounded-2xl border-0 overflow-visible">
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="section-icon">
              <History className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Data Management</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Manage statuses and activity data</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl bg-muted/30 dark:bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-semibold">Reset Current Statuses</p>
                <p className="text-xs text-muted-foreground">
                  Reset all statuses to "No Update" without deleting activity history. Useful for new collection cycles.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                      data-testid="button-reset-statuses"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Reset Statuses
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset All Statuses</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reset all tenant payment statuses to "No Update" (except tenants with zero amount due). Activity history will be preserved. This is useful when starting a new collection cycle.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-reset-statuses">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetStatusesMutation.mutate()}
                        data-testid="button-confirm-reset-statuses"
                      >
                        {resetStatusesMutation.isPending ? "Resetting..." : "Reset Statuses"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="rounded-xl bg-muted/30 dark:bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-semibold">Clear All Activity History</p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete all remarks, follow-ups, and status updates. Cannot be reversed.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="rounded-full"
                      data-testid="button-clear-activity"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      Clear Activity History
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear All Activity History</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all activity records including remarks, follow-ups, and status updates for every tenant. This action cannot be undone. Tenant financial data from uploads will not be affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-clear-activity">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteActivityMutation.mutate()}
                        className="bg-destructive text-destructive-foreground"
                        data-testid="button-confirm-clear-activity"
                      >
                        {deleteActivityMutation.isPending ? "Clearing..." : "Clear Everything"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="rounded-xl bg-muted/30 dark:bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-semibold">Reset Status by City</p>
                <p className="text-xs text-muted-foreground">
                  Reset statuses to "No Update" for tenants in a specific city. Activity history will be preserved.
                </p>
                <Select value={resetCity} onValueChange={setResetCity}>
                  <SelectTrigger className="h-8 text-xs rounded-lg" data-testid="select-reset-city">
                    <SelectValue placeholder="Select city" />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions?.cities?.map((c: string) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                      disabled={!resetCity}
                      data-testid="button-reset-statuses-city"
                    >
                      <MapPin className="w-3.5 h-3.5 mr-1.5" />
                      Reset Status for Selected City
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Statuses for City</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reset all tenant payment statuses to "No Update" for tenants in <span className="font-semibold">{resetCity}</span> (except tenants with zero amount due). Activity history will be preserved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-reset-city">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetCityMutation.mutate()}
                        data-testid="button-confirm-reset-city"
                      >
                        {resetCityMutation.isPending ? "Resetting..." : "Reset Statuses"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="rounded-xl bg-muted/30 dark:bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-semibold">Reset Status by Property</p>
                <p className="text-xs text-muted-foreground">
                  Reset statuses to "No Update" for tenants in a specific property. Activity history will be preserved.
                </p>
                <Select value={resetProperty} onValueChange={setResetProperty}>
                  <SelectTrigger className="h-8 text-xs rounded-lg" data-testid="select-reset-property">
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions?.properties?.map((p: string) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                      disabled={!resetProperty}
                      data-testid="button-reset-statuses-property"
                    >
                      <Building2 className="w-3.5 h-3.5 mr-1.5" />
                      Reset Status for Selected Property
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset Statuses for Property</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reset all tenant payment statuses to "No Update" for tenants in <span className="font-semibold">{resetProperty}</span> (except tenants with zero amount due). Activity history will be preserved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-reset-property">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => resetPropertyMutation.mutate()}
                        data-testid="button-confirm-reset-property"
                      >
                        {resetPropertyMutation.isPending ? "Resetting..." : "Reset Statuses"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {resetLogs && resetLogs.length > 0 && (
              <>
                <Separator className="opacity-30" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Reset History</p>
                  <div className="space-y-2">
                    {resetLogs.map((log) => (
                      <div key={log.id} className="flex items-center gap-3 text-sm py-2 px-3 rounded-xl bg-muted/30 dark:bg-muted/20" data-testid={`reset-log-${log.id}`}>
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold text-xs">{log.resetBy}</span>
                          <span className="text-muted-foreground text-xs">
                            {" "}{log.resetType === "reset_statuses" ? "reset statuses for" : "cleared"} {log.recordsDeleted} records
                          </span>
                          {log.resetScope && (
                            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                              {log.resetScope}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
