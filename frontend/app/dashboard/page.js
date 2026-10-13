"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function DashboardIndexPage() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedUser = localStorage.getItem("admin_user");
    if (!storedUser) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(storedUser);
      const role = (user.role || user.role_id?.name || "USER").toUpperCase();
      if (role === "ADMIN") {
        router.replace("/dashboard/admin");
      } else {
        router.replace("/dashboard/user");
      }
    } catch (e) {
      router.replace("/login");
    }
  }, [router]);
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      color: "#64748b",
      fontSize: "15px",
      fontWeight: 500
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: "36px",
          height: "36px",
          border: "3px solid #e2e8f0",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto 16px"
        }} />
        <p>Loading your dashboard...</p>
      </div>
    </div>
  );
}
