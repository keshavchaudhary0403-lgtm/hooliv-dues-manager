import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface UserPermissions {
  canManageUploads: boolean;
  canManageTeam: boolean;
  canManageSettings: boolean;
  canExportData: boolean;
  canManageTickets: boolean;
}

interface AuthUser {
  id: number;
  phone: string;
  displayName: string;
  role: string;
  roleLabel: string;
  assignedCities: string[];
  assignedProperties: string[];
  permissions: UserPermissions;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  permissions: UserPermissions;
  login: (phone: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const defaultPermissions: UserPermissions = {
  canManageUploads: false,
  canManageTeam: false,
  canManageSettings: false,
  canExportData: false,
  canManageTickets: false,
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAdmin: false,
  permissions: defaultPermissions,
  login: async () => { throw new Error("Not initialized"); },
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const lastAuthStatusRef = useRef<"authenticated" | "unauthenticated" | "error" | null>(null);

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.status === 401) {
          lastAuthStatusRef.current = "unauthenticated";
          return null;
        }
        if (!res.ok) {
          lastAuthStatusRef.current = "error";
          return null;
        }
        const data = await res.json();
        lastAuthStatusRef.current = "authenticated";
        return data;
      } catch {
        lastAuthStatusRef.current = "error";
        return null;
      }
    },
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });

  const wasAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (user) {
      wasAuthenticatedRef.current = true;
    } else if (
      !isLoading &&
      wasAuthenticatedRef.current &&
      !user &&
      lastAuthStatusRef.current === "unauthenticated"
    ) {
      wasAuthenticatedRef.current = false;
      queryClient.clear();
      window.location.href = "/";
    }
  }, [user, isLoading]);

  const loginMutation = useMutation({
    mutationFn: async ({ phone, password }: { phone: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { phone, password });
      return res.json() as Promise<AuthUser>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
    },
  });

  const login = async (phone: string, password: string): Promise<AuthUser> => {
    return loginMutation.mutateAsync({ phone, password });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const isAdmin = user?.role === "regional_head";
  const permissions = user?.permissions || defaultPermissions;

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, isAdmin, permissions, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
