import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Check, ChevronDown } from "lucide-react";

export interface PremiumSelectOption {
  value: string;
  label: string;
  color?: string;
  icon?: React.ReactNode;
  description?: string;
}

interface PremiumSelectProps {
  value: string;
  options: PremiumSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  dropdownAlign?: "left" | "right";
  showColorDot?: boolean;
}

export function PremiumSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  size = "sm",
  className = "",
  dropdownAlign = "right",
  showColorDot = true,
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, dropUp: false });

  const selectedOption = options.find((o) => o.value === value);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldDropUp = spaceBelow < 220;
    setPos({
      top: shouldDropUp ? rect.top : rect.bottom + 4,
      left: dropdownAlign === "right" ? rect.right : rect.left,
      dropUp: shouldDropUp,
    });
  }, [dropdownAlign]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(t) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const onUpdate = () => updatePosition();
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);
    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [open, updatePosition]);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  const sizeClasses = {
    xs: "px-1.5 py-0.5 text-[10px] gap-1",
    sm: "px-2 py-1 text-xs gap-1.5",
    md: "px-3 py-1.5 text-sm gap-2",
  };

  const dotSize = {
    xs: "w-2 h-2",
    sm: "w-2.5 h-2.5",
    md: "w-3 h-3",
  };

  const dropdown = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, scale: 0.95, y: pos.dropUp ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: pos.dropUp ? 4 : -4 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          className="fixed z-[9999] min-w-[140px] max-w-[200px] bg-popover/95 backdrop-blur-xl border border-border/80 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.03)] overflow-hidden"
          style={{
            top: pos.dropUp ? undefined : pos.top,
            bottom: pos.dropUp
              ? window.innerHeight - pos.top + 4
              : undefined,
            ...(dropdownAlign === "right"
              ? { right: window.innerWidth - pos.left }
              : { left: pos.left }),
          }}
        >
          {/* Glow accent line */}
          <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="p-1 max-h-[180px] overflow-y-auto scrollbar-thin">
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <motion.button
                  key={option.value}
                  type="button"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: index * 0.02,
                    duration: 0.15,
                  }}
                  onClick={() => handleSelect(option.value)}
                  className={`
                    flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left cursor-pointer
                    transition-all duration-150 group
                    ${
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-secondary/80"
                    }
                  `}
                >
                  {option.color && showColorDot && (
                    <div
                      className={`${dotSize[size]} rounded-full shrink-0 transition-transform duration-150 group-hover:scale-125 ring-1 ring-white/10`}
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  {option.icon && (
                    <span className="shrink-0">{option.icon}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <span
                      className={`block truncate ${
                        size === "xs"
                          ? "text-[10px]"
                          : size === "sm"
                          ? "text-xs"
                          : "text-sm"
                      }`}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block text-[9px] text-muted-foreground truncate">
                        {option.description}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 25,
                      }}
                    >
                      <Check className="w-3 h-3 text-primary shrink-0" />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Bottom glow accent */}
          <div className="h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={`relative ${className}`}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`
          flex items-center rounded-lg cursor-pointer transition-all duration-200
          bg-secondary/40 border border-border
          hover:bg-secondary hover:border-primary/20
          focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30
          ${open ? "bg-secondary border-primary/30 ring-1 ring-primary/20 shadow-[0_0_12px_rgba(99,102,241,0.08)]" : ""}
          ${sizeClasses[size]}
        `}
      >
        {selectedOption?.color && showColorDot && (
          <div
            className={`${dotSize[size]} rounded-full shrink-0 ring-1 ring-white/10`}
            style={{ backgroundColor: selectedOption.color }}
          />
        )}
        {selectedOption?.icon && (
          <span className="shrink-0">{selectedOption.icon}</span>
        )}
        <span className="text-foreground truncate max-w-[80px]">
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Portal dropdown to escape overflow:hidden */}
      {createPortal(dropdown, document.body)}
    </div>
  );
}
