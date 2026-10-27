import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";

interface UsernameContextType {
  username: string;
  setUsername: (name: string) => void;
}

const UsernameContext = createContext<UsernameContextType>({
  username: "",
  setUsername: () => {},
});

export function useUsername() {
  const auth = useAuth();
  if (auth.user) {
    return { username: auth.user.displayName, setUsername: () => {} };
  }
  return useContext(UsernameContext);
}

export function UsernameProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
