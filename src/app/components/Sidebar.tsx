import { useState } from "react";
import {
  Activity,
  LayoutDashboard,
  HelpCircle,
  ScrollText,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, color: "#6366f1" },
  { id: "activity", label: "Activity", icon: Activity, color: "#22d3ee" },
  { id: "logs", label: "Logs", icon: ScrollText, color: "#2dd4bf" },
  { id: "help", label: "Help", icon: HelpCircle, color: "#f97316" },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[72px] bg-sidebar border-r border-sidebar-border flex-col items-center py-6 shrink-0 relative">
        {/* Logo */}
        <motion.div
          className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-10 cursor-pointer relative"
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.88 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
        >
          <div
            className="absolute inset-0 rounded-xl bg-primary"
            style={{ boxShadow: "0 0 16px 1px rgba(99,102,241,0.24)" }}
          />
          <Activity className="w-5 h-5 text-primary-foreground relative z-10" />
        </motion.div>

        {/* Nav Items */}
        <nav className="flex flex-col items-center gap-3 flex-1">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isHovered = hoveredId === item.id;

            return (
              <div key={item.id} className="relative">
                {/* Active pill indicator on left edge */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-pill"
                      className="absolute -left-[14px] top-1/2 w-[3px] rounded-r-full"
                      style={{ backgroundColor: item.color }}
                      initial={{ height: 0, y: "-50%", opacity: 0 }}
                      animate={{ height: 20, y: "-50%", opacity: 1 }}
                      exit={{ height: 0, y: "-50%", opacity: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    />
                  )}
                </AnimatePresence>

                <motion.button
                  onClick={() => onTabChange(item.id)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="relative w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer overflow-hidden"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                    delay: index * 0.06,
                  }}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.88 }}
                >
                  {/* Active background with glow */}
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active-bg"
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: `linear-gradient(135deg, ${item.color}, ${item.color}dd)`,
                        boxShadow: `0 4px 20px -2px ${item.color}50`,
                      }}
                      transition={{ type: "spring", stiffness: 350, damping: 28 }}
                    />
                  )}

                  {/* Hover background */}
                  <AnimatePresence>
                    {isHovered && !isActive && (
                      <motion.div
                        className="absolute inset-0 rounded-xl bg-secondary"
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      />
                    )}
                  </AnimatePresence>

                  <motion.div
                    className="relative z-10"
                    animate={{
                      color: isActive ? "#ffffff" : isHovered ? "var(--foreground)" : "var(--muted-foreground)",
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <Icon className="w-5 h-5" />
                  </motion.div>
                </motion.button>

                {/* Tooltip */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      className="absolute left-full top-1/2 ml-3 z-50 pointer-events-none"
                      initial={{ opacity: 0, x: -6, y: "-50%", scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
                      exit={{ opacity: 0, x: -6, y: "-50%", scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 600, damping: 28 }}
                    >
                      <div className="flex items-stretch rounded-lg overflow-hidden shadow-2xl border border-border/60">
                        <div className="w-[3px]" style={{ backgroundColor: item.color }} />
                        <div className="bg-popover px-3 py-1.5">
                          <span className="text-xs text-foreground whitespace-nowrap">{item.label}</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar/95 backdrop-blur-md border-t border-sidebar-border">
        <div className="flex items-center justify-around px-2 py-1.5 safe-bottom">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <motion.button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl cursor-pointer min-w-0"
                whileTap={{ scale: 0.9 }}
              >
                {isActive && (
                  <motion.div
                    layoutId="mobile-active-bg"
                    className="absolute inset-0 rounded-xl"
                    style={{
                      background: `${item.color}18`,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  />
                )}
                <Icon
                  className="w-5 h-5 relative z-10 transition-colors"
                  style={{ color: isActive ? item.color : "var(--muted-foreground)" }}
                />
                <span
                  className="text-[10px] relative z-10 transition-colors"
                  style={{ color: isActive ? item.color : "var(--muted-foreground)" }}
                >
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
