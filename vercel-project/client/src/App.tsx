import { Switch, Route, Link, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import hoolivLogo from "@assets/Logo-Green-transparent_1771019317450.png";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TenantsPage from "@/pages/tenants";
import UploadPage from "@/pages/upload";
import SettingsPage from "@/pages/settings";
import TicketsPage from "@/pages/tickets";
import LoginPage from "@/pages/login";
import ProfilePage from "@/pages/profile";
import SetPasswordPage from "@/pages/set-password";

function UserBadge() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Link href={"/profile"}>
      <div className="flex items-center gap-2.5 cursor-pointer" data-testid="link-user-profile">
        <Avatar className="w-9 h-9 shadow-sm">
          <AvatarFallback className="text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {user.displayName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="hidden sm:flex flex-col">
          <span
            className="text-sm font-medium text-foreground leading-tight"
            data-testid="text-current-user"
          >
            {user.displayName}
          </span>
          <span className="text-[10px] text-muted-foreground leading-tight">
            {user.roleLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}

function AppRouter() {
  const { permissions } = useAuth();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tenants" component={TenantsPage} />
      {permissions.canManageUploads ? (
        <Route path="/upload" component={UploadPage} />
      ) : (
        <Route path="/upload">{() => <Redirect to="/" />}</Route>
      )}
      {permissions.canManageTickets ? (
        <Route path="/tickets" component={TicketsPage} />
      ) : (
        <Route path="/tickets">{() => <Redirect to="/" />}</Route>
      )}
      <Route path="/profile" component={ProfilePage} />
      {permissions.canManageSettings ? (
        <Route path="/settings" component={SettingsPage} />
      ) : (
        <Route path="/settings">{() => <Redirect to="/" />}</Route>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

const BRANDING_HEIGHT = "80px";

function AppLayout() {
  const style = {
    "--sidebar-width": "220px",
    "--sidebar-width-icon": "80px",
    "--branding-height": BRANDING_HEIGHT,
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="h-screen flex flex-col w-full" data-layout="hoolivapp">
        <div className="flex flex-shrink-0 relative z-50" style={{ height: BRANDING_HEIGHT }}>
          <div
            className="w-[220px] flex-shrink-0 bg-white dark:bg-[hsl(222,35%,9%)] border-b border-border flex items-center px-4 hidden md:flex"
            data-testid="div-branding-block"
          >
            <Link href="/" data-testid="link-brand-home">
              <div className="flex flex-col items-start gap-1 cursor-pointer">
                <img
                  src={hoolivLogo}
                  alt="HooLiv"
                  className="h-10 w-auto"
                  data-testid="img-brand-logo"
                />
                <p className="text-xs text-muted-foreground leading-none tracking-wide">
                  Tenant Dues Manager
                </p>
              </div>
            </Link>
          </div>
          <header
            className="flex-1 min-w-0 glass-header flex items-center justify-between gap-2 px-5 border-b border-border"
            data-testid="div-header"
          >
            <Link href="/" className="flex items-center gap-2 md:hidden flex-shrink-0" data-testid="link-brand-home-mobile">
              <div className="flex flex-col items-start cursor-pointer">
                <img
                  src={hoolivLogo}
                  alt="HooLiv"
                  className="h-9 w-auto"
                  data-testid="img-brand-logo-mobile"
                />
                <p className="text-[10px] text-muted-foreground leading-none tracking-wide">
                  Tenant Dues Manager
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              <span
                className="text-sm text-muted-foreground hidden md:inline"
                data-testid="text-header-date"
              >
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <UserBadge />
              <ThemeToggle />
              <SidebarTrigger className="md:hidden" data-testid="button-mobile-menu" />
            </div>
          </header>
        </div>

        <div className="flex flex-1 min-h-0">
          <AppSidebar />
          <main className="flex-1 overflow-auto min-w-0">
            <AppRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src={hoolivLogo} alt="HooLiv" className="h-12 w-auto" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (user.mustChangePassword) {
    return <SetPasswordPage />;
  }

  return <AppLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
