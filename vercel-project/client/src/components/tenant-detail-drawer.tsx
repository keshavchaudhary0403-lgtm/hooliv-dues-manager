import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUsername } from "@/components/username-provider";
import { useAuth } from "@/components/auth-provider";
import { Phone, Calendar, IndianRupee, Send, Clock, CalendarClock, Users, ClipboardEdit, X, CircleDot, Plus, Trash2, Ticket, ChevronDown, ChevronUp, ImagePlus, Loader2, AlertTriangle, Banknote, RefreshCw, LogOut } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import type { Tenant, ActivityLog } from "@shared/schema";
import { PAID_SUB_REASONS, TICKET_REQUIRING_SUB_REASONS } from "@shared/schema";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function InfoRow({ icon: Icon, label, value, isPhone }: { icon: any; label: string; value: string; isPhone?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {isPhone && value && value !== "\u2014" ? (
        <a href={`tel:${value}`} className="section-icon flex-shrink-0 mt-0.5 w-8 h-8 hover:bg-primary/20 transition-colors" data-testid={`link-phone-icon-${label.toLowerCase().replace(/\s/g, "-")}`}>
          <Icon className="w-3.5 h-3.5 text-primary" />
        </a>
      ) : (
        <div className="section-icon flex-shrink-0 mt-0.5 w-8 h-8">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        {isPhone && value && value !== "\u2014" ? (
          <a href={`tel:${value}`} className="text-sm font-semibold truncate block hover:text-primary transition-colors" data-testid={`link-phone-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</a>
        ) : (
          <p className="text-sm font-semibold truncate">{value || "\u2014"}</p>
        )}
      </div>
    </div>
  );
}

function getFollowUpStatus(followUpDate: string | null): { label: string; variant: "upcoming" | "completed" | "overdue" } {
  if (!followUpDate) return { label: "No Date", variant: "upcoming" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fDate = new Date(followUpDate);
  fDate.setHours(0, 0, 0, 0);
  if (fDate < today) return { label: "Overdue", variant: "overdue" };
  if (fDate.getTime() === today.getTime()) return { label: "Today", variant: "upcoming" };
  return { label: "Upcoming", variant: "upcoming" };
}

function FollowUpStatusBadge({ status }: { status: { label: string; variant: "upcoming" | "completed" | "overdue" } }) {
  const styles = {
    upcoming: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0 shadow-sm",
    completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 shadow-sm",
    overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 shadow-sm",
  };
  return (
    <Badge variant="secondary" className={`text-[10px] rounded-lg ${styles[status.variant]}`}>
      {status.label}
    </Badge>
  );
}

const STATUS_LABELS: Record<string, string> = {
  no_update: "No Update",
  pending: "Pending",
  paid: "Paid",
  partial_payment: "Partial Payment",
  not_responding: "Not Responding",
  refund_adjustment: "Refund Adjustment",
  payment_not_updated: "Payment Not Updated",
};

function getPaymentStatusBadge(status: string) {
  const label = STATUS_LABELS[status] || status;
  switch (status) {
    case "paid":
    case "already_paid":
      return <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 shadow-sm rounded-lg">{status === "already_paid" ? "Already Paid" : label}</Badge>;
    case "partial_payment":
      return <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
    case "not_responding":
      return <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
    case "refund_adjustment":
      return <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
    case "payment_not_updated":
      return <Badge variant="secondary" className="text-[10px] bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
    case "no_update":
      return <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border-0 shadow-sm rounded-lg">{label}</Badge>;
  }
}

interface Commitment {
  amount: string;
  date: string;
}

export function TenantDetailDrawer({
  tenant,
  open,
  onClose,
}: {
  tenant: Tenant | null;
  open: boolean;
  onClose: () => void;
}) {
  const [followUpDate, setFollowUpDate] = useState("");
  const [remarkText, setRemarkText] = useState("");
  const [activityStatus, setActivityStatus] = useState("");
  const [paidSubReason, setPaidSubReason] = useState("");
  const [commitments, setCommitments] = useState<Commitment[]>([{ amount: "", date: "" }]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const { username } = useUsername();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketUrgency, setTicketUrgency] = useState("");
  const [ticketAssigneeId, setTicketAssigneeId] = useState("");
  const [ticketImages, setTicketImages] = useState<File[]>([]);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [mandatoryTicketPending, setMandatoryTicketPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSubReasonRef = useRef<string>("");
  const pendingInlineCollectedRef = useRef<{ amount: number; date: string; mode: string; reference: string; image: File | null } | null>(null);
  const lastCreatedActivityIdRef = useRef<number | null>(null);
  const [, navigate] = useLocation();

  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);

  const [inlineCollectedAmount, setInlineCollectedAmount] = useState("");
  const [inlineCollectedDate, setInlineCollectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [inlineCollectedMode, setInlineCollectedMode] = useState("");
  const [inlineCollectedReference, setInlineCollectedReference] = useState("");
  const [inlineCollectedImage, setInlineCollectedImage] = useState<File | null>(null);
  const inlineCollectedFileRef = useRef<HTMLInputElement>(null);
  const [inlineCollectedErrors, setInlineCollectedErrors] = useState<Record<string, string>>({});

  const [pnuClaimedAmount, setPnuClaimedAmount] = useState("");
  const [pnuClaimedDate, setPnuClaimedDate] = useState(new Date().toISOString().slice(0, 10));
  const [pnuPaymentMode, setPnuPaymentMode] = useState("");
  const [pnuReference, setPnuReference] = useState("");
  const [pnuRemarks, setPnuRemarks] = useState("");
  const [pnuProofImage, setPnuProofImage] = useState<File | null>(null);
  const pnuProofRef = useRef<HTMLInputElement>(null);
  const [pnuErrors, setPnuErrors] = useState<Record<string, string>>({});
  const pendingPnuRef = useRef<{ amount: number; date: string; mode: string; reference: string; remarks: string; image: File | null } | null>(null);

  const effectiveStatus = optimisticStatus || tenant?.paymentStatus;

  useEffect(() => {
    if (tenant) {
      setOptimisticStatus(null);
    }
  }, [tenant?.paymentStatus]);

  const { data: activityLog = [], isLoading: activityLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/tenants", tenant?.id, "activity"],
    enabled: !!tenant,
  });

  const { data: openTicketCount = 0 } = useQuery<number>({
    queryKey: ["/api/tickets/open-count", tenant?.primaryPhone],
    queryFn: async () => {
      if (!tenant?.primaryPhone) return 0;
      const res = await fetch(`/api/tickets/open-count/${encodeURIComponent(tenant.primaryPhone)}`, { credentials: "include" });
      if (!res.ok) return 0;
      const data = await res.json();
      return data.count ?? 0;
    },
    enabled: !!tenant?.primaryPhone,
  });

  const { data: teamMembers = [], isLoading: teamMembersLoading } = useQuery<Array<{ id: number; displayName: string; phone: string; role: string }>>({
    queryKey: ["/api/team-members", "active=true", tenant?.city],
    queryFn: async () => {
      const params = new URLSearchParams({ active: "true" });
      if (tenant?.city) params.set("city", tenant.city);
      const res = await fetch(`/api/team-members?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: ticketOpen,
  });

  const { data: partialHandler } = useQuery({
    queryKey: ["/api/partial-payment-handlers/lookup", tenant?.city, tenant?.propertyName],
    queryFn: async () => {
      const res = await fetch(`/api/partial-payment-handlers/lookup?city=${encodeURIComponent(tenant!.city)}&property=${encodeURIComponent(tenant!.propertyName)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!tenant && (effectiveStatus === "partial_payment" || activityStatus === "partial_payment" || activityStatus === "payment_not_updated"),
  });

  const resetTicketForm = () => {
    setTicketDescription("");
    setTicketUrgency("");
    setTicketAssigneeId("");
    setTicketImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !ticketUrgency || !ticketAssigneeId) return;

    const selectedMember = teamMembers.find((m) => String(m.id) === ticketAssigneeId);
    if (!selectedMember) return;

    setTicketSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("tenantPhone", tenant.primaryPhone);
      formData.append("tenantId", String(tenant.id));
      formData.append("tenantName", tenant.tenantName);
      if (tenant.roomNo) formData.append("roomNo", tenant.roomNo);
      formData.append("city", tenant.city);
      formData.append("propertyName", tenant.propertyName);
      formData.append("raisedBy", username);
      formData.append("assigneeId", String(selectedMember.id));
      formData.append("assigneeName", selectedMember.displayName);
      formData.append("urgency", ticketUrgency);
      formData.append("description", ticketDescription.trim());
      if (mandatoryTicketPending && pendingSubReasonRef.current) {
        formData.append("subReason", pendingSubReasonRef.current);
      }
      ticketImages.forEach((file) => formData.append("images", file));

      const res = await fetch("/api/tickets", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Failed to create ticket");
      }

      const ticketData = await res.json();
      if (lastCreatedActivityIdRef.current && ticketData?.id) {
        try {
          await apiRequest("PATCH", `/api/activity/${lastCreatedActivityIdRef.current}/link-ticket`, { ticketId: ticketData.id });
          queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant?.id, "activity"] });
        } catch {}
      }
      toast({ title: "Ticket created", description: "Your ticket has been raised successfully." });
      lastCreatedActivityIdRef.current = null;
      resetTicketForm();
      setTicketOpen(false);
      setMandatoryTicketPending(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets/open-count", tenant.primaryPhone] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create ticket.", variant: "destructive" });
    } finally {
      setTicketSubmitting(false);
    }
  };

  const handleTicketImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setTicketImages((prev) => {
      const combined = [...prev, ...files].slice(0, 5);
      return combined;
    });
  };

  const removeTicketImage = (idx: number) => {
    setTicketImages((prev) => prev.filter((_, i) => i !== idx));
  };


  const handleClose = useCallback(() => {
    if (mandatoryTicketPending) {
      toast({ title: "Ticket required", description: "Please raise the mandatory ticket before closing.", variant: "destructive" });
      return;
    }
    onClose();
  }, [mandatoryTicketPending, onClose, toast]);

  useEffect(() => {
    if (activityStatus !== "partial_payment") {
      setCommitments([{ amount: "", date: "" }]);
    }
    if (activityStatus !== "paid") {
      setPaidSubReason("");
    }
    setFormErrors({});
  }, [activityStatus]);

  const addFollowUp = useMutation({
    mutationFn: async (data: { tenantId: number; followUpDate: string; remarkText: string; createdBy: string; status: string; metadata?: any }) => {
      const res = await apiRequest("POST", `/api/tenants/${data.tenantId}/activity`, {
        activityType: "FOLLOW_UP",
        followUpDate: data.followUpDate,
        remarkText: data.remarkText,
        createdBy: data.createdBy,
        status: data.status,
        metadata: data.metadata || null,
      });
      const activity = await res.json();
      lastCreatedActivityIdRef.current = activity.id;
      return activity;
    },
    onSuccess: async (_data, variables) => {
      if (variables.status) {
        setOptimisticStatus(variables.status);
      }
      const submittedSubReason = pendingSubReasonRef.current;
      const collectedPayment = pendingInlineCollectedRef.current;
      const pnuPayment = pendingPnuRef.current;

      setFollowUpDate("");
      setRemarkText("");
      setActivityStatus("");
      setPaidSubReason("");
      setCommitments([{ amount: "", date: "" }]);
      setFormErrors({});
      setInlineCollectedAmount("");
      setInlineCollectedDate(new Date().toISOString().slice(0, 10));
      setInlineCollectedMode("");
      setInlineCollectedReference("");
      setInlineCollectedImage(null);
      setInlineCollectedErrors({});
      if (inlineCollectedFileRef.current) inlineCollectedFileRef.current.value = "";
      setPnuClaimedAmount("");
      setPnuClaimedDate(new Date().toISOString().slice(0, 10));
      setPnuPaymentMode("");
      setPnuReference("");
      setPnuRemarks("");
      setPnuProofImage(null);
      setPnuErrors({});
      if (pnuProofRef.current) pnuProofRef.current.value = "";
      pendingSubReasonRef.current = "";
      pendingInlineCollectedRef.current = null;
      pendingPnuRef.current = null;

      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant?.id, "activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/filter-options"] });

      if (collectedPayment && tenant) {
        try {
          const handler = partialHandler;
          const fallbackAssigneeId = handler?.teamMemberId || authUser?.id || 0;
          const fallbackAssigneeName = handler?.memberName || authUser?.displayName || "Unassigned";
          const refLabel = collectedPayment.mode === "Cheque" ? "Cheque" : "UTR";

          const formData = new FormData();
          formData.append("tenantPhone", tenant.primaryPhone);
          formData.append("tenantId", String(tenant.id));
          formData.append("tenantName", tenant.tenantName);
          if (tenant.roomNo) formData.append("roomNo", tenant.roomNo);
          formData.append("city", tenant.city);
          formData.append("propertyName", tenant.propertyName);
          formData.append("raisedBy", username);
          formData.append("assigneeId", String(fallbackAssigneeId));
          formData.append("assigneeName", fallbackAssigneeName);
          formData.append("urgency", "medium");
          formData.append("subReason", "Partial Payment Report");
          formData.append("description", "");
          if (collectedPayment.image) {
            formData.append("images", collectedPayment.image);
          }

          const res = await fetch("/api/tickets", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (res.ok) {
            const ticketData = await res.json();
            if (lastCreatedActivityIdRef.current && ticketData?.id) {
              try {
                await apiRequest("PATCH", `/api/activity/${lastCreatedActivityIdRef.current}/link-ticket`, { ticketId: ticketData.id });
              } catch {}
            }
            lastCreatedActivityIdRef.current = null;
            await apiRequest("POST", `/api/tenants/${tenant.id}/activity`, {
              activityType: "REMARK",
              remarkText: `Partial Payment Reported - ${formatCurrency(collectedPayment.amount)} via ${collectedPayment.mode} (${refLabel}: ${collectedPayment.reference}) on ${collectedPayment.date}`,
              createdBy: username,
              metadata: {
                partialPaymentAmount: collectedPayment.amount,
                partialPayment: {
                  amount: collectedPayment.amount,
                  date: collectedPayment.date,
                  mode: collectedPayment.mode,
                  reference: collectedPayment.reference,
                },
              },
            });
            queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tickets/open-count", tenant.primaryPhone] });
            queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "activity"] });
            toast({ title: "Activity saved & payment ticket created", description: "Commitments saved and a partial payment update request has been raised." });
          } else {
            toast({ title: "Activity saved but ticket failed", description: "Commitments saved. However, the payment update ticket could not be created.", variant: "destructive" });
          }
        } catch {
          toast({ title: "Activity saved but ticket failed", description: "Commitments saved. However, the payment update ticket could not be created.", variant: "destructive" });
        }
        return;
      }

      if (pnuPayment && tenant) {
        try {
          const handler = partialHandler;
          const fallbackAssigneeId = handler?.teamMemberId || authUser?.id || 0;
          const fallbackAssigneeName = handler?.memberName || authUser?.displayName || "Unassigned";
          const refLabel = pnuPayment.mode === "Cheque" ? "Cheque No" : pnuPayment.mode === "Cash" ? "" : "UTR";
          const refPart = refLabel ? ` (${refLabel}: ${pnuPayment.reference})` : "";
          const desc = `Payment Not Updated - Claimed ₹${pnuPayment.amount.toLocaleString()} via ${pnuPayment.mode}${refPart} on ${pnuPayment.date}${pnuPayment.remarks ? `\nRemarks: ${pnuPayment.remarks}` : ""}`;

          const formData = new FormData();
          formData.append("tenantPhone", tenant.primaryPhone);
          formData.append("tenantId", String(tenant.id));
          formData.append("tenantName", tenant.tenantName);
          if (tenant.roomNo) formData.append("roomNo", tenant.roomNo);
          formData.append("city", tenant.city);
          formData.append("propertyName", tenant.propertyName);
          formData.append("raisedBy", username);
          formData.append("assigneeId", String(fallbackAssigneeId));
          formData.append("assigneeName", fallbackAssigneeName);
          formData.append("urgency", "medium");
          formData.append("subReason", "Payment Update Request");
          formData.append("description", desc);
          if (pnuPayment.image) {
            formData.append("images", pnuPayment.image);
          }

          const res = await fetch("/api/tickets", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (res.ok) {
            const ticketData = await res.json();
            if (lastCreatedActivityIdRef.current && ticketData?.id) {
              try {
                await apiRequest("PATCH", `/api/activity/${lastCreatedActivityIdRef.current}/link-ticket`, { ticketId: ticketData.id });
              } catch {}
            }
            lastCreatedActivityIdRef.current = null;
            await apiRequest("POST", `/api/tenants/${tenant.id}/activity`, {
              activityType: "REMARK",
              remarkText: `Payment Update Request - Claimed ₹${pnuPayment.amount.toLocaleString()} via ${pnuPayment.mode}${refPart} on ${pnuPayment.date}`,
              createdBy: username,
              metadata: {
                paymentUpdateRequest: {
                  amount: pnuPayment.amount,
                  date: pnuPayment.date,
                  mode: pnuPayment.mode,
                  reference: pnuPayment.reference,
                  remarks: pnuPayment.remarks,
                },
              },
            });
            queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tickets/open-count", tenant.primaryPhone] });
            queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant.id, "activity"] });
            toast({ title: "Status updated & Payment Update Request created", description: "A Payment Update Request has been automatically raised." });
          } else {
            toast({ title: "Status updated but ticket failed", description: "The Payment Update Request could not be created.", variant: "destructive" });
          }
        } catch {
          toast({ title: "Status updated but ticket failed", description: "The Payment Update Request could not be created.", variant: "destructive" });
        }
        return;
      }

      if (submittedSubReason && (TICKET_REQUIRING_SUB_REASONS as readonly string[]).includes(submittedSubReason)) {
        toast({ 
          title: "Activity update added", 
          description: "A ticket is required for this sub-reason. Please fill in the ticket details below."
        });
        setTicketOpen(true);
        setMandatoryTicketPending(true);
        setTicketDescription("");
        setTicketUrgency("medium");
      } else {
        toast({ title: "Activity update added", description: "Your activity update has been saved." });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save activity update.", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const noFollowUpStatuses = ["paid", "refund_adjustment", "payment_not_updated"];
    const isTicketRequired = activityStatus === "paid" && tenant && tenant.totalAmountDue > 0 && paidSubReason && (TICKET_REQUIRING_SUB_REASONS as readonly string[]).includes(paidSubReason);
    if (!activityStatus) errors.status = "Status is required";
    if (!followUpDate && !noFollowUpStatuses.includes(activityStatus)) errors.date = "Follow up date is required";
    if (!isTicketRequired && activityStatus !== "payment_not_updated" && !remarkText.trim()) errors.remark = "Remark is required";

    if (activityStatus === "paid" && tenant && tenant.totalAmountDue > 0) {
      if (!paidSubReason) errors.subReason = "Sub-reason is required when Amount Due > 0";
    }

    if (activityStatus === "partial_payment" && tenant) {
      const totalCommitment = commitments.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
      const hasEmptyCommitments = commitments.some(c => !c.amount || !c.date);
      const targetAmount = remainingDue > 0 ? remainingDue : tenant.totalAmountDue;
      const collectedAmt = parseFloat(inlineCollectedAmount) || 0;
      const totalWithCollected = totalCommitment + collectedAmt;

      if (hasEmptyCommitments) {
        errors.commitments = "All commitment fields are required";
      } else if (Math.abs(totalWithCollected - targetAmount) > 0.01) {
        const label = totalPartialPaymentsReported > 0
          ? `Remaining Due (${formatCurrency(targetAmount)})`
          : `Amount Due (${formatCurrency(targetAmount)})`;
        errors.commitments = `Commitment total (${formatCurrency(totalCommitment)})${collectedAmt > 0 ? ` + Collected (${formatCurrency(collectedAmt)})` : ""} must equal ${label}`;
      }

      if (collectedAmt > 0) {
        if (!inlineCollectedDate) errors.inlineCollectedDate = "Payment date is required";
        if (!inlineCollectedMode) errors.inlineCollectedMode = "Payment mode is required";
        if ((inlineCollectedMode === "UPI" || inlineCollectedMode === "Bank Transfer") && !inlineCollectedReference.trim()) {
          errors.inlineCollectedRef = "UTR Number is required";
        }
        if (inlineCollectedMode === "Cheque" && !inlineCollectedReference.trim()) {
          errors.inlineCollectedRef = "Cheque Number is required";
        }
      }
    }

    if (activityStatus === "payment_not_updated") {
      const claimedAmt = parseFloat(pnuClaimedAmount) || 0;
      if (claimedAmt <= 0) errors.pnuClaimedAmount = "Claimed payment amount is required";
      if (!pnuClaimedDate) errors.pnuClaimedDate = "Claimed payment date is required";
      if (!pnuPaymentMode) errors.pnuPaymentMode = "Payment mode is required";
      if ((pnuPaymentMode === "UPI" || pnuPaymentMode === "Bank Transfer") && !pnuReference.trim()) {
        errors.pnuReference = "UTR Number is required";
      }
      if (pnuPaymentMode === "Cheque" && !pnuReference.trim()) {
        errors.pnuReference = "Cheque Number is required";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    if (!tenant) return;
    setFormErrors({});

    let metadata: any = { status: activityStatus };

    if (activityStatus === "paid" && tenant.totalAmountDue > 0 && paidSubReason) {
      metadata.subReason = paidSubReason;
    }

    if (activityStatus === "payment_not_updated") {
      metadata.subReason = "Payment Update Ticket";
      metadata.claimedPayment = {
        amount: parseFloat(pnuClaimedAmount) || 0,
        date: pnuClaimedDate,
        mode: pnuPaymentMode,
        reference: pnuReference.trim(),
        remarks: pnuRemarks.trim(),
      };
    }

    if (activityStatus === "partial_payment") {
      metadata.commitments = commitments.map((c, i) => ({
        label: `Commitment ${i + 1}`,
        amount: parseFloat(c.amount) || 0,
        date: c.date,
      }));
      const collectedAmt = parseFloat(inlineCollectedAmount) || 0;
      if (collectedAmt > 0) {
        metadata.inlineCollectedPayment = {
          amount: collectedAmt,
          date: inlineCollectedDate,
          mode: inlineCollectedMode,
          reference: inlineCollectedReference.trim(),
        };
      }
    }

    pendingSubReasonRef.current = paidSubReason;
    pendingPnuRef.current = activityStatus === "payment_not_updated" ? {
      amount: parseFloat(pnuClaimedAmount) || 0,
      date: pnuClaimedDate,
      mode: pnuPaymentMode,
      reference: pnuReference.trim(),
      remarks: pnuRemarks.trim(),
      image: pnuProofImage,
    } : null;
    pendingInlineCollectedRef.current = (parseFloat(inlineCollectedAmount) || 0) > 0 ? {
      amount: parseFloat(inlineCollectedAmount),
      date: inlineCollectedDate,
      mode: inlineCollectedMode,
      reference: inlineCollectedReference.trim(),
      image: inlineCollectedImage,
    } : null;
    addFollowUp.mutate({
      tenantId: tenant.id,
      followUpDate: followUpDate || "",
      remarkText: remarkText.trim(),
      createdBy: username,
      status: activityStatus,
      metadata,
    });
  };

  const noFollowUpStatuses = ["paid", "refund_adjustment", "payment_not_updated"];
  const isTicketRequiredForSubmit = (activityStatus === "paid" && tenant && tenant.totalAmountDue > 0 && paidSubReason && (TICKET_REQUIRING_SUB_REASONS as readonly string[]).includes(paidSubReason));
  const isPnuStatus = activityStatus === "payment_not_updated";
  const canSubmit = (followUpDate || noFollowUpStatuses.includes(activityStatus)) && (remarkText.trim() || isTicketRequiredForSubmit || isPnuStatus) && activityStatus;

  const addCommitment = () => {
    setCommitments(prev => [...prev, { amount: "", date: "" }]);
  };

  const removeCommitment = (idx: number) => {
    setCommitments(prev => prev.filter((_, i) => i !== idx));
  };

  const updateCommitment = (idx: number, field: keyof Commitment, value: string) => {
    setCommitments(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
    setFormErrors(prev => ({ ...prev, commitments: undefined } as any));
  };

  const commitmentTotal = commitments.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

  const totalPartialPaymentsReported = activityLog
    .filter((a: any) => a.metadata?.partialPaymentAmount)
    .reduce((sum: number, a: any) => sum + (Number(a.metadata.partialPaymentAmount) || 0), 0);

  const remainingDue = tenant ? Math.max(0, tenant.totalAmountDue - totalPartialPaymentsReported) : 0;

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") handleClose();
  }, [handleClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [open, handleEsc]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setMousePos({ x, y });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMousePos({ x: 0, y: 0 });
  }, []);

  if (!tenant) return null;

  const tiltX = mousePos.y * -3;
  const tiltY = mousePos.x * 3;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="modal-tenant-detail">
          <motion.div
            className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={handleClose}
            data-testid="modal-overlay"
          />

          <motion.div
            ref={cardRef}
            className="relative w-full max-w-lg max-h-[85vh] z-10 rounded-3xl overflow-hidden"
            style={{
              background: "hsl(var(--card) / 0.88)",
              backdropFilter: "blur(32px) saturate(1.5)",
              WebkitBackdropFilter: "blur(32px) saturate(1.5)",
              boxShadow: "0 32px 80px -16px rgba(0,0,0,0.2), 0 0 0 1.5px hsl(var(--border)), inset 0 1px 0 rgba(255,255,255,0.15)",
              transform: `perspective(1200px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
              transition: "transform 0.15s ease-out",
            }}
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 24 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{ background: "linear-gradient(135deg, hsl(160 84% 39% / 0.05) 0%, hsl(160 60% 45% / 0.03) 50%, transparent 100%)" }} />

            <div className="relative flex flex-col max-h-[85vh]">
              <div className="flex items-start justify-between gap-3 p-6 pb-4 bg-gradient-to-br from-emerald-500/6 to-emerald-600/4 dark:from-emerald-500/10 dark:to-emerald-600/6 border-b border-border dark:border-border">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight truncate" data-testid="text-tenant-detail-name">
                    {tenant.tenantName}
                    {tenant.roomNo && <span className="text-sm font-normal text-muted-foreground ml-2">| {tenant.roomNo}</span>}
                  </h2>
                  <p className="text-sm text-muted-foreground">{tenant.city} &middot; {tenant.propertyName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {openTicketCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 shadow-sm rounded-lg" data-testid="badge-open-tickets">
                      {openTicketCount} open
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-xs"
                    onClick={() => setTicketOpen((v) => !v)}
                    data-testid="button-raise-ticket"
                  >
                    <Ticket className="w-3.5 h-3.5 mr-1" />
                    Raise Ticket
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleClose}
                    className="flex-shrink-0 rounded-full"
                    data-testid="button-close-modal"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5" style={{ scrollbarWidth: "thin" }}>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow icon={IndianRupee} label="Amount Due" value={formatCurrency(tenant.totalAmountDue)} />
                  <InfoRow icon={Calendar} label="Due Date" value={tenant.dueDate || "\u2014"} />
                  <InfoRow icon={Phone} label="Tenant Phone" value={tenant.primaryPhone || "\u2014"} isPhone />
                  {tenant.parentName && (
                    <InfoRow icon={Users} label="Parent Name" value={tenant.parentName} />
                  )}
                  {tenant.parentPhone && (
                    <InfoRow icon={Phone} label="Parent Phone" value={tenant.parentPhone} isPhone />
                  )}
                  <InfoRow icon={Calendar} label="Check-in Date" value={tenant.checkInDate || "\u2014"} />
                  {tenant.rentalBillingCycle && (
                    <InfoRow icon={RefreshCw} label="Billing Cycle" value={tenant.rentalBillingCycle} />
                  )}
                  {tenant.checkoutNoticeDate && (
                    <InfoRow icon={LogOut} label="Checkout Notice Date" value={tenant.checkoutNoticeDate} />
                  )}
                  {tenant.expectedCheckoutDate && (
                    <InfoRow icon={LogOut} label="Expected Checkout" value={tenant.expectedCheckoutDate} />
                  )}
                </div>

                <div
                  className="rounded-2xl p-[1.5px] mt-1"
                  style={{
                    background: "linear-gradient(135deg, hsl(160 84% 39% / 0.5), hsl(160 60% 45% / 0.35), hsl(var(--border)))",
                  }}
                >
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      background: "hsl(var(--card) / 0.92)",
                      boxShadow: "0 4px 24px -6px hsl(160 84% 39% / 0.08), 0 2px 8px -2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="section-icon w-7 h-7">
                        <ClipboardEdit className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-semibold">Activity Update</h3>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div
                          className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-foreground/70 dark:text-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="w-3 h-3" />
                            Follow Up Date
                          </label>
                          <Input
                            type="date"
                            value={followUpDate}
                            onChange={(e) => { setFollowUpDate(e.target.value); setFormErrors(prev => ({ ...prev, date: undefined } as any)); }}
                            className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-all ${formErrors.date ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                            data-testid="input-followup-date"
                          />
                          {formErrors.date && <p className="text-[10px] text-destructive">{formErrors.date}</p>}
                        </div>
                        <div
                          className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-foreground/70 dark:text-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
                            <CircleDot className="w-3 h-3" />
                            Status
                          </label>
                          <Select value={activityStatus} onValueChange={(v) => { setActivityStatus(v); setFormErrors(prev => ({ ...prev, status: undefined } as any)); }}>
                            <SelectTrigger className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-all ${formErrors.status ? "border-destructive ring-1 ring-destructive/30" : ""}`} data-testid="select-activity-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="partial_payment">Partial Payment</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="not_responding">Not Responding</SelectItem>
                              <SelectItem value="refund_adjustment">Refund Adjustment</SelectItem>
                              <SelectItem value="payment_not_updated">Payment Not Updated</SelectItem>
                            </SelectContent>
                          </Select>
                          {formErrors.status && <p className="text-[10px] text-destructive">{formErrors.status}</p>}
                        </div>
                      </div>

                      {activityStatus === "paid" && tenant.totalAmountDue > 0 && (
                        <div
                          className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-foreground/70 dark:text-foreground/60 uppercase tracking-wider">Sub-Reason (Required)</label>
                          <Select value={paidSubReason} onValueChange={(v) => { setPaidSubReason(v); setFormErrors(prev => ({ ...prev, subReason: undefined } as any)); }}>
                            <SelectTrigger className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.subReason ? "border-destructive ring-1 ring-destructive/30" : ""}`} data-testid="select-paid-sub-reason">
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                            <SelectContent>
                              {PAID_SUB_REASONS.map((reason) => (
                                <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {formErrors.subReason && <p className="text-[10px] text-destructive">{formErrors.subReason}</p>}
                          {paidSubReason && (TICKET_REQUIRING_SUB_REASONS as readonly string[]).includes(paidSubReason) && (
                            <div className="flex items-center gap-1.5 mt-1.5 p-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/30">
                              <Ticket className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                              <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">A ticket will be required after submitting this update</p>
                            </div>
                          )}
                        </div>
                      )}

                      {activityStatus === "payment_not_updated" && (
                        <div
                          className="rounded-xl p-3 space-y-3 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <div className="flex items-center gap-1.5 p-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/30">
                            <Ticket className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">A Payment Update Request will be auto-created upon submission</p>
                          </div>

                          <label className="text-[11px] font-semibold text-foreground/70 dark:text-foreground/60 uppercase tracking-wider">Payment Update Form (Mandatory)</label>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">Claimed Amount *</label>
                              <Input
                                type="number"
                                placeholder="Amount"
                                value={pnuClaimedAmount}
                                onChange={(e) => { setPnuClaimedAmount(e.target.value); setFormErrors(prev => ({ ...prev, pnuClaimedAmount: undefined } as any)); }}
                                className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.pnuClaimedAmount ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                                data-testid="input-pnu-claimed-amount"
                              />
                              {formErrors.pnuClaimedAmount && <p className="text-[10px] text-destructive">{formErrors.pnuClaimedAmount}</p>}
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">Claimed Date *</label>
                              <Input
                                type="date"
                                value={pnuClaimedDate}
                                onChange={(e) => { setPnuClaimedDate(e.target.value); setFormErrors(prev => ({ ...prev, pnuClaimedDate: undefined } as any)); }}
                                className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.pnuClaimedDate ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                                data-testid="input-pnu-claimed-date"
                              />
                              {formErrors.pnuClaimedDate && <p className="text-[10px] text-destructive">{formErrors.pnuClaimedDate}</p>}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Payment Mode *</label>
                            <Select value={pnuPaymentMode} onValueChange={(v) => { setPnuPaymentMode(v); setFormErrors(prev => ({ ...prev, pnuPaymentMode: undefined, pnuReference: undefined } as any)); }}>
                              <SelectTrigger className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.pnuPaymentMode ? "border-destructive ring-1 ring-destructive/30" : ""}`} data-testid="select-pnu-payment-mode">
                                <SelectValue placeholder="Select mode" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UPI">UPI</SelectItem>
                                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                                <SelectItem value="Cheque">Cheque</SelectItem>
                                <SelectItem value="Cash">Cash</SelectItem>
                              </SelectContent>
                            </Select>
                            {formErrors.pnuPaymentMode && <p className="text-[10px] text-destructive">{formErrors.pnuPaymentMode}</p>}
                          </div>

                          {pnuPaymentMode && pnuPaymentMode !== "Cash" && (
                            <div className="space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">{pnuPaymentMode === "Cheque" ? "Cheque No. *" : "UTR No. *"}</label>
                              <Input
                                placeholder={pnuPaymentMode === "Cheque" ? "Cheque number" : "UTR number"}
                                value={pnuReference}
                                onChange={(e) => { setPnuReference(e.target.value); setFormErrors(prev => ({ ...prev, pnuReference: undefined } as any)); }}
                                className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.pnuReference ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                                data-testid="input-pnu-reference"
                              />
                              {formErrors.pnuReference && <p className="text-[10px] text-destructive">{formErrors.pnuReference}</p>}
                            </div>
                          )}

                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Remarks / Notes</label>
                            <Textarea
                              placeholder="Additional remarks..."
                              value={pnuRemarks}
                              onChange={(e) => setPnuRemarks(e.target.value)}
                              className="resize-none text-sm min-h-[50px] bg-background/80 dark:bg-background/40 rounded-lg border-border"
                              data-testid="input-pnu-remarks"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                              <ImagePlus className="w-3 h-3" />
                              Proof (optional)
                            </label>
                            <input
                              ref={pnuProofRef}
                              type="file"
                              accept="image/*,.pdf"
                              onChange={(e) => setPnuProofImage(e.target.files?.[0] || null)}
                              className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-primary/10 file:text-primary file:text-xs file:font-medium"
                              data-testid="input-pnu-proof"
                            />
                          </div>
                        </div>
                      )}

                      {activityStatus === "partial_payment" && (
                        <div
                          className="rounded-xl p-3 space-y-3 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[11px] font-semibold text-foreground/70 dark:text-foreground/60 uppercase tracking-wider">Payment Commitments</label>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold tabular-nums ${Math.abs((commitmentTotal + (parseFloat(inlineCollectedAmount) || 0)) - (remainingDue > 0 ? remainingDue : tenant.totalAmountDue)) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>
                                {formatCurrency(commitmentTotal)}{(parseFloat(inlineCollectedAmount) || 0) > 0 ? ` + ${formatCurrency(parseFloat(inlineCollectedAmount))}` : ""} / {formatCurrency(remainingDue > 0 ? remainingDue : tenant.totalAmountDue)}
                                {totalPartialPaymentsReported > 0 && <span className="text-muted-foreground font-normal ml-1">(after {formatCurrency(totalPartialPaymentsReported)} paid)</span>}
                              </span>
                            </div>
                          </div>

                          {commitments.map((c, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-muted-foreground w-5 flex-shrink-0">C{idx + 1}</span>
                              <Input
                                type="number"
                                placeholder="Amount"
                                value={c.amount}
                                onChange={(e) => updateCommitment(idx, "amount", e.target.value)}
                                className="text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border flex-1"
                                data-testid={`input-commitment-amount-${idx}`}
                              />
                              <Input
                                type="date"
                                value={c.date}
                                onChange={(e) => updateCommitment(idx, "date", e.target.value)}
                                className="text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border flex-1"
                                data-testid={`input-commitment-date-${idx}`}
                              />
                              {commitments.length > 1 && (
                                <Button type="button" size="icon" variant="ghost" className="flex-shrink-0 rounded-lg text-muted-foreground" onClick={() => removeCommitment(idx)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}

                          <Button type="button" variant="outline" size="sm" className="rounded-full w-full text-xs" onClick={addCommitment} data-testid="button-add-commitment">
                            <Plus className="w-3 h-3 mr-1" /> Add Commitment
                          </Button>

                          {commitmentTotal > 0 && commitmentTotal < (remainingDue > 0 ? remainingDue : tenant.totalAmountDue) - 0.01 && (
                            <div
                              className="rounded-xl p-3 space-y-2.5 border border-emerald-300/40 dark:border-emerald-700/30 bg-emerald-50/30 dark:bg-emerald-950/20"
                              style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                            >
                              <div className="flex items-center gap-2">
                                <Banknote className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Payment Already Collected</label>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Commitment total ({formatCurrency(commitmentTotal)}) is less than {formatCurrency(remainingDue > 0 ? remainingDue : tenant.totalAmountDue)}. Enter the amount already collected to submit a payment update request.
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground">Amount *</label>
                                  <Input
                                    type="number"
                                    placeholder="Collected amount"
                                    value={inlineCollectedAmount}
                                    onChange={(e) => { setInlineCollectedAmount(e.target.value); setInlineCollectedErrors({}); setFormErrors(prev => ({ ...prev, commitments: undefined } as any)); }}
                                    className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.inlineCollectedAmount ? "border-destructive" : ""}`}
                                    data-testid="input-inline-collected-amount"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground">Date *</label>
                                  <Input
                                    type="date"
                                    value={inlineCollectedDate}
                                    onChange={(e) => { setInlineCollectedDate(e.target.value); setInlineCollectedErrors(prev => ({ ...prev, inlineCollectedDate: undefined } as any)); }}
                                    className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.inlineCollectedDate ? "border-destructive" : ""}`}
                                    data-testid="input-inline-collected-date"
                                  />
                                  {formErrors.inlineCollectedDate && <p className="text-[9px] text-destructive">{formErrors.inlineCollectedDate}</p>}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium text-muted-foreground">Payment Mode *</label>
                                  <Select value={inlineCollectedMode} onValueChange={(val) => { setInlineCollectedMode(val); setInlineCollectedErrors(prev => ({ ...prev, inlineCollectedMode: undefined } as any)); }}>
                                    <SelectTrigger className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.inlineCollectedMode ? "border-destructive" : ""}`} data-testid="select-inline-collected-mode">
                                      <SelectValue placeholder="Select mode" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="UPI">UPI</SelectItem>
                                      <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                                      <SelectItem value="Cheque">Cheque</SelectItem>
                                      <SelectItem value="Cash">Cash</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {formErrors.inlineCollectedMode && <p className="text-[9px] text-destructive">{formErrors.inlineCollectedMode}</p>}
                                </div>
                                {inlineCollectedMode && inlineCollectedMode !== "Cash" && (
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-medium text-muted-foreground">{inlineCollectedMode === "Cheque" ? "Cheque No. *" : "UTR No. *"}</label>
                                    <Input
                                      placeholder={inlineCollectedMode === "Cheque" ? "Cheque number" : "UTR number"}
                                      value={inlineCollectedReference}
                                      onChange={(e) => { setInlineCollectedReference(e.target.value); setFormErrors(prev => ({ ...prev, inlineCollectedRef: undefined } as any)); }}
                                      className={`text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border ${formErrors.inlineCollectedRef ? "border-destructive" : ""}`}
                                      data-testid="input-inline-collected-reference"
                                    />
                                    {formErrors.inlineCollectedRef && <p className="text-[9px] text-destructive">{formErrors.inlineCollectedRef}</p>}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground">Screenshot (optional)</label>
                                <Input
                                  type="file"
                                  accept="image/*"
                                  ref={inlineCollectedFileRef}
                                  onChange={(e) => setInlineCollectedImage(e.target.files?.[0] || null)}
                                  className="text-xs bg-background/80 dark:bg-background/40 rounded-lg border-border"
                                  data-testid="input-inline-collected-image"
                                />
                              </div>
                              {(parseFloat(inlineCollectedAmount) || 0) > 0 && (
                                <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/20 border border-emerald-200/50 dark:border-emerald-800/30">
                                  <AlertTriangle className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                  <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">A payment update ticket will be auto-created for {formatCurrency(parseFloat(inlineCollectedAmount) || 0)}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {formErrors.commitments && <p className="text-[10px] text-destructive">{formErrors.commitments}</p>}
                        </div>
                      )}

                      {!(activityStatus === "paid" && paidSubReason && (TICKET_REQUIRING_SUB_REASONS as readonly string[]).includes(paidSubReason)) && activityStatus !== "payment_not_updated" && (
                        <div
                          className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Remark</label>
                          <Textarea
                            placeholder="Enter remark or update note..."
                            value={remarkText}
                            onChange={(e) => { setRemarkText(e.target.value); setFormErrors(prev => ({ ...prev, remark: undefined } as any)); }}
                            className={`resize-none text-sm min-h-[70px] bg-background/80 dark:bg-background/40 rounded-lg border-border focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-all ${formErrors.remark ? "border-destructive ring-1 ring-destructive/30" : ""}`}
                            data-testid="input-remark"
                          />
                          {formErrors.remark && <p className="text-[10px] text-destructive">{formErrors.remark}</p>}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-[10px] text-muted-foreground">Posting as {username || "Unknown"}</p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full text-xs border-destructive/40 text-destructive"
                            onClick={handleClose}
                            data-testid="button-cancel-activity"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!canSubmit || addFollowUp.isPending}
                            className="shadow-lg shadow-emerald-500/20 rounded-full"
                            data-testid="button-add-followup"
                          >
                            <Send className="w-3.5 h-3.5 mr-1.5" />
                            {addFollowUp.isPending ? "Saving..." : "Submit"}
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>

                {ticketOpen && (
                  <div
                    className="rounded-2xl p-[1px] mt-1"
                    style={{
                      background: "linear-gradient(135deg, hsl(160 84% 39% / 0.4), hsl(160 60% 45% / 0.3), hsl(var(--border)))",
                    }}
                  >
                    <div
                      className="rounded-2xl p-4"
                      style={{
                        background: "hsl(var(--card) / 0.92)",
                        boxShadow: "0 4px 24px -6px hsl(160 84% 39% / 0.08), 0 2px 8px -2px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div className="flex items-center gap-2.5 mb-4">
                        <div className="section-icon w-7 h-7">
                          <Ticket className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold">Raise Ticket</h3>
                        {!mandatoryTicketPending && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="ml-auto flex-shrink-0 rounded-full"
                            onClick={() => { setTicketOpen(false); resetTicketForm(); }}
                            data-testid="button-close-ticket-form"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                      {mandatoryTicketPending && (
                        <div className="flex items-center gap-1.5 p-2.5 rounded-lg bg-red-50/80 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/30 mb-3">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                          <p className="text-[11px] font-medium text-red-700 dark:text-red-300">This ticket is mandatory. You must create it before closing.</p>
                        </div>
                      )}
                      <form onSubmit={handleTicketSubmit} className="space-y-3" data-testid="form-raise-ticket">
                        <div
                          className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description *</label>
                          <Textarea
                            placeholder="Describe the issue..."
                            value={ticketDescription}
                            onChange={(e) => setTicketDescription(e.target.value)}
                            className="resize-none text-sm min-h-[70px] bg-background/80 dark:bg-background/40 rounded-lg border-border focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-all"
                            data-testid="input-ticket-description"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div
                            className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                            style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                          >
                            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Urgency *</label>
                            <Select value={ticketUrgency} onValueChange={setTicketUrgency}>
                              <SelectTrigger className="text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border" data-testid="select-ticket-urgency">
                                <SelectValue placeholder="Select urgency" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="critical">Critical</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div
                            className="rounded-xl p-3 space-y-1.5 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                            style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                          >
                            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Assign To *</label>
                            <Select value={ticketAssigneeId} onValueChange={setTicketAssigneeId}>
                              <SelectTrigger className="text-sm bg-background/80 dark:bg-background/40 rounded-lg border-border" data-testid="select-ticket-assignee">
                                <SelectValue placeholder={teamMembersLoading ? "Loading..." : "Select member"} />
                              </SelectTrigger>
                              <SelectContent>
                                {teamMembers.map((member) => (
                                  <SelectItem key={member.id} value={String(member.id)} data-testid={`option-assignee-${member.id}`}>
                                    {member.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div
                          className="rounded-xl p-3 space-y-2 border border-border dark:border-border bg-muted/25 dark:bg-muted/10"
                          style={{ boxShadow: "inset 0 2px 4px rgba(0,0,0,0.03)" }}
                        >
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <ImagePlus className="w-3 h-3" />
                            Images (optional, max 5)
                          </label>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleTicketImageChange}
                            className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-primary/10 file:text-primary file:text-xs file:font-medium"
                            data-testid="input-ticket-images"
                          />
                          {ticketImages.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {ticketImages.map((file, idx) => (
                                <div key={idx} className="flex items-center gap-1 text-xs bg-muted/40 rounded-lg px-2 py-1">
                                  <span className="truncate max-w-[100px]">{file.name}</span>
                                  <Button type="button" size="icon" variant="ghost" className="flex-shrink-0 rounded-full" onClick={() => removeTicketImage(idx)} data-testid={`button-remove-ticket-image-${idx}`}>
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <p className="text-[10px] text-muted-foreground">Raised by {username || "Unknown"}</p>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!ticketUrgency || !ticketAssigneeId || ticketSubmitting}
                            className="shadow-lg shadow-emerald-500/20 rounded-full"
                            data-testid="button-submit-ticket"
                          >
                            {ticketSubmitting ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Ticket className="w-3.5 h-3.5 mr-1.5" />
                                Create Ticket
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                <div
                  className="rounded-2xl p-[1px]"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--border)), hsl(var(--border) / 0.6))",
                  }}
                >
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      background: "hsl(var(--card) / 0.6)",
                      boxShadow: "0 2px 12px -4px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="section-icon w-7 h-7">
                        <CalendarClock className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-semibold">Activity History</h3>
                      <Badge variant="secondary" className="text-[10px] rounded-lg">{activityLog.length}</Badge>
                    </div>

                    {activityLoading ? (
                      <p className="text-sm text-muted-foreground">Loading...</p>
                    ) : activityLog.length === 0 ? (
                      <div className="py-8 text-center rounded-xl border border-dashed border-border dark:border-border bg-muted/10">
                        <p className="text-sm text-muted-foreground">No activity updates yet. Add one above to get started.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activityLog.map((activity, idx) => {
                          const followUpStatus = getFollowUpStatus(activity.followUpDate);
                          const isLatest = idx === 0;
                          const meta = activity.metadata as any;
                          return (
                            <Card
                              key={activity.id}
                              className={`rounded-xl ${isLatest ? "border-primary/25 dark:border-primary/20 bg-primary/[0.03] dark:bg-primary/[0.06]" : "border-border dark:border-border bg-muted/25 dark:bg-muted/10"}`}
                              style={{
                                boxShadow: isLatest
                                  ? "0 2px 8px -2px hsl(160 84% 39% / 0.08)"
                                  : "0 1px 3px -1px rgba(0,0,0,0.03)",
                              }}
                              data-testid={`activity-${activity.id}`}
                            >
                              <CardContent className="p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {activity.followUpDate && (
                                      <span className="text-xs font-bold text-primary" data-testid={`text-followup-date-${activity.id}`}>
                                        {new Date(activity.followUpDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                      </span>
                                    )}
                                    <FollowUpStatusBadge status={followUpStatus} />
                                    {meta?.ticketId && (
                                      <Badge
                                        variant="secondary"
                                        className="rounded-full text-[10px] py-0.5 cursor-pointer bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0"
                                        onClick={() => {
                                          onClose();
                                          navigate("/tickets");
                                        }}
                                        data-testid={`badge-ticket-raised-${activity.id}`}
                                      >
                                        <Ticket className="w-2.5 h-2.5 mr-0.5" />
                                        Ticket Raised
                                      </Badge>
                                    )}
                                  </div>
                                  {meta?.status && getPaymentStatusBadge(meta.status)}
                                </div>

                                {activity.remarkText && (
                                  <div className="rounded-lg bg-muted/20 dark:bg-muted/10 p-2.5" data-testid={`text-remark-${activity.id}`}>
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Remark</p>
                                    <p className="text-sm leading-relaxed">{activity.remarkText}</p>
                                  </div>
                                )}

                                {meta?.subReason && (
                                  <div className="rounded-lg bg-violet-50/50 dark:bg-violet-900/10 p-2.5">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reason</p>
                                    <p className="text-xs font-medium text-violet-700 dark:text-violet-300">{meta.subReason}</p>
                                  </div>
                                )}

                                {meta?.commitments && Array.isArray(meta.commitments) && (
                                  <div className="rounded-lg bg-muted/20 dark:bg-muted/10 p-2.5 space-y-1.5">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Payment Commitments</p>
                                    {meta.commitments.map((c: any, ci: number) => (
                                      <div key={ci} className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">{c.label}</span>
                                        <span className="font-semibold tabular-nums">{formatCurrency(c.amount)} by {new Date(c.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {new Date(activity.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} {new Date(activity.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                                  </span>
                                  <span className="font-semibold">{activity.createdBy}</span>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
