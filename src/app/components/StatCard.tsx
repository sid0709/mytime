import { type ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down";
  icon: ReactNode;
  color?: string;
  subtitle?: string;
}

export function StatCard({
  title,
  value,
  change,
  trend,
  icon,
  color = "bg-primary/10 text-primary",
  subtitle,
}: StatCardProps) {
  return (
    <div className="bg-card rounded-2xl border border-border p-3 sm:p-5 hover:border-primary/20 transition-all duration-300 group">
      <div className="flex items-start justify-between mb-2 sm:mb-4">
        <div
          className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${color} transition-transform duration-300 group-hover:scale-110`}
        >
          {icon}
        </div>
        {change && (
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${
              trend === "up"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {trend === "up" ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {change}
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-[11px] sm:text-xs mb-1">{title}</p>
      <p className="text-xl sm:text-2xl text-foreground tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-muted-foreground text-xs mt-1">{subtitle}</p>
      )}
    </div>
  );
}