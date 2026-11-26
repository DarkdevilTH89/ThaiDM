import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Film,
  FolderOpen,
  Loader2,
  Radio,
  RefreshCw,
  Settings,
  Sliders,
  X,
  XCircle,
} from "lucide-react";
import { getDiagnostics, pickDownloadFolder, updateYtDlp } from "../api/tauriBridge";
import type {
  AppSettings,
  BridgeStatus,
  DiagnosticsInfo,
  PreferredQuality,
  SidecarStatus,
} from "../types/download";

type SettingsTab = "general" | "media" | "bridge";

interface OptionsModalProps {
  settings: AppSettings;
  sidecars: SidecarStatus | null;
  bridgeStatus: BridgeStatus | null;
  onSave: (next: AppSettings) => Promise<void>;
  onSidecarsUpdated?: () => void;
  onClose: () => void;
}

const QUALITY_OPTIONS: Array<{ value: PreferredQuality; label: string; desc: string }> = [
  { value: "best_mp4", label: "Best MP4", desc: "Highest available video + audio merged to MP4" },
  { value: "1080p", label: "1080p Full HD", desc: "Cap video resolution at 1080p MP4" },
  { value: "720p", label: "720p HD", desc: "Faster downloads and smaller files at 720p MP4" },
  { value: "audio_mp3", label: "Audio MP3", desc: "Extract audio only and convert to 192kbps MP3" },
];

export const OptionsModal: React.FC<OptionsModalProps> = ({
  settings,
  sidecars,
  bridgeStatus,
  onSave,
  onSidecarsUpdated,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [updatingYtDlp, setUpdatingYtDlp] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const info = await getDiagnostics();
      setDiagnostics(info);
    } catch {
      // Ignore outside Tauri runtime
    } finally {
      setLoadingDiag(false);
    }
  };

  useEffect(() => {
    if (activeTab === "bridge" && !diagnostics && !loadingDiag) {
      loadDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleBrowse = async () => {
    const picked = await pickDownloadFolder();
    if (picked) {
      setDraft((prev) => ({ ...prev, defaultDownloadDir: picked }));
    }
  };

  const handleUpdateYtDlp = async () => {
    setUpdatingYtDlp(true);
    setUpdateMsg(null);
    try {
      const res = await updateYtDlp();
      setUpdateMsg({ ok: true, text: res.message });
      await loadDiagnostics();
      onSidecarsUpdated?.();
    } catch (err) {
      setUpdateMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUpdatingYtDlp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const clean: AppSettings = {
        ...draft,
        defaultDownloadDir: draft.defaultDownloadDir.trim() || settings.defaultDownloadDir,
        maxConcurrent: Math.max(1, Math.min(8, Number(draft.maxConcurrent) || 3)),
        bridgePort: Math.max(1024, Math.min(65535, Number(draft.bridgePort) || 17890)),
      };
      await onSave(clean);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const liveBridge = diagnostics?.bridge ?? bridgeStatus;
  const bridgeOnline = Boolean(liveBridge?.online);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-2xl">
        {/* Glossy Royal Blue Header */}
        <div className="royal-gloss-bar flex items-center justify-between px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-blue-100" />
            <h2 className="text-sm font-bold">Options &amp; Settings — ไทยDM</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-blue-100 hover:bg-white/15 hover:text-white"
            aria-label="Close options"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-[#CBD5E1] bg-slate-100/90 px-4 pt-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`inline-flex items-center gap-1.5 rounded-t-md border-x border-t px-3.5 py-2 transition-colors ${
              activeTab === "general"
                ? "-mb-px border-[#CBD5E1] bg-white text-[#1E40AF]"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>General</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("media")}
            className={`inline-flex items-center gap-1.5 rounded-t-md border-x border-t px-3.5 py-2 transition-colors ${
              activeTab === "media"
                ? "-mb-px border-[#CBD5E1] bg-white text-[#1E40AF]"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Media (yt-dlp)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bridge")}
            className={`inline-flex items-center gap-1.5 rounded-t-md border-x border-t px-3.5 py-2 transition-colors ${
              activeTab === "bridge"
                ? "-mb-px border-[#CBD5E1] bg-white text-[#1E40AF]"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>Bridge &amp; Diagnostics</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          {/* GENERAL TAB */}
          {activeTab === "general" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Default Download Folder
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.defaultDownloadDir}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, defaultDownloadDir: e.target.value }))
                    }
                    className="flex-1 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 font-mono text-xs focus:border-[#2563EB] focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#1E40AF]" />
                    <span>Browse…</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3.5 py-2.5">
                <div>
                  <p className="font-semibold text-slate-800">Max Concurrent Downloads</p>
                  <p className="text-[11px] text-slate-500">
                    Number of simultaneous active transfers (1–8, default 3)
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={draft.maxConcurrent}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, maxConcurrent: Number(e.target.value) }))
                    }
                    className="w-24 accent-[#2563EB]"
                  />
                  <span className="w-7 rounded border border-[#CBD5E1] bg-white py-0.5 text-center font-mono font-bold text-[#1E40AF]">
                    {draft.maxConcurrent}
                  </span>
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-800">
                    Auto-start downloads sent from browser extension
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Start downloading immediately instead of opening the Add URL confirmation dialog
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.autoStartBridgeDownloads}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      autoStartBridgeDownloads: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-800">Minimize to System Tray on close</p>
                  <p className="text-[11px] text-slate-500">
                    Keep ไทยDM and the 127.0.0.1 browser bridge running quietly in the system tray
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.minimizeToTrayOnClose}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      minimizeToTrayOnClose: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>
            </div>
          )}

          {/* MEDIA (YT-DLP) TAB */}
          {activeTab === "media" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block font-semibold text-slate-700">
                  Default Preferred Quality
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_OPTIONS.map((opt) => {
                    const selected = draft.preferredQuality === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, preferredQuality: opt.value }))
                        }
                        className={`rounded-lg border p-2.5 text-left transition-colors ${
                          selected
                            ? "border-[#2563EB] bg-blue-50/80 ring-1 ring-[#2563EB]"
                            : "border-[#CBD5E1] bg-white hover:bg-slate-50"
                        }`}
                      >
                        <p
                          className={`text-xs font-bold ${
                            selected ? "text-[#1E40AF]" : "text-slate-800"
                          }`}
                        >
                          {opt.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-800">Embed Thumbnail</p>
                  <p className="text-[11px] text-slate-500">
                    Attach video/album cover art into downloaded MP4/MP3 files via FFmpeg
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.embedThumbnail}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, embedThumbnail: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-800">Embed Metadata</p>
                  <p className="text-[11px] text-slate-500">
                    Write title, uploader, and upload date tags into downloaded media files
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.embedMetadata}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, embedMetadata: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </label>
            </div>
          )}

          {/* BRIDGE & DIAGNOSTICS TAB */}
          {activeTab === "bridge" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3.5 py-2.5">
                <div>
                  <p className="font-semibold text-slate-800">Localhost Bridge Port</p>
                  <p className="text-[11px] text-slate-500">
                    Loopback-only (`127.0.0.1`). Restart ไทยDM after changing the port.
                  </p>
                </div>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={draft.bridgePort}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, bridgePort: Number(e.target.value) }))
                  }
                  className="w-24 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="space-y-2.5 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#1E40AF]">
                    Live Bridge &amp; Sidecar Diagnostics
                  </p>
                  <button
                    type="button"
                    disabled={loadingDiag}
                    onClick={loadDiagnostics}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E40AF] hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingDiag ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">Localhost HTTP Bridge</span>
                  <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        bridgeOnline ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                    />
                    <span className={bridgeOnline ? "text-emerald-700" : "text-slate-600"}>
                      {bridgeOnline
                        ? `Online (${liveBridge?.address || "127.0.0.1:17890"})`
                        : "Offline"}
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-700">yt-dlp (Video Grabber)</span>
                    {diagnostics?.usingUpdatedYtDlp && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-[#1E40AF]">
                        AppData Updated
                      </span>
                    )}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] font-semibold">
                    {diagnostics?.ytDlpVersion || sidecars?.ytDlpReady ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700">
                          {diagnostics?.ytDlpVersion || "Ready"}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-amber-700">Not detected</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-700">FFmpeg (MP4/MP3 Muxing)</span>
                  <span className="inline-flex max-w-[60%] items-center gap-1 truncate font-mono text-[11px] font-semibold">
                    {diagnostics?.ffmpegVersion || sidecars?.ffmpegReady ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="truncate text-emerald-700" title={diagnostics?.ffmpegVersion || ""}>
                          {diagnostics?.ffmpegVersion
                            ? diagnostics.ffmpegVersion.split(" Copyright")[0]
                            : "Ready"}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span className="text-amber-700">Not detected</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-[#CBD5E1] pt-2.5">
                  <p className="text-[11px] text-slate-500">
                    Keep YouTube &amp; social grabbing working with the latest yt-dlp release.
                  </p>
                  <button
                    type="button"
                    disabled={updatingYtDlp}
                    onClick={handleUpdateYtDlp}
                    className="royal-gloss-active inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                  >
                    {updatingYtDlp ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span>{updatingYtDlp ? "Updating yt-dlp..." : "Check / Update yt-dlp"}</span>
                  </button>
                </div>

                {updateMsg && (
                  <div
                    className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${
                      updateMsg.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {updateMsg.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {saveError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {saveError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-[#CBD5E1] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="royal-gloss-active rounded-md px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
