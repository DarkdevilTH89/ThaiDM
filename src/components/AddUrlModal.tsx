import React, { useEffect, useState } from "react";
import { Film, FolderOpen, Link2, Loader2, RefreshCw, Video, X } from "lucide-react";
import { pickDownloadFolder, probeMedia } from "../api/tauriBridge";
import {
  CATEGORY_LABELS,
  formatDuration,
  inferCategoryFromUrl,
  inferFileNameFromUrl,
  isMediaSiteUrl,
  type DownloadCategory,
  type MediaFormatOption,
  type MediaProbeResult,
  type PreferredQuality,
} from "../types/download";

interface AddUrlModalProps {
  mode: "url" | "video";
  defaultSaveDir: string;
  preferredQuality?: PreferredQuality;
  initialUrl?: string;
  initialFileName?: string;
  initialSourceLabel?: string;
  onClose: () => void;
  onSubmit: (payload: {
    url: string;
    fileName: string;
    saveDir: string;
    category: DownloadCategory;
    startNow: boolean;
    formatSelector?: string;
    audioOnly?: boolean;
    sourceLabel?: string;
  }) => Promise<void>;
}

export const AddUrlModal: React.FC<AddUrlModalProps> = ({
  mode,
  defaultSaveDir,
  preferredQuality = "best_mp4",
  initialUrl = "",
  initialFileName = "",
  initialSourceLabel,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [customFileName, setCustomFileName] = useState(initialFileName);
  const [saveDir, setSaveDir] = useState(defaultSaveDir);
  const [category, setCategory] = useState<DownloadCategory>(() => {
    if (mode === "video") return "video";
    if (initialUrl) return inferCategoryFromUrl(initialUrl, initialFileName);
    return "documents";
  });
  const [categoryTouched, setCategoryTouched] = useState(mode === "video");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<MediaProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>("best-mp4");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      setCustomFileName(initialFileName);
      setCategory(
        mode === "video" ? "video" : inferCategoryFromUrl(initialUrl, initialFileName)
      );
    }
  }, [initialUrl, initialFileName, mode]);

  const pickPreferredFormat = (formats: MediaFormatOption[]): MediaFormatOption | undefined => {
    const desiredId =
      preferredQuality === "1080p"
        ? "mp4-1080p"
        : preferredQuality === "720p"
          ? "mp4-720p"
          : preferredQuality === "audio_mp3"
            ? "audio-mp3"
            : "best-mp4";
    return formats.find((f) => f.id === desiredId) ?? formats[0];
  };

  const runProbe = async (targetUrl: string) => {
    setProbing(true);
    setProbeError(null);
    try {
      const res = await probeMedia(targetUrl);
      setProbeResult(res);
      const chosen = pickPreferredFormat(res.formats);
      if (chosen) {
        setSelectedFormatId(chosen.id);
      }
      if (!customFileName.trim() && res.title) {
        const ext = chosen?.ext || "mp4";
        setCustomFileName(`${res.title}.${ext}`);
      }
      setCategory(chosen?.audioOnly ? "music" : "video");
    } catch (err) {
      setProbeResult(null);
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  };

  // Auto-probe YouTube / Social URLs after user finishes pasting or typing
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed) || !isMediaSiteUrl(trimmed)) {
      setProbeResult(null);
      setProbeError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      runProbe(trimmed);
    }, 450);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    setError(null);
    if (!categoryTouched && nextUrl.trim().length > 6) {
      setCategory(inferCategoryFromUrl(nextUrl, customFileName));
    }
  };

  const selectedFormat: MediaFormatOption | undefined = probeResult?.formats.find(
    (f) => f.id === selectedFormatId
  );

  const handleSelectFormat = (fmtId: string) => {
    setSelectedFormatId(fmtId);
    const fmt = probeResult?.formats.find((f) => f.id === fmtId);
    if (fmt && probeResult) {
      setCategory(fmt.audioOnly ? "music" : "video");
      const base = (customFileName.trim() || probeResult.title).replace(/\.(mp4|mp3|mkv|webm)$/i, "");
      setCustomFileName(`${base}.${fmt.ext}`);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const picked = await pickDownloadFolder();
      if (picked) setSaveDir(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAction = async (startNow: boolean) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a valid http(s) URL.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const finalName = customFileName.trim() || inferFileNameFromUrl(trimmed);
      await onSubmit({
        url: trimmed,
        fileName: finalName,
        saveDir: saveDir.trim() || defaultSaveDir,
        category,
        startNow,
        formatSelector: selectedFormat?.formatSelector,
        audioOnly: selectedFormat?.audioOnly,
        sourceLabel: probeResult?.extractor
          ? `${probeResult.extractor}${selectedFormat ? ` · ${selectedFormat.label}` : ""}`
          : initialSourceLabel
            ? initialSourceLabel
            : isMediaSiteUrl(trimmed)
              ? "Video Link"
              : "Direct HTTPS",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-2xl">
        {/* Glossy Royal Blue Dialog Header */}
        <div className="royal-gloss-bar flex items-center justify-between px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            {mode === "video" ? (
              <Video className="h-4 w-4 text-amber-300" />
            ) : (
              <Link2 className="h-4 w-4 text-blue-200" />
            )}
            <h2 className="text-sm font-bold">
              {mode === "video"
                ? "Grab Video (YouTube / Social) — ไทยDM"
                : "Add New Download URL — ไทยDM"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-blue-100 hover:bg-white/15 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAction(true);
          }}
          className="space-y-4 p-5 text-xs"
        >
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-semibold text-slate-700">
                {mode === "video" ? "Video Page URL (YouTube, TikTok, Social)" : "Download URL"}
              </label>
              {isMediaSiteUrl(url.trim()) && (
                <button
                  type="button"
                  disabled={probing}
                  onClick={() => runProbe(url.trim())}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E40AF] hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${probing ? "animate-spin" : ""}`} />
                  <span>{probing ? "Probing media..." : "Probe Formats"}</span>
                </button>
              )}
            </div>
            <input
              type="url"
              autoFocus
              required
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder={
                mode === "video"
                  ? "https://www.youtube.com/watch?v=..."
                  : "https://example.com/files/archive.zip"
              }
              className="w-full rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Media Probe Loading / Preview Card */}
          {probing && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5 text-xs text-[#1E40AF]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Fetching video title, thumbnail, and available formats via yt-dlp...</span>
            </div>
          )}

          {probeError && !probing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <strong>Media Probe Notice:</strong> {probeError}
            </div>
          )}

          {probeResult && !probing && (
            <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              {probeResult.thumbnail ? (
                <img
                  src={probeResult.thumbnail}
                  alt={probeResult.title}
                  className="h-20 w-32 shrink-0 rounded-md border border-[#CBD5E1] object-cover"
                />
              ) : (
                <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-md border border-[#CBD5E1] bg-slate-200 text-slate-400">
                  <Film className="h-6 w-6" />
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="line-clamp-2 text-xs font-bold text-slate-900" title={probeResult.title}>
                  {probeResult.title}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  {probeResult.uploader && <span>{probeResult.uploader}</span>}
                  {probeResult.durationSeconds ? (
                    <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                      {formatDuration(probeResult.durationSeconds)}
                    </span>
                  ) : null}
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] font-bold uppercase text-[#1E40AF]">
                    Select Quality / Format
                  </label>
                  <select
                    value={selectedFormatId}
                    onChange={(e) => handleSelectFormat(e.target.value)}
                    className="w-full rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:border-[#2563EB] focus:outline-none"
                  >
                    {probeResult.formats.map((fmt) => (
                      <option key={fmt.id} value={fmt.id}>
                        {fmt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">
                Custom File Name (Optional)
              </label>
              <input
                type="text"
                value={customFileName}
                onChange={(e) => setCustomFileName(e.target.value)}
                placeholder="Auto-detected from URL"
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700">Category</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as DownloadCategory);
                  setCategoryTouched(true);
                }}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-medium text-slate-800 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {(Object.keys(CATEGORY_LABELS) as DownloadCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700">Save To Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="flex-1 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 font-mono text-xs text-slate-800 focus:border-[#2563EB] focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#1E40AF]" />
                <span>Browse…</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[#CBD5E1] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleAction(false)}
              className="rounded-md border border-blue-300 bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-[#1E40AF] hover:bg-blue-100 disabled:opacity-50"
            >
              Download Later
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="royal-gloss-active rounded-md px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {submitting ? "Starting..." : "Start Download"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
