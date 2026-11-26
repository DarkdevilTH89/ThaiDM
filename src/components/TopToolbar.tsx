import React from "react";
import {
  OctagonX,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  PlusCircle,
  Search,
  Settings,
  Square,
  Trash2,
  Video,
} from "lucide-react";

interface TopToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  hasSelection: boolean;
  canResumeSelected: boolean;
  canStopSelected: boolean;
  hasActiveDownloads: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddUrl: () => void;
  onOpenGrabVideo: () => void;
  onResumeSelected: () => void;
  onStopSelected: () => void;
  onStopAll: () => void;
  onDeleteSelected: () => void;
  onOpenOptions: () => void;
}

interface ToolbarBtnProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title?: string;
}

const ToolbarButton: React.FC<ToolbarBtnProps> = ({
  label,
  icon,
  onClick,
  disabled = false,
  accent = false,
  title,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    title={title || label}
    className={`royal-gloss-btn flex min-w-[66px] flex-col items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-white transition-all duration-150 ${
      accent
        ? "!border-amber-300/60 !bg-gradient-to-b !from-amber-400/90 !to-amber-600/90 !text-slate-950 font-semibold shadow-sm hover:!from-amber-300 hover:!to-amber-500"
        : ""
    } disabled:cursor-not-allowed disabled:opacity-40`}
  >
    <span className="flex items-center justify-center">{icon}</span>
    <span className="whitespace-nowrap text-[11px] font-medium leading-none tracking-tight">
      {label}
    </span>
  </button>
);

export const TopToolbar: React.FC<TopToolbarProps> = ({
  sidebarCollapsed,
  onToggleSidebar,
  hasSelection,
  canResumeSelected,
  canStopSelected,
  hasActiveDownloads,
  searchQuery,
  onSearchChange,
  onOpenAddUrl,
  onOpenGrabVideo,
  onResumeSelected,
  onStopSelected,
  onStopAll,
  onDeleteSelected,
  onOpenOptions,
}) => {
  return (
    <header className="royal-gloss-bar flex shrink-0 items-center justify-between gap-3 border-b border-[#1E3A8A] px-3 py-2 text-white">
      {/* Left: Brand + Sidebar Toggle + IDM Action Buttons */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "Expand Categories" : "Collapse Categories"}
          className="royal-gloss-btn flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-blue-100 transition-colors hover:text-white"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        {/* Brand Badge */}
        <div className="mr-1 flex shrink-0 items-center gap-2 border-r border-white/20 pr-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/40 bg-gradient-to-b from-blue-400/80 to-blue-800/90 text-sm font-extrabold tracking-tight text-white shadow-inner">
            DM
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-white">ไทยDM</div>
            <div className="text-[10px] font-medium text-blue-100/85">Download Manager</div>
          </div>
        </div>

        {/* Classic IDM Action Buttons */}
        <div className="flex items-center gap-1.5">
          <ToolbarButton
            label="Add URL"
            icon={<PlusCircle className="h-4 w-4 text-emerald-300" />}
            onClick={onOpenAddUrl}
          />
          <ToolbarButton
            label="Resume"
            icon={<Play className="h-4 w-4 text-sky-200" />}
            onClick={onResumeSelected}
            disabled={!canResumeSelected}
          />
          <ToolbarButton
            label="Stop"
            icon={<Square className="h-4 w-4 text-amber-200" />}
            onClick={onStopSelected}
            disabled={!canStopSelected}
          />
          <ToolbarButton
            label="Stop All"
            icon={<OctagonX className="h-4 w-4 text-rose-200" />}
            onClick={onStopAll}
            disabled={!hasActiveDownloads}
          />
          <ToolbarButton
            label="Delete"
            icon={<Trash2 className="h-4 w-4 text-rose-200" />}
            onClick={onDeleteSelected}
            disabled={!hasSelection}
          />

          <div className="mx-0.5 h-8 w-px bg-white/20" />

          <ToolbarButton
            label="Grab Video"
            icon={<Video className="h-4 w-4 text-slate-950" />}
            onClick={onOpenGrabVideo}
            accent
            title="Grab Video from YouTube / TikTok / Social Media"
          />

          <ToolbarButton
            label="Options"
            icon={<Settings className="h-4 w-4 text-blue-100" />}
            onClick={onOpenOptions}
          />
        </div>
      </div>

      {/* Right: Quick Filter Input */}
      <div className="relative hidden w-52 shrink-0 lg:block">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-blue-200" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search downloads..."
          className="w-full rounded-md border border-white/25 bg-[#1E3A8A]/55 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-blue-200/75 shadow-inner focus:border-white/60 focus:bg-[#1E3A8A]/80 focus:outline-none"
        />
      </div>
    </header>
  );
};
