import React from "react";
import {
  Archive,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  FolderDown,
  Music,
  Video,
} from "lucide-react";
import type { DownloadItem, SidebarFilter } from "../types/download";

interface CategorySidebarProps {
  collapsed: boolean;
  activeFilter: SidebarFilter;
  downloads: DownloadItem[];
  onSelectFilter: (filter: SidebarFilter) => void;
}

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  collapsed,
  activeFilter,
  downloads,
  onSelectFilter,
}) => {
  if (collapsed) {
    return null;
  }

  const countBy = (fn: (d: DownloadItem) => boolean) => downloads.filter(fn).length;

  const categoryItems: Array<{
    id: SidebarFilter;
    label: string;
    icon: React.ReactNode;
    count: number;
  }> = [
    {
      id: "all",
      label: "All Downloads",
      icon: <FolderDown className="h-4 w-4" />,
      count: downloads.length,
    },
    {
      id: "video",
      label: "Video (YouTube / Social)",
      icon: <Video className="h-4 w-4" />,
      count: countBy((d) => d.category === "video"),
    },
    {
      id: "music",
      label: "Music",
      icon: <Music className="h-4 w-4" />,
      count: countBy((d) => d.category === "music"),
    },
    {
      id: "documents",
      label: "Documents",
      icon: <FileText className="h-4 w-4" />,
      count: countBy((d) => d.category === "documents"),
    },
    {
      id: "programs",
      label: "Programs",
      icon: <Cpu className="h-4 w-4" />,
      count: countBy((d) => d.category === "programs"),
    },
    {
      id: "compressed",
      label: "Compressed",
      icon: <Archive className="h-4 w-4" />,
      count: countBy((d) => d.category === "compressed"),
    },
  ];

  const statusItems: Array<{
    id: SidebarFilter;
    label: string;
    icon: React.ReactNode;
    count: number;
  }> = [
    {
      id: "unfinished",
      label: "Unfinished",
      icon: <Clock className="h-4 w-4" />,
      count: countBy((d) => d.status !== "completed"),
    },
    {
      id: "finished",
      label: "Finished",
      icon: <CheckCircle2 className="h-4 w-4" />,
      count: countBy((d) => d.status === "completed"),
    },
  ];

  const renderItem = (item: {
    id: SidebarFilter;
    label: string;
    icon: React.ReactNode;
    count: number;
  }) => {
    const active = activeFilter === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectFilter(item.id)}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-all duration-150 ${
          active
            ? "royal-gloss-active font-semibold text-white"
            : "text-slate-700 hover:bg-blue-50 hover:text-[#1E40AF]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={active ? "text-blue-100" : "text-[#2563EB]"}>{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? "bg-white/20 text-white" : "bg-slate-200/80 text-slate-600"
          }`}
        >
          {item.count}
        </span>
      </button>
    );
  };

  return (
    <aside className="flex w-[205px] shrink-0 flex-col border-r border-[#CBD5E1] bg-white">
      <div className="border-b border-[#CBD5E1] bg-slate-50 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#1E40AF]">
          Categories
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Download categories">
        {categoryItems.map(renderItem)}

        <div className="my-2.5 border-t border-[#CBD5E1] pt-2.5">
          <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Status Filters
          </p>
          <div className="space-y-0.5">{statusItems.map(renderItem)}</div>
        </div>
      </nav>
    </aside>
  );
};
