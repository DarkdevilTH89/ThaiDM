import React, { useEffect, useRef } from "react";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import type { DownloadItem } from "../types/download";

interface ContextMenuProps {
  x: number;
  y: number;
  item: DownloadItem;
  selectedCount: number;
  onClose: () => void;
  onOpenFile: (item: DownloadItem) => void;
  onOpenFolder: (item: DownloadItem) => void;
  onTogglePauseResume: (item: DownloadItem) => void;
  onCopyUrl: (item: DownloadItem) => void;
  onDelete: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  item,
  selectedCount,
  onClose,
  onOpenFile,
  onOpenFolder,
  onTogglePauseResume,
  onCopyUrl,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Clamp coordinates so menu never overflows right/bottom viewport edges
  const clampedX = Math.min(x, window.innerWidth - 210);
  const clampedY = Math.min(y, window.innerHeight - 210);

  const isDownloading = item.status === "downloading";
  const isCompleted = item.status === "completed";

  return (
    <div
      ref={menuRef}
      style={{ left: `${Math.max(8, clampedX)}px`, top: `${Math.max(8, clampedY)}px` }}
      className="fixed z-50 w-48 overflow-hidden rounded-lg border border-[#CBD5E1] bg-white py-1 text-xs shadow-xl"
      role="menu"
    >
      <button
        type="button"
        onClick={() => {
          onOpenFile(item);
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-slate-700 hover:bg-[#1E40AF] hover:text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onOpenFolder(item);
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-slate-700 hover:bg-[#1E40AF] hover:text-white"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>Open Folder</span>
      </button>

      <div className="my-1 border-t border-[#CBD5E1]" />

      <button
        type="button"
        disabled={isCompleted}
        onClick={() => {
          onTogglePauseResume(item);
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-slate-700 hover:bg-[#1E40AF] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-700"
      >
        {isDownloading ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        <span>{isDownloading ? "Pause" : "Resume"}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onCopyUrl(item);
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-slate-700 hover:bg-[#1E40AF] hover:text-white"
      >
        <Copy className="h-3.5 w-3.5" />
        <span>Copy URL</span>
      </button>

      <div className="my-1 border-t border-[#CBD5E1]" />

      <button
        type="button"
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-rose-700 hover:bg-rose-600 hover:text-white"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>Delete{selectedCount > 1 ? ` (${selectedCount})` : ""}</span>
      </button>
    </div>
  );
};
