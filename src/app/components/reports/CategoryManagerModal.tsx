import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  Search,
  GripVertical,
  Tag,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Undo2,
} from "lucide-react";
import { PremiumSelect } from "../ui/PremiumSelect";

export interface AppEntry {
  id: string;
  name: string;
  color: string;
  minutes: number;
  iconDataUrl?: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  isDefault?: boolean; // "Others" is default and non-removable
}

interface CategoryManagerModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  appAssignments: Record<string, string>; // appId -> categoryId
  allApps: AppEntry[];
  onSave: (
    categories: Category[],
    assignments: Record<string, string>
  ) => Promise<void> | void;
}

/** Display minutes in Category Manager with at most 2 decimal places (e.g. 4.23m). */
export function formatAppMinutesForDisplay(minutes: number): string {
  if (!Number.isFinite(minutes)) return "0.00";
  return (Math.round(minutes * 100) / 100).toFixed(2);
}

const PRESET_COLORS = [
  "#6366f1",
  "#22d3ee",
  "#a78bfa",
  "#f97316",
  "#34d399",
  "#ef4444",
  "#ec4899",
  "#eab308",
  "#14b8a6",
  "#8b5cf6",
  "#f43f5e",
  "#06b6d4",
  "#84cc16",
  "#d946ef",
  "#fb923c",
  "#64748b",
];

export function CategoryManagerModal({
  open,
  onClose,
  categories: initialCategories,
  appAssignments: initialAssignments,
  allApps,
  onSave,
}: CategoryManagerModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#6366f1");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [colorPickerCatId, setColorPickerCatId] = useState<string | null>(null);
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [dragOverCatId, setDragOverCatId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const newCatInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const colorSwatchRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [colorPickerCoords, setColorPickerCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setCategories(initialCategories.map((c) => ({ ...c })));
      setAssignments({ ...initialAssignments });
      setSearch("");
      setEditingCatId(null);
      setAddingNew(false);
      setExpandedCats(new Set(initialCategories.map((c) => c.id)));
      setColorPickerCatId(null);
      setIsSaving(false);
      setSaveError(null);
    }
  }, [open, initialCategories, initialAssignments]);

  useEffect(() => {
    if (addingNew && newCatInputRef.current) {
      newCatInputRef.current.focus();
    }
  }, [addingNew]);

  useEffect(() => {
    if (editingCatId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCatId]);

  const pickerCategory = useMemo(
    () => categories.find((c) => c.id === colorPickerCatId),
    [categories, colorPickerCatId],
  );

  useLayoutEffect(() => {
    if (!colorPickerCatId) {
      setColorPickerCoords(null);
      return;
    }
    const btn = colorSwatchRefs.current[colorPickerCatId];
    if (!btn) {
      setColorPickerCoords(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    setColorPickerCoords({ top: r.bottom + 4, left: r.left });
  }, [colorPickerCatId]);

  useEffect(() => {
    if (!colorPickerCatId) return;
    const sync = () => {
      const btn = colorSwatchRefs.current[colorPickerCatId];
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setColorPickerCoords({ top: r.bottom + 4, left: r.left });
    };
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [colorPickerCatId]);

  useEffect(() => {
    if (!colorPickerCatId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const picker = document.getElementById("category-color-picker-popover");
      const btn = colorSwatchRefs.current[colorPickerCatId];
      if (picker?.contains(t) || btn?.contains(t)) return;
      setColorPickerCatId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colorPickerCatId]);

  const filteredApps = useMemo(() => {
    if (!search.trim()) return allApps;
    const q = search.toLowerCase();
    return allApps.filter((a) => a.name.toLowerCase().includes(q));
  }, [allApps, search]);

  // Group apps by category
  const appsByCategory = useMemo(() => {
    const map: Record<string, AppEntry[]> = {};
    for (const cat of categories) {
      map[cat.id] = [];
    }
    for (const app of filteredApps) {
      const catId = assignments[app.id] || "cat-others";
      if (!map[catId]) map[catId] = [];
      map[catId].push(app);
    }
    return map;
  }, [categories, filteredApps, assignments]);

  const toggleExpanded = (catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const id = `cat-${Date.now()}`;
    setCategories((prev) => [
      ...prev.filter((c) => c.isDefault),
      ...prev.filter((c) => !c.isDefault),
      { id, name: newCatName.trim(), color: newCatColor },
    ].sort((a, b) => {
      if (a.isDefault) return 1;
      if (b.isDefault) return -1;
      return 0;
    }));
    setExpandedCats((prev) => new Set([...prev, id]));
    setNewCatName("");
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setAddingNew(false);
  };

  const handleRenameCategory = (catId: string) => {
    if (!editingName.trim()) {
      setEditingCatId(null);
      return;
    }
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, name: editingName.trim() } : c
      )
    );
    setEditingCatId(null);
  };

  const handleDeleteCategory = (catId: string) => {
    // Move all apps in this category to Others
    setAssignments((prev) => {
      const next = { ...prev };
      for (const [appId, cId] of Object.entries(next)) {
        if (cId === catId) {
          next[appId] = "cat-others";
        }
      }
      return next;
    });
    setCategories((prev) => prev.filter((c) => c.id !== catId));
  };

  const handleChangeCategoryColor = (catId: string, color: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === catId ? { ...c, color } : c))
    );
    setColorPickerCatId(null);
  };

  const handleAssignApp = (appId: string, catId: string) => {
    setAssignments((prev) => ({ ...prev, [appId]: catId }));
  };

  const categoriesWithPendingEdit = useMemo(() => {
    if (!editingCatId || !editingName.trim()) {
      return categories;
    }
    return categories.map((category) =>
      category.id === editingCatId
        ? { ...category, name: editingName.trim() }
        : category,
    );
  }, [categories, editingCatId, editingName]);

  const buildCategoriesForSave = () => {
    let next = categoriesWithPendingEdit.map((category) => ({ ...category }));
    if (addingNew && newCatName.trim()) {
      next = [
        ...next,
        {
          id: `cat-${Date.now()}`,
          name: newCatName.trim(),
          color: newCatColor,
        },
      ].sort((a, b) => {
        if (a.isDefault) return 1;
        if (b.isDefault) return -1;
        return 0;
      });
    }
    return next;
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      await Promise.resolve(onSave(buildCategoriesForSave(), assignments));
      setIsSaving(false);
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Failed to save category settings.",
      );
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setCategories(initialCategories.map((c) => ({ ...c })));
    setAssignments({ ...initialAssignments });
  };

  const hasChanges = useMemo(() => {
    if (addingNew && newCatName.trim()) return true;
    if (categoriesWithPendingEdit.length !== initialCategories.length) return true;
    for (const cat of categoriesWithPendingEdit) {
      const orig = initialCategories.find((c) => c.id === cat.id);
      if (!orig || orig.name !== cat.name || orig.color !== cat.color)
        return true;
    }
    for (const [appId, catId] of Object.entries(assignments)) {
      if (initialAssignments[appId] !== catId) return true;
    }
    return false;
  }, [
    addingNew,
    newCatName,
    categoriesWithPendingEdit,
    assignments,
    initialCategories,
    initialAssignments,
  ]);

  // Sort categories: custom first, Others last
  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return 1;
      if (!a.isDefault && b.isDefault) return -1;
      return 0;
    });
  }, [categories]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isSaving) onClose();
            }}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 pb-4 border-b border-border shrink-0">
              <div>
                <h2 className="text-foreground flex items-center gap-2">
                  <Tag className="w-5 h-5 text-chart-3" />
                  Category Manager
                </h2>
                <p className="text-muted-foreground text-xs mt-1">
                  Organize apps into categories — drag apps or use the dropdown
                  to reassign
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={isSaving}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border shrink-0">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search apps..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-secondary/60 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <button
                onClick={() => setAddingNew(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Category
              </button>
              {hasChanges && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
            </div>

            {/* Add New Category Form */}
            <AnimatePresence>
              {addingNew && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-5 py-3 border-b border-border bg-primary/5">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setNewCatColor(c)}
                            className={`w-5 h-5 rounded-md transition-all cursor-pointer ${
                              newCatColor === c
                                ? "ring-2 ring-white/60 scale-110"
                                : "hover:scale-110"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div
                        className="w-4 h-4 rounded-md shrink-0"
                        style={{ backgroundColor: newCatColor }}
                      />
                      <input
                        ref={newCatInputRef}
                        type="text"
                        placeholder="Category name..."
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddCategory();
                          if (e.key === "Escape") setAddingNew(false);
                        }}
                        className="flex-1 bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={handleAddCategory}
                        disabled={!newCatName.trim()}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setAddingNew(false)}
                        className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Category List */}
            {saveError && (
              <div className="px-5 py-2 border-b border-border bg-destructive/10 text-xs text-destructive">
                {saveError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
              <div className="space-y-2">
                {sortedCategories.map((cat) => {
                  const apps = appsByCategory[cat.id] || [];
                  const isExpanded = expandedCats.has(cat.id);
                  const isEditing = editingCatId === cat.id;
                  const isDragOver = dragOverCatId === cat.id;

                  return (
                    <motion.div
                      key={cat.id}
                      layout
                      className={`rounded-xl border transition-colors ${
                        isDragOver
                          ? "border-primary bg-primary/5"
                          : "border-border"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverCatId(cat.id);
                      }}
                      onDragLeave={() => setDragOverCatId(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedAppId) {
                          handleAssignApp(draggedAppId, cat.id);
                          setDraggedAppId(null);
                        }
                        setDragOverCatId(null);
                      }}
                    >
                      {/* Category Header */}
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                          onClick={() => toggleExpanded(cat.id)}
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Color swatch / picker (popover portaled to body to avoid scroll clipping) */}
                        <div className="relative">
                          <button
                            type="button"
                            ref={(el) => {
                              colorSwatchRefs.current[cat.id] = el;
                            }}
                            onClick={() =>
                              setColorPickerCatId(
                                colorPickerCatId === cat.id ? null : cat.id
                              )
                            }
                            className="w-4 h-4 rounded-md cursor-pointer ring-1 ring-white/10 hover:ring-white/30 transition-all"
                            style={{ backgroundColor: cat.color }}
                          />
                        </div>

                        {/* Name (editable) */}
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleRenameCategory(cat.id);
                              if (e.key === "Escape") setEditingCatId(null);
                            }}
                            onBlur={() => handleRenameCategory(cat.id)}
                            className="flex-1 bg-secondary border border-primary/30 rounded-md px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        ) : (
                          <span className="flex-1 text-xs text-foreground truncate">
                            {cat.name}
                            {cat.isDefault && (
                              <span className="ml-1.5 text-[9px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-md">
                                default
                              </span>
                            )}
                          </span>
                        )}

                        {/* App count */}
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {apps.length} app{apps.length !== 1 ? "s" : ""}
                        </span>

                        {/* Actions */}
                        {!cat.isDefault && (
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => {
                                setEditingCatId(cat.id);
                                setEditingName(cat.name);
                              }}
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* App List */}
                      <AnimatePresence initial={false}>
                        {isExpanded && apps.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-2.5 space-y-0.5">
                              {apps.map((app) => (
                                <motion.div
                                  key={app.id}
                                  layout
                                  draggable
                                  onDragStart={() => setDraggedAppId(app.id)}
                                  onDragEnd={() => {
                                    setDraggedAppId(null);
                                    setDragOverCatId(null);
                                  }}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors group cursor-grab active:cursor-grabbing ${
                                    draggedAppId === app.id
                                      ? "bg-primary/10 opacity-50"
                                      : "hover:bg-secondary/60"
                                  }`}
                                >
                                  <GripVertical className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                                  <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: app.color }}
                                  />
                                  <span className="text-foreground flex-1 truncate">
                                    {app.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                    {formatAppMinutesForDisplay(app.minutes)}m
                                  </span>
                                  {/* Category reassign dropdown */}
                                  <PremiumSelect
                                    value={assignments[app.id] || "cat-others"}
                                    onChange={(val) =>
                                      handleAssignApp(app.id, val)
                                    }
                                    size="xs"
                                    showColorDot
                                    options={sortedCategories.map((c) => ({
                                      value: c.id,
                                      label: c.name,
                                      color: c.color,
                                    }))}
                                  />
                                </motion.div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                        {isExpanded && apps.length === 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-2.5">
                              <div className="flex items-center gap-2 px-2.5 py-3 rounded-lg border border-dashed border-border text-muted-foreground text-[10px]">
                                <FolderOpen className="w-3.5 h-3.5" />
                                {search
                                  ? "No matching apps"
                                  : "No apps — drag apps here to assign"}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0 bg-card">
              <div className="text-[10px] text-muted-foreground">
                {allApps.length} apps across {categories.length} categories
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-secondary text-foreground text-xs hover:bg-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </motion.div>

          {typeof document !== "undefined" &&
            colorPickerCatId &&
            colorPickerCoords &&
            pickerCategory &&
            createPortal(
              <motion.div
                id="category-color-picker-popover"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="fixed z-[9999] bg-popover border border-border rounded-xl p-2 shadow-xl"
                style={{
                  top: colorPickerCoords.top,
                  left: colorPickerCoords.left,
                }}
              >
                <div className="grid grid-cols-8 gap-1">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        handleChangeCategoryColor(pickerCategory.id, c);
                        setColorPickerCatId(null);
                      }}
                      className={`w-5 h-5 rounded-md transition-all cursor-pointer ${
                        pickerCategory.color === c
                          ? "ring-2 ring-white/60 scale-110"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </motion.div>,
              document.body,
            )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
