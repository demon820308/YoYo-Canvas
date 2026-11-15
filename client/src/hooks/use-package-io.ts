// Project package import/export (extracted from App.tsx in batch
// S4 — a verbatim move, no behavior change): exporting downloads
// the server-built zip through a temporary anchor; importing
// uploads the chosen file, switches to the freshly imported
// project and surfaces the import report. The hidden file input
// itself stays in App's JSX, bound to the returned importInputRef.

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { api } from "../api";

export function usePackageIo({
  projectId,
  showToast,
  switchProject,
}: {
  projectId: string | null;
  showToast: (message: string) => void;
  switchProject: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
const [exporting, setExporting] = useState(false);
const [importing, setImporting] = useState(false);
const [importReport, setImportReport] = useState<{
  name: string;
  nodeCount: number;
  mediaImported: number;
  mediaMissing: { title: string; reason: string }[];
} | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

// ------------------------------------------------- project package I/O
const handleExportPackage = useCallback(async () => {
  if (!projectId || exporting) return;
  setExporting(true);
  try {
    const res = await api.exportProjectPackage({ projectId });
    const a = document.createElement("a");
    a.href = res.url;
    a.download = res.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(
      res.missing.length
        ? `项目包已导出（${res.mediaCount} 个媒体文件）；${res.missing.length} 个节点的媒体字节未找到，已在包内标记缺失`
        : `项目包已导出（含 ${res.mediaCount} 个媒体文件）`,
    );
  } catch {
    showToast("导出失败，请稍后重试");
  } finally {
    setExporting(false);
  }
}, [projectId, exporting, showToast]);

const handleImportPackageFile = useCallback(
  async (file: File | null) => {
    if (!file || importing) return;
    setImporting(true);
    try {
      const { dataBase64 } = await fileToBase64(file);
      const res = await api.importProjectPackage({
        fileName: file.name,
        dataBase64,
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setImportReport({
        name: res.name,
        nodeCount: res.nodeCount,
        mediaImported: res.mediaImported,
        mediaMissing: res.mediaMissing,
      });
      switchProject(res.projectId);
      showToast(
        res.mediaMissing.length
          ? `已导入为新项目「${res.name}」，${res.mediaMissing.length} 个节点的媒体缺失（见下方报告）`
          : `已导入为新项目「${res.name}」`,
      );
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? err.message.slice(0, 120)
          : "导入失败：项目包无法读取",
      );
    } finally {
      setImporting(false);
    }
  },
  [importing, queryClient, showToast, switchProject],
);

  return {
    exporting,
    importing,
    importReport,
    setImportReport,
    importInputRef,
    handleExportPackage,
    handleImportPackageFile,
  };
}
