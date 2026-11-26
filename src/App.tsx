import React, { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APP_SETTINGS,
  addDownload,
  checkSidecars,
  deleteDownload,
  getBridgeStatus,
  getSettings,
  listDownloads,
  openFile,
  openFolder,
  pauseDownload,
  resumeDownload,
  saveSettings,
  stopAllDownloads,
  subscribeBridgeEvents,
  subscribeDownloadEvents,
} from "./api/tauriBridge";
import { AddUrlModal } from "./components/AddUrlModal";
import { CategorySidebar } from "./components/CategorySidebar";
import { ContextMenu } from "./components/ContextMenu";
import { DownloadTable } from "./components/DownloadTable";
import { OptionsModal } from "./components/OptionsModal";
import { StatusBar } from "./components/StatusBar";
import { TopToolbar } from "./components/TopToolbar";
import type {
  AppSettings,
  BridgeStatus,
  DownloadCategory,
  DownloadItem,
  SidebarFilter,
  SidecarStatus,
} from "./types/download";

interface AddModalState {
  mode: "url" | "video";
  initialUrl?: string;
  initialFileName?: string;
  initialSourceLabel?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  item: DownloadItem;
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${file}`;
}

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<SidebarFilter>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [addModal, setAddModal] = useState<AddModalState | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [sidecars, setSidecars] = useState<SidecarStatus | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Hydrate persisted download queue, settings, sidecars & bridge status, and subscribe to Rust events
  useEffect(() => {
    let mounted = true;
    let unlistenDownloads: (() => void) | null = null;
    let unlistenBridge: (() => void) | null = null;

    Promise.all([checkSidecars(), listDownloads(), getBridgeStatus(), getSettings()])
      .then(([sc, items, bStatus, loadedSettings]) => {
        if (!mounted) return;
        setSidecars(sc);
        setSettings(loadedSettings);
        setDownloads(items);
        setBridgeStatus(bStatus);
      })
      .catch(() => {
        // Running outside Tauri desktop runtime
      });

    subscribeDownloadEvents({
      onProgress: (ev) => {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === ev.id
              ? {
                  ...item,
                  downloadedBytes: ev.downloadedBytes,
                  sizeBytes: ev.sizeBytes > 0 ? ev.sizeBytes : item.sizeBytes,
                  progress: ev.progress,
                  speedKBps: ev.speedKbps,
                  timeLeft: ev.timeLeft,
                  status: "downloading",
                }
              : item
          )
        );
      },
      onStatusChanged: (ev) => {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === ev.id
              ? {
                  ...item,
                  status: ev.status,
                  progress: ev.progress,
                  sizeBytes: ev.sizeBytes > 0 ? ev.sizeBytes : item.sizeBytes,
                  downloadedBytes: ev.downloadedBytes,
                  fileName: ev.fileName || item.fileName,
                  lastTryDate: ev.lastTryDate,
                  speedKBps: ev.status === "downloading" ? item.speedKBps : 0,
                  timeLeft: ev.status === "downloading" ? item.timeLeft : "—",
                }
              : item
          )
        );
      },
      onError: (ev) => {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === ev.id
              ? {
                  ...item,
                  status: "error",
                  speedKBps: 0,
                  timeLeft: "—",
                  errorMessage: ev.message,
                }
              : item
          )
        );
        showToast(`Download error: ${ev.message}`);
      },
    }).then((fn) => {
      if (mounted) {
        unlistenDownloads = fn;
      } else {
        fn();
      }
    });

    subscribeBridgeEvents({
      onStatusChanged: (status) => {
        if (!mounted) return;
        setBridgeStatus(status);
      },
      onUrlReceived: (ev) => {
        if (!mounted) return;
        if (ev.autoStarted) {
          listDownloads()
            .then((items) => {
              if (mounted) setDownloads(items);
            })
            .catch(() => {});
          showToast(`Browser download started: ${ev.filename || ev.url}`);
        } else {
          setAddModal({
            mode: ev.isMedia ? "video" : "url",
            initialUrl: ev.url,
            initialFileName: ev.filename || "",
            initialSourceLabel: "Browser Extension",
          });
          showToast("Received URL from Browser Extension.");
        }
      },
    }).then((fn) => {
      if (mounted) {
        unlistenBridge = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      if (unlistenDownloads) unlistenDownloads();
      if (unlistenBridge) unlistenBridge();
    };
  }, []);

  const visibleDownloads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return downloads.filter((item) => {
      if (activeFilter === "unfinished" && item.status === "completed") return false;
      if (activeFilter === "finished" && item.status !== "completed") return false;
      if (
        activeFilter !== "all" &&
        activeFilter !== "unfinished" &&
        activeFilter !== "finished" &&
        item.category !== activeFilter
      ) {
        return false;
      }
      if (q) {
        return (
          item.fileName.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          (item.sourceLabel || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [downloads, activeFilter, searchQuery]);

  const selectedItems = useMemo(
    () => downloads.filter((d) => selectedIds.has(d.id)),
    [downloads, selectedIds]
  );

  const activeDownloads = useMemo(
    () => downloads.filter((d) => d.status === "downloading"),
    [downloads]
  );

  const totalSpeedKBps = useMemo(
    () => activeDownloads.reduce((sum, d) => sum + d.speedKBps, 0),
    [activeDownloads]
  );

  const canResumeSelected = selectedItems.some(
    (d) => d.status === "paused" || d.status === "queued" || d.status === "error"
  );
  const canStopSelected = selectedItems.some((d) => d.status === "downloading");

  const handleResumeIds = async (ids: Set<string>) => {
    for (const id of ids) {
      try {
        const updated = await resumeDownload(id);
        if (updated) {
          setDownloads((prev) => prev.map((d) => (d.id === id ? updated : d)));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleStopIds = async (ids: Set<string>) => {
    for (const id of ids) {
      try {
        await pauseDownload(id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleStopAll = async () => {
    try {
      await stopAllDownloads();
      showToast("Stopped all active downloads.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const idsToDelete = Array.from(selectedIds);
    for (const id of idsToDelete) {
      try {
        await deleteDownload(id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    }
    setDownloads((prev) => prev.filter((d) => !selectedIds.has(d.id)));
    setSelectedIds(new Set());
    showToast(
      `Removed ${idsToDelete.length} ${idsToDelete.length === 1 ? "item" : "items"} from queue.`
    );
  };

  const handleAddDownload = async (payload: {
    url: string;
    fileName: string;
    saveDir: string;
    category: DownloadCategory;
    startNow: boolean;
    formatSelector?: string;
    audioOnly?: boolean;
    sourceLabel?: string;
  }) => {
    const created = await addDownload(payload);
    setDownloads((prev) => [created, ...prev]);
    setSelectedIds(new Set([created.id]));
    setAddModal(null);
    showToast(
      payload.startNow
        ? `Downloading: ${created.fileName}`
        : `Queued: ${created.fileName}`
    );
  };

  const handleOpenFile = async (item: DownloadItem) => {
    try {
      await openFile(joinPath(item.saveDir, item.fileName));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenFolder = async (item: DownloadItem) => {
    try {
      await openFolder(item.saveDir);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyUrl = async (item: DownloadItem) => {
    try {
      await navigator.clipboard.writeText(item.url);
      showToast("URL copied to clipboard.");
    } catch {
      showToast(`URL: ${item.url}`);
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-[#F8FAFC]"
      onContextMenu={(e) => {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
        }
      }}
    >
      <TopToolbar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        hasSelection={selectedIds.size > 0}
        canResumeSelected={canResumeSelected}
        canStopSelected={canStopSelected}
        hasActiveDownloads={activeDownloads.length > 0}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenAddUrl={() => setAddModal({ mode: "url" })}
        onOpenGrabVideo={() => setAddModal({ mode: "video" })}
        onResumeSelected={() => handleResumeIds(selectedIds)}
        onStopSelected={() => handleStopIds(selectedIds)}
        onStopAll={handleStopAll}
        onDeleteSelected={handleDeleteSelected}
        onOpenOptions={() => setShowOptions(true)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CategorySidebar
          collapsed={sidebarCollapsed}
          activeFilter={activeFilter}
          downloads={downloads}
          onSelectFilter={(f) => {
            setActiveFilter(f);
            setContextMenu(null);
          }}
        />

        <DownloadTable
          items={visibleDownloads}
          selectedIds={selectedIds}
          onChangeSelection={setSelectedIds}
          onRowContextMenu={(e, item) =>
            setContextMenu({ x: e.clientX, y: e.clientY, item })
          }
        />
      </div>

      <StatusBar
        activeCount={activeDownloads.length}
        totalCount={downloads.length}
        selectedCount={selectedIds.size}
        totalSpeedKBps={totalSpeedKBps}
        sidecars={sidecars}
        bridgeStatus={bridgeStatus}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          selectedCount={selectedIds.size}
          onClose={() => setContextMenu(null)}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onTogglePauseResume={(item) => {
            if (item.status === "downloading") {
              handleStopIds(new Set([item.id]));
            } else {
              handleResumeIds(new Set([item.id]));
            }
          }}
          onCopyUrl={handleCopyUrl}
          onDelete={handleDeleteSelected}
        />
      )}

      {addModal && (
        <AddUrlModal
          mode={addModal.mode}
          defaultSaveDir={settings.defaultDownloadDir}
          preferredQuality={settings.preferredQuality}
          initialUrl={addModal.initialUrl}
          initialFileName={addModal.initialFileName}
          initialSourceLabel={addModal.initialSourceLabel}
          onClose={() => setAddModal(null)}
          onSubmit={handleAddDownload}
        />
      )}

      {showOptions && (
        <OptionsModal
          settings={settings}
          sidecars={sidecars}
          bridgeStatus={bridgeStatus}
          onSave={async (next) => {
            const saved = await saveSettings(next);
            setSettings(saved);
            showToast("Settings saved.");
          }}
          onSidecarsUpdated={() => {
            checkSidecars()
              .then(setSidecars)
              .catch(() => {});
          }}
          onClose={() => setShowOptions(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-10 right-4 z-50 rounded-lg border border-blue-300 bg-[#1E40AF] px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
};

export default App;
