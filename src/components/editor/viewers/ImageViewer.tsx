import { convertFileSrc } from "@tauri-apps/api/core";

interface ImageViewerProps {
  filePath: string;
}

export function ImageViewer({ filePath }: ImageViewerProps) {
  const src = convertFileSrc(filePath);

  return (
    <div className="h-full flex items-center justify-center p-8 overflow-auto">
      <img
        src={src}
        alt={filePath.split("/").pop() ?? ""}
        className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
      />
    </div>
  );
}
