import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/components/auth-provider";
import { LogOut, Phone, Shield, User, MapPin, Building2 } from "lucide-react";
import { motion } from "framer-motion";

export default function ProfilePage() {
  const { user, logout, isAdmin } = useAuth();

  if (!user) return null;

  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-5"
      >
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-profile-title">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your account details</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex flex-col items-center sm:items-start gap-3 sm:min-w-[160px]">
                <Avatar className="w-16 h-16 shadow-md">
                  <AvatarFallback className="text-xl font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="text-center sm:text-left">
                  <h2 className="text-lg font-bold" data-testid="text-profile-name">{user.displayName}</h2>
                  <Badge variant="secondary" className="mt-1 rounded-full" data-testid="badge-profile-role">
                    <Shield className="w-3 h-3 mr-1" />
                    {user.roleLabel}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 border-t sm:border-t-0 sm:border-l border-border/50 pt-4 sm:pt-0 sm:pl-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                  <div className="flex items-center justify-between sm:justify-start gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[80px]">
                      <User className="w-4 h-4" />
                      <span>Name</span>
                    </div>
                    <span className="text-sm font-medium" data-testid="text-profile-display-name">{user.displayName}</span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-start gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[80px]">
                      <Phone className="w-4 h-4" />
                      <span>Phone</span>
                    </div>
                    <span className="text-sm font-medium" data-testid="text-profile-phone">{user.phone}</span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-start gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[80px]">
                      <Shield className="w-4 h-4" />
                      <span>Role</span>
                    </div>
                    <span className="text-sm font-medium" data-testid="text-profile-role">{user.roleLabel}</span>
                  </div>
                </div>

                {user.assignedCities && user.assignedCities.length > 0 && (
                  <div className="mt-4 flex items-start gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[80px] pt-0.5">
                      <MapPin className="w-4 h-4" />
                      <span>Cities</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {user.assignedCities.map((c) => (
                        <Badge key={c} variant="secondary" className="rounded-full text-xs" data-testid={`badge-city-${c}`}>{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {user.assignedProperties && user.assignedProperties.length > 0 && (
                  <div className="mt-3 flex items-start gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[80px] pt-0.5">
                      <Building2 className="w-4 h-4" />
                      <span>Properties</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {user.assignedProperties.map((p) => (
                        <Badge key={p} variant="secondary" className="rounded-full text-xs" data-testid={`badge-property-${p}`}>{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
            <div className="flex justify-end mt-5 pt-4 border-t border-border/50">
              <Button
                variant="outline"
                className="text-red-600 dark:text-red-400"
                onClick={handleLogout}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
