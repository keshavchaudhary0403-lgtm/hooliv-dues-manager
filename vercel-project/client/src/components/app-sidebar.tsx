import {
  LayoutDashboard,
  Users,
  Upload,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Ticket,
  User,
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const allNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, permission: null },
  { title: "Collect Payments", url: "/tenants", icon: Users, permission: null },
  { title: "Upload Data", url: "/upload", icon: Upload, permission: "canManageUploads" as const },
  { title: "Tickets", url: "/tickets", icon: Ticket, permission: "canManageTickets" as const },
  { title: "Settings", url: "/settings", icon: Settings, permission: "canManageSettings" as const },
  { title: "Profile", url: "/profile", icon: User, permission: null },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const { isAdmin, permissions } = useAuth();
  const isCollapsed = state === "collapsed";

  const navItems = allNavItems.filter((item) => {
    if (!item.permission) return true;
    if (isAdmin) return true;
    return permissions[item.permission];
  });

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar collapsible="icon" mobileSide="right" className="glass-sidebar border-r-0">
      <SidebarHeader>
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-end"} px-1`}>
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleSidebar}
            data-testid="button-sidebar-toggle"
          >
            {isCollapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!isCollapsed && <SidebarGroupLabel>Navigation</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.url === "/"
                    ? location === "/"
                    : location.startsWith(item.url);

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      className={
                        isActive
                          ? isCollapsed
                            ? "nav-item-collapsed-active"
                            : "nav-item-active"
                          : isCollapsed
                            ? "nav-item-collapsed"
                            : "nav-item"
                      }
                    >
                      <Link href={item.url} onClick={handleNavClick}>
                        <item.icon className="w-4 h-4" />
                        <span className={isCollapsed ? "sr-only" : ""}>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!isCollapsed && (
        <SidebarFooter>
          <p className="text-[10px] text-muted-foreground/50 font-medium px-2">
            v1.0 &middot; HooLiv Internal
          </p>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
