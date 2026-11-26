import React from "react";
import { Activity, Download, Radio, Terminal } from "lucide-react";
import { formatSpeed, type BridgeStatus, type SidecarStatus } from "../types/download";

interface StatusBarProps {
  activeCount: number;
  totalCount: number;
  selectedCount: number;
  totalSpeedKBps: number;
  sidecars: SidecarStatus | null;
  bridgeStatus: BridgeStatus | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activeCount,
  totalCount,
  selectedCount,
  totalSpeedKBps,
  sidecars,
  bridgeStatus,
}) => {
  const sidecarsReady = Boolean(sidecars?.ytDlpReady && sidecars?.ffmpegReady);
  const bridgeOnline = Boolean(bridgeStatus?.online);
  const bridgeAddress = bridgeStatus?.address || "127.0.0.1:17890";

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#CBD5E1] bg-gradient-to-b from-slate-100 to-slate-200/90 px-3 text-[11px] text-slate-700">
      <div className="flex items-center divide-x divide-[#CBD5E1]">
        <span className="flex items-center gap-1.5 pr-3 font-medium">
          <Download className="h-3.5 w-3.5 text-[#1E40AF]" />
          <span>
            Active: <strong className="text-slate-900">{activeCount}</strong> / {totalCount}
          </span>
        </span>

        <span className="flex items-center gap-1.5 px-3 font-mono font-semibold text-[#1E40AF]">
          <Activity className="h-3.5 w-3.5" />
          <span>{formatSpeed(totalSpeedKBps)}</span>
        </span>

        {selectedCount > 0 && (
          <span className="pl-3 text-slate-500">
            {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
          </span>
        )}
      </div>

      <div className="flex items-center divide-x divide-[#CBD5E1]">
        <div
          className="flex items-center gap-1.5 pr-3 font-medium"
          title="Bundled yt-dlp & ffmpeg sidecars"
        >
          <Terminal className="h-3.5 w-3.5 text-slate-500" />
          <span
            className={`h-2 w-2 rounded-full ${sidecarsReady ? "bg-emerald-500" : "bg-amber-400"}`}
          />
          <span className={sidecarsReady ? "text-emerald-800" : "text-slate-600"}>
            {sidecarsReady ? "Media Engine: Ready" : "Sidecars: Check Options"}
          </span>
        </div>

        {/* Localhost Bridge Status Indicator */}
        <div
          className="flex items-center gap-1.5 pl-3 font-medium"
          title={
            bridgeOnline
              ? `Localhost Browser Extension Bridge listening on http://${bridgeAddress}`
              : bridgeStatus?.error || "Browser Extension Bridge is offline"
          }
        >
          <Radio
            className={`h-3.5 w-3.5 ${bridgeOnline ? "text-emerald-600" : "text-slate-400"}`}
          />
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeOnline
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.75)]"
                : "bg-slate-400"
            }`}
          />
          <span className={bridgeOnline ? "text-emerald-800" : "text-slate-600"}>
            {bridgeOnline ? `Bridge: Online (${bridgeAddress})` : "Bridge: Offline"}
          </span>
        </div>
      </div>
    </footer>
  );
};
