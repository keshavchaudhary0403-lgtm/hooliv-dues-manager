import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, serial, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  tenantName: text("tenant_name").notNull(),
  primaryPhone: text("primary_phone").notNull(),
  secondaryPhone: text("secondary_phone"),
  parentName: text("parent_name"),
  parentPhone: text("parent_phone"),
  city: text("city").notNull(),
  propertyName: text("property_name").notNull(),
  roomNo: text("room_no"),
  totalAmountDue: integer("total_amount_due").notNull().default(0),
  checkInDate: text("check_in_date"),
  dueDate: text("due_date"),
  rentalBillingCycle: text("rental_billing_cycle"),
  checkoutNoticeDate: text("checkout_notice_date"),
  expectedCheckoutDate: text("expected_checkout_date"),
  paymentStatus: text("payment_status").notNull().default("no_update"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tenants_primary_phone_idx").on(table.primaryPhone),
  index("tenants_city_idx").on(table.city),
  index("tenants_property_idx").on(table.propertyName),
  index("tenants_payment_status_idx").on(table.paymentStatus),
  index("tenants_tenant_name_idx").on(table.tenantName),
  index("tenants_city_property_idx").on(table.city, table.propertyName),
  index("tenants_room_no_idx").on(table.roomNo),
]);

export const tenantActivityLog = pgTable("tenant_activity_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  tenantPhone: text("tenant_phone").notNull().default(""),
  activityType: text("activity_type").notNull(),
  followUpDate: text("follow_up_date"),
  remarkText: text("remark_text"),
  metadata: jsonb("metadata"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("activity_log_tenant_id_idx").on(table.tenantId),
  index("activity_log_tenant_phone_idx").on(table.tenantPhone),
  index("activity_log_created_at_idx").on(table.createdAt),
  index("activity_log_phone_type_date_idx").on(table.tenantPhone, table.activityType, table.createdAt),
  index("activity_log_phone_created_idx").on(table.tenantPhone, table.createdAt),
]);

export const columnMappings = pgTable("column_mappings", {
  id: serial("id").primaryKey(),
  mappingName: text("mapping_name").notNull().default("default"),
  mapping: jsonb("mapping").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const uploadHistory = pgTable("upload_history", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const activityResetLog = pgTable("activity_reset_log", {
  id: serial("id").primaryKey(),
  resetBy: text("reset_by").notNull(),
  recordsDeleted: integer("records_deleted").notNull().default(0),
  resetType: text("reset_type").notNull().default("clear_activity"),
  resetScope: text("reset_scope"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull(),
  settingValue: text("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("app_settings_key_idx").on(table.settingKey),
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("property_manager"),
  assignedCities: text("assigned_cities").array().default([]),
  assignedProperties: text("assigned_properties").array().default([]),
  active: integer("active").notNull().default(1),
  canManageUploads: integer("can_manage_uploads").notNull().default(0),
  canManageTeam: integer("can_manage_team").notNull().default(0),
  canManageSettings: integer("can_manage_settings").notNull().default(0),
  canExportData: integer("can_export_data").notNull().default(0),
  canManageTickets: integer("can_manage_tickets").notNull().default(0),
  canHandlePartialPayments: integer("can_handle_partial_payments").notNull().default(0),
  mustChangePassword: integer("must_change_password").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_phone_idx").on(table.phone),
]);

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  tenantPhone: text("tenant_phone").notNull(),
  tenantId: integer("tenant_id"),
  tenantName: text("tenant_name"),
  roomNo: text("room_no"),
  city: text("city"),
  propertyName: text("property_name"),
  raisedBy: text("raised_by").notNull(),
  assigneeId: integer("assignee_id"),
  assigneeName: text("assignee_name"),
  urgency: text("urgency").notNull().default("medium"),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  subReason: text("sub_reason"),
  activityId: integer("activity_id"),
  images: text("images").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("tickets_tenant_phone_idx").on(table.tenantPhone),
  index("tickets_assignee_id_idx").on(table.assigneeId),
  index("tickets_status_idx").on(table.status),
  index("tickets_urgency_idx").on(table.urgency),
]);

export const ticketComments = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  commentText: text("comment_text").notNull(),
  newStatus: text("new_status"),
  newAssigneeId: integer("new_assignee_id"),
  newAssigneeName: text("new_assignee_name"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ticket_comments_ticket_id_idx").on(table.ticketId),
]);

export const ticketAttachments = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ticket_attachments_ticket_id_idx").on(table.ticketId),
]);

export const partialPaymentHandlers = pgTable("partial_payment_handlers", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  propertyName: text("property_name"),
  teamMemberId: integer("team_member_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true, updatedAt: true });
export const insertActivityLogSchema = createInsertSchema(tenantActivityLog).omit({ id: true, createdAt: true }).extend({
  activityType: z.enum(["REMARK", "FOLLOW_UP"]),
});
export const insertColumnMappingSchema = createInsertSchema(columnMappings).omit({ id: true, createdAt: true });
export const insertUploadHistorySchema = createInsertSchema(uploadHistory).omit({ id: true, createdAt: true });
export const insertActivityResetLogSchema = createInsertSchema(activityResetLog).omit({ id: true, createdAt: true });
export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true, updatedAt: true });
export const insertTicketSchema = createInsertSchema(tickets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({ id: true, createdAt: true });

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type ActivityLog = typeof tenantActivityLog.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ColumnMapping = typeof columnMappings.$inferSelect;
export type InsertColumnMapping = z.infer<typeof insertColumnMappingSchema>;
export type UploadHistory = typeof uploadHistory.$inferSelect;
export type InsertUploadHistory = z.infer<typeof insertUploadHistorySchema>;
export type ActivityResetLog = typeof activityResetLog.$inferSelect;
export type InsertActivityResetLog = z.infer<typeof insertActivityResetLogSchema>;
export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export const insertTicketAttachmentSchema = createInsertSchema(ticketAttachments).omit({ id: true, createdAt: true });
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type InsertTicketAttachment = z.infer<typeof insertTicketAttachmentSchema>;

export const insertPartialPaymentHandlerSchema = createInsertSchema(partialPaymentHandlers).omit({ id: true, createdAt: true, updatedAt: true });
export type PartialPaymentHandler = typeof partialPaymentHandlers.$inferSelect;
export type InsertPartialPaymentHandler = z.infer<typeof insertPartialPaymentHandlerSchema>;
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const PAYMENT_STATUSES = {
  NO_UPDATE: "no_update",
  PENDING: "pending",
  PARTIAL_PAYMENT: "partial_payment",
  PAID: "paid",
  ALREADY_PAID: "already_paid",
  NOT_RESPONDING: "not_responding",
  REFUND_ADJUSTMENT: "refund_adjustment",
  PAYMENT_NOT_UPDATED: "payment_not_updated",
} as const;

export const STATUS_LABELS: Record<string, string> = {
  no_update: "No Update",
  pending: "Pending",
  partial_payment: "Partial Payment",
  paid: "Paid",
  already_paid: "Already Paid",
  not_responding: "Not Responding",
  refund_adjustment: "Refund Adjustment",
  payment_not_updated: "Payment Not Updated",
};

export const SUSPENSE_STATUSES = ["paid", "refund_adjustment", "payment_not_updated"] as const;

export const PAID_SUB_REASONS = [
  "Ledger Correction",
  "Subject to Bank Verification",
  "Tech Issue",
] as const;

export const TICKET_REQUIRING_SUB_REASONS = [
  "Ledger Correction",
  "Tech Issue",
] as const;

export const TICKET_STATUSES = {
  OPEN: "open",
  RESOLVED: "resolved",
  CLOSED: "closed",
  HOLD: "hold",
  REJECTED: "rejected",
  WAITING_FOR_REPLY: "waiting_for_reply",
} as const;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
  hold: "Hold",
  rejected: "Rejected",
  waiting_for_reply: "Waiting for Team Reply",
};

export const TICKET_URGENCY_LEVELS = ["low", "medium", "high", "critical"] as const;

export const TICKET_URGENCY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const USER_ROLES = {
  REGIONAL_HEAD: "regional_head",
  CITY_HEAD: "city_head",
  CLUSTER_MANAGER: "cluster_manager",
  SR_PM: "sr_pm",
  PROPERTY_MANAGER: "property_manager",
  MGMT_TRAINEE: "mgmt_trainee",
} as const;

export const USER_ROLE_LABELS: Record<string, string> = {
  regional_head: "Regional Head",
  city_head: "City Head",
  cluster_manager: "Cluster Manager",
  sr_pm: "Sr. PM",
  property_manager: "Property Manager",
  mgmt_trainee: "Mgmt. Trainee",
};

export const PERMISSION_KEYS = [
  "canManageUploads",
  "canManageTeam",
  "canManageSettings",
  "canExportData",
  "canManageTickets",
  "canHandlePartialPayments",
] as const;

export const PERMISSION_LABELS: Record<string, string> = {
  canManageUploads: "Can Manage Uploads",
  canManageTeam: "Can Manage Team",
  canManageSettings: "Can Manage Settings",
  canExportData: "Can Export Data",
  canManageTickets: "Can Manage Tickets",
  canHandlePartialPayments: "Can Handle Partial Payments",
};

export const MASTER_FLAG_CONDITION_TYPES = {
  OVERDUE_DAYS: "overdue_days",
  AMOUNT_DUE: "amount_due",
  FOLLOWUP_MISSED: "followup_missed",
  CHECKOUT_NOTICE_DUES: "checkout_notice_dues",
  EXPECTED_CHECKOUT_DAYS: "expected_checkout_days",
  PARTIAL_PAYMENT_REMAINING: "partial_payment_remaining",
  REPEATED_OVERDUE: "repeated_overdue",
  MANUAL_ESCALATION: "manual_escalation",
} as const;

export const MASTER_FLAG_CONDITION_LABELS: Record<string, string> = {
  overdue_days: "Overdue Days > X",
  amount_due: "Amount Due > X",
  followup_missed: "Follow-Up Missed",
  checkout_notice_dues: "On Checkout Notice + Dues Pending",
  expected_checkout_days: "Expected Checkout within X days + Dues",
  partial_payment_remaining: "Partial Payment with Remaining > X",
  repeated_overdue: "Repeated Follow-Ups >= X (Still Unpaid)",
  manual_escalation: "Missed Commitment + Dues Pending",
};

export const masterFlagConditionSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  threshold: z.number().nullable().optional(),
  weight: z.number().min(0),
});

export const masterFlagConfigSchema = z.object({
  enabled: z.boolean(),
  warningThreshold: z.number().min(0),
  criticalThreshold: z.number().min(0),
  conditions: z.array(masterFlagConditionSchema),
});

export type MasterFlagCondition = z.infer<typeof masterFlagConditionSchema>;
export type MasterFlagConfig = z.infer<typeof masterFlagConfigSchema>;
