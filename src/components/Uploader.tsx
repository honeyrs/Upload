"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import { getFileIcon } from "@/lib/icons";

interface FileProgress {
  id: string;
  file: File;
  progress: number;
  status: "hashing" | "uploading" | "completed" | "error";
  speed: number;
  eta: number;
  downloadUrl?: string;
  errorMessage?: string;
  startTime: number;
}

async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Uploader() {
  const [uploads, setUploads] = useState<FileProgress[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newUploads = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: "hashing" as const,
      speed: 0,
      eta: 0,
      startTime: Date.now(),
    }));

    setUploads((prev) => [...newUploads, ...prev]);
    newUploads.forEach((upload) => startUpload(upload));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const startUpload = async (upload: FileProgress) => {
    const file = upload.file;
    const CHUNK_SIZE = 4 * 1024 * 1024;

    try {
      const sha256 = await computeSHA256(file);
      setUploads((prev) => prev.map((u) => u.id === upload.id ? { ...u, status: "uploading" } : u));

      const initRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", filename: file.name, size: file.size, sha256 }),
      });

      if (!initRes.ok) throw new Error("Init failed");
      const { actions, uniqueFilename } = await initRes.json();

      if (!actions?.upload) {
        setUploads((prev) => prev.map((u) => u.id === upload.id ? { ...u, status: "completed", progress: 100 } : u));
        return;
      }

      const uploadAction = actions.upload;
      const verifyUrl = actions.verify?.href;
      const completeUrl = uploadAction.href.includes("complete_multipart") ? uploadAction.href : undefined;

      let uploadedBytes = 0;
      const startUploadTime = Date.now();
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);

      for (let i = 1; i <= totalParts; i++) {
        const partKey = i.toString().padStart(5, '0');
        const partUrl = uploadAction.header?.[partKey] || uploadAction.href;
        const partAuth = uploadAction.header?.Authorization; // Standard LFS auth header

        const start = (i - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const partRes = await fetch("/api/upload", {
          method: "PUT",
          headers: {
            "x-upload-url": partUrl,
            "x-upload-auth": partAuth || "",
            "Content-Type": "application/octet-stream"
          },
          body: await chunk.arrayBuffer(),
        });

        if (!partRes.ok) throw new Error(`Part ${i} failed`);

        uploadedBytes = end;
        const elapsed = (Date.now() - startUploadTime) / 1000;
        const speed = uploadedBytes / elapsed;
        const eta = (file.size - uploadedBytes) / speed;

        setUploads((prev) => prev.map((u) => u.id === upload.id ? { ...u, progress: Math.round((uploadedBytes / file.size) * 100), speed, eta } : u));
      }

      if (verifyUrl) {
        const verRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify", verifyUrl, sha256, size: file.size }),
        });
        if (!verRes.ok) throw new Error("Verification failed");
      }

      const commitRes = await fetch("/api/upload", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", filename: file.name, uniqueFilename, sha256, size: file.size, completeUrl }),
      });

      if (!commitRes.ok) throw new Error("Commit failed");
      const { downloadUrl } = await commitRes.json();

      setUploads((prev) => prev.map((u) => u.id === upload.id ? { ...u, status: "completed", downloadUrl, progress: 100 } : u));
    } catch (error: any) {
      setUploads((prev) => prev.map((u) => u.id === upload.id ? { ...u, status: "error", errorMessage: error.message } : u));
    }
  };

  const copyToClipboard = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-8">
      <div {...getRootProps()} className={cn("relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 ease-in-out p-12 flex flex-col items-center justify-center space-y-4", isDragActive ? "border-blue-500 bg-blue-50/50 scale-[0.99]" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50")}>
        <input {...getInputProps()} />
        <div className="w-16 h-16 bg-blue-500 text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300"><Upload className="w-8 h-8" /></div>
        <div className="text-center"><h3 className="text-xl font-semibold text-gray-800">Drop files here</h3><p className="text-gray-500 mt-1">or click to browse from your computer</p></div>
      </div>
      <div className="space-y-4">
        <AnimatePresence initial={false}>
          {uploads.map((upload) => (
            <motion.div key={upload.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">{getFileIcon(upload.file.type)}</div>
                <div className="flex-grow min-w-0">
                  <div className="flex items-center justify-between mb-1"><h4 className="font-medium text-gray-900 truncate pr-4">{upload.file.name}</h4><span className="text-xs font-medium text-gray-400 whitespace-nowrap">{formatBytes(upload.file.size)}</span></div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                    {upload.status === "hashing" && <span className="animate-pulse text-blue-600 font-medium">Computing checksum...</span>}
                    {upload.status === "uploading" && <><span className="flex items-center gap-1">{formatBytes(upload.speed)}/s</span><span>•</span><span>{formatDuration(upload.eta)}</span></>}
                    {upload.status === "completed" && <span className="text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Upload complete</span>}
                    {upload.status === "error" && <span className="text-red-500 font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {upload.errorMessage || "Upload failed"}</span>}
                  </div>
                  <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div className={cn("absolute top-0 left-0 h-full rounded-full transition-colors duration-300", upload.status === "error" ? "bg-red-500" : "bg-blue-500")} initial={{ width: 0 }} animate={{ width: `${upload.progress}%` }} transition={{ duration: 0.5 }} />
                  </div>
                </div>
                {upload.status === "completed" && upload.downloadUrl && (
                  <div className="flex-shrink-0 pl-2">
                    <button onClick={() => copyToClipboard(upload.downloadUrl!, upload.id)} className={cn("p-2.5 rounded-xl transition-all duration-200 flex items-center gap-2", copiedId === upload.id ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
                      {copiedId === upload.id ? <><CheckCircle2 className="w-5 h-5" /><span className="text-sm font-medium">Copied</span></> : <><Copy className="w-5 h-5" /><span className="text-sm font-medium">Copy Link</span></>}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
