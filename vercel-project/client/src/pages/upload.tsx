import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Upload, FileSpreadsheet, Check, X, AlertCircle, Clock, ArrowRight, Trash2, Loader2 } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ColumnMapping, UploadHistory } from "@shared/schema";

const SYSTEM_FIELDS = [
  { key: "tenantName", label: "Tenant Name", required: true },
  { key: "primaryPhone", label: "Tenant Phone (Unique ID)", required: true },
  { key: "parentName", label: "Parent Name", required: false },
  { key: "parentPhone", label: "Parent Phone", required: false },
  { key: "city", label: "City", required: true },
  { key: "propertyName", label: "Property Name", required: true },
  { key: "roomNo", label: "Room No", required: false },
  { key: "totalAmountDue", label: "Total Amount Due", required: true },
  { key: "checkInDate", label: "Check-in Date", required: false },
  { key: "dueDate", label: "Due Date", required: false },
  { key: "rentalBillingCycle", label: "Rental Billing Cycle", required: false },
  { key: "checkoutNoticeDate", label: "Checkout Notice Date", required: false },
  { key: "expectedCheckoutDate", label: "Expected Checkout Date", required: false },
];

export default function UploadPage() {
  const { username } = useUsername();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [autoUploading, setAutoUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; updated: number; failed: number; totalRows: number } | null>(null);

  const { data: savedMapping } = useQuery<ColumnMapping>({
    queryKey: ["/api/column-mapping"],
  });

  const { data: uploadHistory = [], isLoading: historyLoading } = useQuery<UploadHistory[]>({
    queryKey: ["/api/upload-history"],
  });

  const doUpload = useCallback(async (file: File, mappingToUse: Record<string, string>) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mapping", JSON.stringify(mappingToUse));
    formData.append("username", username);
    const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, [username]);

  const parseHeadersMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/preview", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: async (data: { headers: string[] }) => {
      setFileHeaders(data.headers);

      if (savedMapping?.mapping) {
        const saved = savedMapping.mapping as Record<string, string>;
        const validMapping: Record<string, string> = {};
        for (const [sysField, csvCol] of Object.entries(saved)) {
          if (data.headers.includes(csvCol)) {
            validMapping[sysField] = csvCol;
          }
        }

        const allRequiredMapped = SYSTEM_FIELDS.filter(f => f.required).every(f => validMapping[f.key]);

        if (allRequiredMapped && selectedFile) {
          setAutoUploading(true);
          try {
            const result = await doUpload(selectedFile, validMapping);
            setUploadResult(result);
            setSelectedFile(null);
            setFileHeaders([]);
            queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tenants/filter-options"] });
            queryClient.invalidateQueries({ queryKey: ["/api/upload-history"] });
            queryClient.invalidateQueries({ queryKey: ["/api/column-mapping"] });
            toast({ title: "Upload complete", description: `${result.created} created, ${result.updated} updated` });
          } catch (err: any) {
            toast({ title: "Upload failed", description: err.message, variant: "destructive" });
            setSelectedFile(null);
            setFileHeaders([]);
          } finally {
            setAutoUploading(false);
          }
          return;
        }

        setMapping(validMapping);
      }

      setShowMapping(true);
    },
    onError: (err: Error) => {
      toast({ title: "Error reading file", description: err.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) return;
      return doUpload(selectedFile, mapping);
    },
    onSuccess: (data) => {
      setUploadResult(data);
      setShowMapping(false);
      setSelectedFile(null);
      setFileHeaders([]);
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/filter-options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/upload-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/column-mapping"] });
      toast({ title: "Upload complete", description: `${data.created} created, ${data.updated} updated` });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteUploadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/upload-history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/upload-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants/filter-options"] });
      toast({ title: "Upload deleted", description: "Upload record has been removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadResult(null);
    parseHeadersMutation.mutate(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadResult(null);
    parseHeadersMutation.mutate(file);
  }, []);

  const requiredFieldsMapped = SYSTEM_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);
  const isProcessing = parseHeadersMutation.isPending || autoUploading;

  return (
    <div className="px-4 md:px-8 py-6 space-y-7 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-upload-title">Upload Data</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Import tenant financial data
          {savedMapping && <span> &middot; Column mapping is saved</span>}
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <AnimatePresence mode="wait">
            {!showMapping && !uploadResult && !isProcessing && (
              <motion.div key="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <Card
                  className="glass-card rounded-2xl border-2 border-dashed border-border/50 cursor-pointer hover-elevate"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <CardHeader className="flex flex-row items-center gap-3 pb-3">
                    <div className="section-icon">
                      <Upload className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">Import File</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Drop or click to browse</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2" data-testid="dropzone-upload">
                    <p className="text-xs text-muted-foreground">CSV and Excel files (.csv, .xlsx, .xls) &middot; Primary Phone is used as unique identifier</p>
                    {savedMapping && (
                      <p className="text-xs text-primary font-medium">
                        Saved mapping will be applied automatically
                      </p>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={handleFileSelect}
                      data-testid="input-file-upload"
                    />
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {isProcessing && (
              <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <Card className="glass-card rounded-2xl border-0">
                  <CardHeader className="flex flex-row items-center gap-3 pb-3">
                    <div className="section-icon">
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{autoUploading ? "Uploading & Processing..." : "Reading file..."}</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{selectedFile?.name}</p>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {autoUploading ? "Using saved column mapping" : "Parsing file headers..."}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {uploadResult && (
              <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                <Card className="glass-card rounded-2xl border-0">
                  <CardHeader className="flex flex-row items-center gap-3 pb-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/15 dark:from-emerald-500/25 dark:to-emerald-600/25">
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">Upload Successful</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{uploadResult.totalRows} rows processed</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3 text-sm flex-wrap">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="w-3.5 h-3.5" /> {uploadResult.created} created
                      </span>
                      <span className="flex items-center gap-1 text-primary font-medium">
                        <ArrowRight className="w-3.5 h-3.5" /> {uploadResult.updated} updated
                      </span>
                      {uploadResult.failed > 0 && (
                        <span className="flex items-center gap-1 text-destructive font-medium">
                          <X className="w-3.5 h-3.5" /> {uploadResult.failed} failed
                        </span>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setUploadResult(null)} className="rounded-full" data-testid="button-upload-another">
                      Upload Another File
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <Card className="glass-card rounded-2xl border-0 overflow-visible">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="section-icon">
                  <Clock className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Upload History</CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Past file imports and records</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs rounded-lg">{uploadHistory.length} uploads</Badge>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <Skeleton className="h-16 rounded-2xl" />
              ) : uploadHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No uploads yet</p>
              ) : (
                <div className="space-y-1">
                  {uploadHistory.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0 gap-2" data-testid={`upload-history-${item.id}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 dark:bg-muted/30 flex-shrink-0">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{item.fileName}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                            <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                            {item.createdAt ? new Date(item.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"} by {item.uploadedBy}
                            {item.totalRows > 0 && <span> &middot; {item.totalRows} rows</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                        <Badge variant="secondary" className="text-[10px] bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0 rounded-lg">{item.recordsCreated} new</Badge>
                        <Badge variant="secondary" className="text-[10px] bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-0 rounded-lg">{item.recordsUpdated} updated</Badge>
                        {item.recordsFailed > 0 && (
                          <Badge variant="destructive" className="text-[10px] rounded-lg">{item.recordsFailed} failed</Badge>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground"
                              data-testid={`button-delete-upload-${item.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Upload Record</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove this upload record. If this is the last upload, all tenant financial data will be cleared. Activity history (remarks and follow-ups) will be preserved.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteUploadMutation.mutate(item.id)}
                                className="bg-destructive text-destructive-foreground"
                                data-testid="button-confirm-delete"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {showMapping && (
        <motion.div key="mapping" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }}>
          <Card className="glass-card rounded-2xl border-0">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-semibold">Map Columns</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  <FileSpreadsheet className="w-3 h-3 inline mr-1" />
                  {selectedFile?.name} &middot; {fileHeaders.length} columns detected
                </p>
              </div>
              <Badge variant={requiredFieldsMapped ? "default" : "secondary"} className="shadow-sm rounded-lg">
                {requiredFieldsMapped ? "Ready" : "Map required fields"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {SYSTEM_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                  <div className="min-w-[180px] flex items-center gap-1.5">
                    <span className="text-sm font-medium">{field.label}</span>
                    {field.required && <span className="text-destructive text-xs">*</span>}
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 hidden sm:block" />
                  <Select
                    value={mapping[field.key] || "unmapped"}
                    onValueChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v === "unmapped" ? "" : v }))}
                  >
                    <SelectTrigger className="w-full sm:flex-1 rounded-xl border-border/50" data-testid={`select-mapping-${field.key}`}>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unmapped">&mdash; Not mapped &mdash;</SelectItem>
                      {fileHeaders.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-4">
                <Button
                  onClick={() => uploadMutation.mutate()}
                  disabled={!requiredFieldsMapped || uploadMutation.isPending}
                  className="shadow-lg shadow-emerald-500/20 rounded-full"
                  data-testid="button-upload-submit"
                >
                  {uploadMutation.isPending ? "Uploading..." : "Upload & Process"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowMapping(false); setSelectedFile(null); setFileHeaders([]); }}
                  className="rounded-full"
                  data-testid="button-upload-cancel"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
