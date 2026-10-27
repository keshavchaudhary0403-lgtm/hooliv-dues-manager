import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUsername } from "@/components/username-provider";
import type { Ticket, TicketComment } from "@shared/schema";
import { TICKET_STATUS_LABELS, TICKET_URGENCY_LABELS } from "@shared/schema";
import {
  TicketIcon,
  ChevronDown,
  ChevronUp,
  Send,
  Phone,
  MapPin,
  User,
  Clock,
  Filter,
  AlertTriangle,
  MessageSquare,
  ArrowRightLeft,
  Image as ImageIcon,
  Download,
  Eye,
  FileText,
  Paperclip,
  X,
  Search,
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

type TicketWithComments = Ticket & { comments: TicketComment[] };

function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 5) return `${diffWeek}w ago`;
  return `${diffMonth}mo ago`;
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "open":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "resolved":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "closed":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
    case "hold":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "rejected":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    case "waiting_for_reply":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
  }
}

function getStatusCardStyle(status: string): string {
  switch (status) {
    case "open":
      return "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/40";
    case "resolved":
      return "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40";
    case "closed":
      return "bg-gray-50/50 dark:bg-gray-900/20 border-gray-200/60 dark:border-gray-700/40";
    case "hold":
      return "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/40";
    case "rejected":
      return "bg-red-50/50 dark:bg-red-950/20 border-red-200/60 dark:border-red-800/40";
    case "waiting_for_reply":
      return "bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-800/40";
    default:
      return "bg-gray-50/50 dark:bg-gray-900/20 border-gray-200/60 dark:border-gray-700/40";
  }
}

function getUrgencyBadgeClasses(urgency: string): string {
  switch (urgency) {
    case "low":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
    case "medium":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "high":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "critical":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
  }
}

export default function TicketsPage() {
  const { username } = useUsername();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [newStatus, setNewStatus] = useState("none");
  const [newAssigneeId, setNewAssigneeId] = useState("none");
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (urgencyFilter !== "all") queryParams.set("urgency", urgencyFilter);
  if (assigneeFilter !== "all") queryParams.set("assigneeId", assigneeFilter);
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  const queryString = queryParams.toString();

  const { data: tickets, isLoading: ticketsLoading } = useQuery<Ticket[]>({
    queryKey: ["/api/tickets", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/tickets${queryString ? `?${queryString}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
  });

  const { data: teamMembers } = useQuery<Array<{ id: number; displayName: string; phone: string; role: string }>>({
    queryKey: ["/api/team-members", "active"],
    queryFn: async () => {
      const res = await fetch("/api/team-members?active=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team members");
      return res.json();
    },
  });

  const { data: expandedTicket, isLoading: expandedLoading } = useQuery<TicketWithComments>({
    queryKey: ["/api/tickets", expandedTicketId],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${expandedTicketId}`);
      if (!res.ok) throw new Error("Failed to fetch ticket");
      return res.json();
    },
    enabled: expandedTicketId !== null,
  });

  const { data: ticketAttachments } = useQuery<{ id: number; ticketId: number; filename: string; mimeType: string; createdAt: string; storagePath?: string; url?: string | null }[]>({
    queryKey: ["/api/tickets", expandedTicketId, "attachments"],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${expandedTicketId}/attachments`);
      if (!res.ok) throw new Error("Failed to fetch attachments");
      return res.json();
    },
    enabled: expandedTicketId !== null,
  });

  const addCommentMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      await apiRequest("POST", `/api/tickets/${ticketId}/comments`, {
        commentText: commentText.trim(),
        newStatus: newStatus !== "none" ? newStatus : undefined,
        newAssigneeId: newAssigneeId !== "none" ? parseInt(newAssigneeId) : undefined,
        createdBy: username,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCommentText("");
      setNewStatus("none");
      setNewAssigneeId("none");
      setExpandedTicketId(null);
      toast({ title: "Comment added", description: "Your comment has been posted." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleExpanded = (id: number) => {
    if (expandedTicketId === id) {
      setExpandedTicketId(null);
    } else {
      setExpandedTicketId(id);
      setCommentText("");
      setNewStatus("none");
      setNewAssigneeId("none");
    }
  };

  if (ticketsLoading) {
    return (
      <div className="px-4 md:px-8 py-6 space-y-5">
        <Skeleton className="h-10 w-64 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 space-y-5 mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tickets-title">
          Tickets
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-tickets-subtitle">
          Manage support tickets
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <div className="glass-filter rounded-2xl px-4 py-3 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by tenant name, room no, phone…"
              className="pl-9 pr-8 rounded-full border-border/50 bg-transparent h-9 text-sm"
              data-testid="input-ticket-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                data-testid="button-clear-search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="w-[180px] rounded-full border-border/50 bg-transparent"
                data-testid="select-status-filter"
              >
                <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(TICKET_STATUS_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger
                className="w-[150px] rounded-full border-border/50 bg-transparent"
                data-testid="select-urgency-filter"
              >
                <AlertTriangle className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Urgency</SelectItem>
                {Object.entries(TICKET_URGENCY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger
                className="w-[170px] rounded-full border-border/50 bg-transparent"
                data-testid="select-assignee-filter"
              >
                <User className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {teamMembers?.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(statusFilter !== "all" || urgencyFilter !== "all" || assigneeFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-xs text-muted-foreground"
                onClick={() => {
                  setStatusFilter("all");
                  setUrgencyFilter("all");
                  setAssigneeFilter("all");
                  setSearchQuery("");
                }}
                data-testid="button-clear-filters"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {!tickets || tickets.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex flex-col items-center justify-center py-24 gap-6">
            <div className="w-20 h-20 rounded-3xl glass-card flex items-center justify-center">
              <TicketIcon className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold" data-testid="text-no-tickets">
                No tickets yet
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Tickets will appear here when raised from tenant details.
              </p>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {[...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((ticket, index) => (
            <motion.div
              key={ticket.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.03 }}
            >
              <Card
                className={`rounded-2xl overflow-visible ${getStatusCardStyle(ticket.status)}`}
                data-testid={`card-ticket-${ticket.id}`}
              >
                <CardContent className="p-0">
                  <div
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 cursor-pointer"
                    onClick={() => toggleExpanded(ticket.id)}
                    data-testid={`button-expand-ticket-${ticket.id}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-bold text-sm text-primary"
                          data-testid={`text-ticket-id-${ticket.id}`}
                        >
                          #{ticket.id}
                        </span>
                        <span
                          className="font-semibold text-sm truncate"
                          data-testid={`text-ticket-tenant-${ticket.id}`}
                        >
                          {ticket.tenantName || "Unknown"}
                        </span>
                        {ticket.roomNo && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-ticket-room-${ticket.id}`}>
                            Room {ticket.roomNo}
                          </span>
                        )}
                        {ticket.tenantPhone && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <Phone className="w-3 h-3" />
                            {ticket.tenantPhone}
                          </span>
                        )}
                        {ticket.subReason && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] border-0 rounded-lg no-default-hover-elevate no-default-active-elevate bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                            data-testid={`badge-ticket-payment-update-${ticket.id}`}
                          >
                            Payment Update
                          </Badge>
                        )}
                      </div>

                      {(ticket.city || ticket.propertyName) && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          <span data-testid={`text-ticket-location-${ticket.id}`}>
                            {[ticket.city, ticket.propertyName].filter(Boolean).join(" / ")}
                          </span>
                        </div>
                      )}

                      {ticket.subReason && (
                        <span
                          className="text-xs text-muted-foreground italic"
                          data-testid={`text-ticket-subreason-${ticket.id}`}
                        >
                          {ticket.subReason}
                        </span>
                      )}

                      {ticket.description && (
                        <p
                          className="text-sm text-muted-foreground line-clamp-1"
                          data-testid={`text-ticket-desc-${ticket.id}`}
                        >
                          {ticket.description.length > 100
                            ? ticket.description.slice(0, 100) + "..."
                            : ticket.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col sm:items-end gap-2 shrink-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] border-0 rounded-lg no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClasses(ticket.status)}`}
                          data-testid={`badge-ticket-status-${ticket.id}`}
                        >
                          {TICKET_STATUS_LABELS[ticket.status] || ticket.status}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] border-0 rounded-lg no-default-hover-elevate no-default-active-elevate ${getUrgencyBadgeClasses(ticket.urgency)}`}
                          data-testid={`badge-ticket-urgency-${ticket.id}`}
                        >
                          {TICKET_URGENCY_LABELS[ticket.urgency] || ticket.urgency}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {ticket.assigneeName && (
                          <span className="flex items-center gap-0.5" data-testid={`text-ticket-assignee-${ticket.id}`}>
                            <User className="w-3 h-3" />
                            {ticket.assigneeName}
                          </span>
                        )}
                        <span className="flex items-center gap-0.5" data-testid={`text-ticket-date-${ticket.id}`}>
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(ticket.createdAt)}
                        </span>
                      </div>
                      {ticket.raisedBy && (
                        <span
                          className="text-[10px] text-muted-foreground"
                          data-testid={`text-ticket-raised-${ticket.id}`}
                        >
                          Raised by {ticket.raisedBy}
                        </span>
                      )}
                      {expandedTicketId === ticket.id ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedTicketId === ticket.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-border/30 p-4 space-y-4">
                          {expandedLoading ? (
                            <div className="space-y-2">
                              <Skeleton className="h-4 w-full rounded" />
                              <Skeleton className="h-4 w-3/4 rounded" />
                              <Skeleton className="h-20 rounded" />
                            </div>
                          ) : expandedTicket ? (
                            <>
                              <div className="space-y-1">
                                {expandedTicket.roomNo && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span className="font-medium">Room:</span>
                                    <span data-testid={`text-ticket-detail-room-${ticket.id}`}>{expandedTicket.roomNo}</span>
                                  </div>
                                )}
                                <p
                                  className="text-sm leading-relaxed"
                                  data-testid={`text-ticket-full-desc-${ticket.id}`}
                                >
                                  {expandedTicket.description}
                                </p>
                              </div>

                              {(!ticketAttachments || ticketAttachments.length === 0) && expandedTicket.images && expandedTicket.images.length > 0 && expandedTicket.images.some((img: string) => img && img.length > 0) && (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                    <Paperclip className="w-3.5 h-3.5" />
                                    Attachments ({expandedTicket.images.filter((img: string) => img && img.length > 0).length})
                                  </div>
                                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-800/30 text-sm text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
                                    These attachments were stored in an older format and are no longer available for viewing. New attachments will be stored permanently.
                                  </div>
                                </div>
                              )}

                              {ticketAttachments && ticketAttachments.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                    <Paperclip className="w-3.5 h-3.5" />
                                    Attachments ({ticketAttachments.length})
                                  </div>
                                  <div className="grid gap-2">
                                    {ticketAttachments.map((att) => {
                                      const isImage = att.mimeType.startsWith("image/");
                                      return (
                                        <div
                                          key={att.id}
                                          className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 dark:bg-muted/20 border border-border/20"
                                          data-testid={`attachment-${att.id}`}
                                        >
                                          {isImage ? (
                                            <button
                                              onClick={() => setLightboxImage(att.url ?? null)}
                                              className="w-14 h-14 rounded-md overflow-hidden border border-border/30 shrink-0 cursor-pointer"
                                              data-testid={`button-attachment-preview-${att.id}`}
                                            >
                                              <img
                                                src={att.url ?? undefined}
                                                alt={att.filename}
                                                className="w-full h-full object-cover"
                                              />
                                            </button>
                                          ) : (
                                            <div className="w-14 h-14 rounded-md border border-border/30 shrink-0 flex items-center justify-center bg-muted/50">
                                              <FileText className="w-6 h-6 text-muted-foreground" />
                                            </div>
                                          )}
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate" data-testid={`text-attachment-name-${att.id}`}>{att.filename}</p>
                                            <p className="text-[11px] text-muted-foreground">{att.mimeType}</p>
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            {isImage ? (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => setLightboxImage(att.url ?? null)}
                                                data-testid={`button-attachment-view-${att.id}`}
                                              >
                                                <Eye className="w-4 h-4" />
                                              </Button>
                                            ) : (
                                              <a href={att.url ?? undefined} target="_blank" rel="noopener noreferrer">
                                                <Button size="icon" variant="ghost" data-testid={`button-attachment-view-${att.id}`}>
                                                  <Eye className="w-4 h-4" />
                                                </Button>
                                              </a>
                                            )}
                                            <a href={att.url ?? undefined} download={att.filename}>
                                              <Button size="icon" variant="ghost" data-testid={`button-attachment-download-${att.id}`}>
                                                <Download className="w-4 h-4" />
                                              </Button>
                                            </a>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {expandedTicket.comments && expandedTicket.comments.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                                    <MessageSquare className="w-3 h-3" />
                                    Comments ({expandedTicket.comments.length})
                                  </div>
                                  <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {expandedTicket.comments.map((comment) => (
                                      <div
                                        key={comment.id}
                                        className="bg-muted/30 dark:bg-muted/20 rounded-xl p-3 space-y-1"
                                        data-testid={`comment-${comment.id}`}
                                      >
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span
                                            className="text-xs font-semibold"
                                            data-testid={`text-comment-by-${comment.id}`}
                                          >
                                            {comment.createdBy}
                                          </span>
                                          <span
                                            className="text-[10px] text-muted-foreground"
                                            data-testid={`text-comment-date-${comment.id}`}
                                          >
                                            {formatRelativeTime(comment.createdAt)}
                                          </span>
                                        </div>
                                        <p
                                          className="text-sm"
                                          data-testid={`text-comment-text-${comment.id}`}
                                        >
                                          {comment.commentText}
                                        </p>
                                        {(comment.newStatus || comment.newAssigneeName) && (
                                          <div className="flex items-center gap-2 flex-wrap mt-1">
                                            {comment.newStatus && (
                                              <Badge
                                                variant="secondary"
                                                className={`text-[10px] border-0 rounded-lg no-default-hover-elevate no-default-active-elevate ${getStatusBadgeClasses(comment.newStatus)}`}
                                                data-testid={`badge-comment-status-${comment.id}`}
                                              >
                                                <ArrowRightLeft className="w-2.5 h-2.5 mr-0.5" />
                                                {TICKET_STATUS_LABELS[comment.newStatus] || comment.newStatus}
                                              </Badge>
                                            )}
                                            {comment.newAssigneeName && (
                                              <span
                                                className="text-[10px] text-muted-foreground flex items-center gap-0.5"
                                                data-testid={`text-comment-reassign-${comment.id}`}
                                              >
                                                <ArrowRightLeft className="w-2.5 h-2.5" />
                                                Reassigned to {comment.newAssigneeName}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2 border-t border-border/30 pt-3">
                                <Textarea
                                  placeholder="Add a comment..."
                                  value={commentText}
                                  onChange={(e) => setCommentText(e.target.value)}
                                  className="resize-none rounded-xl border-border/50 text-sm"
                                  rows={2}
                                  data-testid={`input-comment-text-${ticket.id}`}
                                />
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
                                  <Select value={newStatus} onValueChange={setNewStatus}>
                                    <SelectTrigger
                                      className="w-[170px] rounded-full border-border/50 bg-transparent text-xs"
                                      data-testid={`select-comment-status-${ticket.id}`}
                                    >
                                      <SelectValue placeholder="Change status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No status change</SelectItem>
                                      {Object.entries(TICKET_STATUS_LABELS).map(([key, label]) => (
                                        <SelectItem key={key} value={key}>{label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>

                                  <Select value={newAssigneeId} onValueChange={setNewAssigneeId}>
                                    <SelectTrigger
                                      className="w-[170px] rounded-full border-border/50 bg-transparent text-xs"
                                      data-testid={`select-comment-assignee-${ticket.id}`}
                                    >
                                      <SelectValue placeholder="Reassign" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No reassignment</SelectItem>
                                      {teamMembers?.map((m) => (
                                        <SelectItem key={m.id} value={String(m.id)}>
                                          {m.displayName}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>

                                  <Button
                                    onClick={() => addCommentMutation.mutate(ticket.id)}
                                    disabled={!commentText.trim() || addCommentMutation.isPending}
                                    className="shadow-lg shadow-emerald-500/20 rounded-full"
                                    data-testid={`button-submit-comment-${ticket.id}`}
                                  >
                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                    {addCommentMutation.isPending ? "Posting..." : "Post Comment"}
                                  </Button>
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={!!lightboxImage} onOpenChange={() => setLightboxImage(null)}>
        <DialogContent className="max-w-3xl p-2">
          {lightboxImage && (
            <div className="space-y-2">
              <img
                src={lightboxImage}
                alt="Ticket attachment"
                className="w-full h-auto rounded-lg"
                data-testid="img-lightbox"
              />
              <div className="flex justify-end gap-2 px-2 pb-1">
                <a href={lightboxImage.replace("/view", "/download")} download>
                  <Button variant="outline" data-testid="button-lightbox-download">
                    <Download className="w-4 h-4 mr-1.5" />
                    Download
                  </Button>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
