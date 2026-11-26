import React, { useRef } from "react";
import { Archive, Cpu, DownloadCloud, FileText, Film, Music } from "lucide-react";
import {
  formatBytes,
  formatSpeed,
  type DownloadCategory,
  type DownloadItem,
} from "../types/download";

interface DownloadTableProps {
  items: DownloadItem[];
  selectedIds: Set<string>;
  onChangeSelection: (next: Set<string>) => void;
  onRowContextMenu: (e: React.MouseEvent, item: DownloadItem) => void;
}

const CATEGORY_ICON: Record<DownloadCategory, React.ReactNode> = {
  video: <Film className="h-4 w-4 text-[#2563EB]" />,
  music: <Music className="h-4 w-4 text-violet-600" />,
  documents: <FileText className="h-4 w-4 text-rose-600" />,
  programs: <Cpu className="h-4 w-4 text-indigo-700" />,
  compressed: <Archive className="h-4 w-4 text-amber-600" />,
};

const STATUS_TEXT: Record<DownloadItem["status"], string> = {
  downloading: "Downloading",
  completed: "Completed",
  paused: "Paused",
  queued: "Queued",
  error: "Error",
};

export const DownloadTable: React.FC<DownloadTableProps> = ({
  items,
  selectedIds,
  onChangeSelection,
  onRowContextMenu,
}) => {
  const lastClickedIndexRef = useRef<number | null>(null);

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      onChangeSelection(new Set());
    } else {
      onChangeSelection(new Set(items.map((item) => item.id)));
    }
  };

  const handleRowClick = (e: React.MouseEvent, item: DownloadItem, index: number) => {
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const next = new Set(selectedIds);
      for (let i = start; i <= end; i++) {
        next.add(items[i].id);
      }
      onChangeSelection(next);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      onChangeSelection(next);
      lastClickedIndexRef.current = index;
      return;
    }

    onChangeSelection(new Set([item.id]));
    lastClickedIndexRef.current = index;
  };

  const handleCheckboxClick = (e: React.MouseEvent, item: DownloadItem, index: number) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      next.add(item.id);
    }
    onChangeSelection(next);
    lastClickedIndexRef.current = index;
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F8FAFC]">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[740px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-[#CBD5E1] bg-gradient-to-b from-slate-100 to-slate-200/80 text-[11px] font-semibold text-slate-700">
            <tr>
              <th className="w-9 border-r border-[#CBD5E1] px-2.5 py-2 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all downloads"
                  className="h-3.5 w-3.5 cursor-pointer accent-[#1E40AF]"
                />
              </th>
              <th className="border-r border-[#CBD5E1] px-3 py-2">File Name</th>
              <th className="w-24 border-r border-[#CBD5E1] px-3 py-2 text-right">Size</th>
              <th className="w-56 border-r border-[#CBD5E1] px-3 py-2">Status</th>
              <th className="w-24 border-r border-[#CBD5E1] px-3 py-2 text-right">Time Left</th>
              <th className="w-28 border-r border-[#CBD5E1] px-3 py-2 text-right">
                Transfer Rate
              </th>
              <th className="w-36 px-3 py-2">Last Try Date</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#CBD5E1]/70 bg-white">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-20 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#2563EB]">
                      <DownloadCloud className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-700">
                      Your download queue is empty
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Click <strong>Add URL</strong> for direct files (PDF, ZIP, EXE, DMG) or{" "}
                      <strong>Grab Video</strong> to download from YouTube, TikTok, or social media.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    onClick={(e) => handleRowClick(e, item, idx)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selectedIds.has(item.id)) {
                        onChangeSelection(new Set([item.id]));
                      }
                      onRowContextMenu(e, item);
                    }}
                    className={`cursor-default transition-colors ${
                      isSelected
                        ? "bg-blue-100/85 text-slate-950"
                        : idx % 2 === 1
                          ? "bg-slate-50/55 hover:bg-blue-50/55"
                          : "bg-white hover:bg-blue-50/55"
                    }`}
                  >
                    <td
                      className="border-r border-[#CBD5E1]/60 px-2.5 py-2 text-center"
                      onClick={(e) => handleCheckboxClick(e, item, idx)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        aria-label={`Select ${item.fileName}`}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#1E40AF]"
                      />
                    </td>

                    {/* File Name */}
                    <td className="border-r border-[#CBD5E1]/60 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0">{CATEGORY_ICON[item.category]}</span>
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium text-slate-900"
                            title={`${item.fileName}\n${item.url}`}
                          >
                            {item.fileName}
                          </p>
                          {item.errorMessage ? (
                            <span
                              className="block truncate text-[10px] font-medium text-rose-600"
                              title={item.errorMessage}
                            >
                              {item.errorMessage}
                            </span>
                          ) : (
                            item.sourceLabel && (
                              <span className="text-[10px] text-slate-500">{item.sourceLabel}</span>
                            )
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Size */}
                    <td className="border-r border-[#CBD5E1]/60 px-3 py-2 text-right font-mono text-[11px] text-slate-700">
                      {formatBytes(item.sizeBytes)}
                    </td>

                    {/* Status + Glossy Royal Blue Progress Bar */}
                    <td className="border-r border-[#CBD5E1]/60 px-3 py-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`font-semibold ${
                            item.status === "completed"
                              ? "text-emerald-700"
                              : item.status === "downloading"
                                ? "text-[#1E40AF]"
                                : item.status === "paused"
                                  ? "text-amber-700"
                                  : item.status === "error"
                                    ? "text-rose-700"
                                    : "text-slate-500"
                          }`}
                        >
                          {STATUS_TEXT[item.status]}
                        </span>
                        <span className="font-mono text-[10px] font-semibold text-slate-600">
                          {Math.round(item.progress)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-sm border border-[#CBD5E1] bg-slate-100 shadow-inner">
                        <div
                          className={`h-full transition-all duration-200 ${
                            item.status === "completed"
                              ? "bg-gradient-to-b from-emerald-400 to-emerald-600"
                              : item.status === "paused"
                                ? "bg-gradient-to-b from-amber-300 to-amber-500"
                                : item.status === "error"
                                  ? "bg-gradient-to-b from-rose-400 to-rose-600"
                                  : "royal-progress-fill"
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                        />
                      </div>
                    </td>

                    {/* Time Left */}
                    <td className="border-r border-[#CBD5E1]/60 px-3 py-2 text-right font-mono text-[11px] text-slate-700">
                      {item.status === "downloading" ? item.timeLeft : "—"}
                    </td>

                    {/* Transfer Rate */}
                    <td className="border-r border-[#CBD5E1]/60 px-3 py-2 text-right font-mono text-[11px] font-medium text-[#1E40AF]">
                      {item.status === "downloading" ? formatSpeed(item.speedKBps) : "—"}
                    </td>

                    {/* Last Try Date */}
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">
                      {item.lastTryDate}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
};
