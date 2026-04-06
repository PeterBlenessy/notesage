import { memo, useState, useCallback, useEffect } from 'react';
import type { ImageSegment } from '@/lib/ai/types';

interface ImageSegmentViewProps {
  segment: ImageSegment;
}

export const ImageSegmentView = memo(function ImageSegmentView({ segment }: ImageSegmentViewProps) {
  const [showPreview, setShowPreview] = useState(false);

  const openPreview = useCallback(() => setShowPreview(true), []);
  const closePreview = useCallback(() => setShowPreview(false), []);

  useEffect(() => {
    if (!showPreview) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPreview, closePreview]);

  const src = `data:${segment.mimeType};base64,${segment.data}`;

  return (
    <>
      <img
        src={src}
        alt={segment.alt || 'AI response image'}
        className="max-w-full max-h-[400px] object-contain rounded-md border border-border cursor-pointer transition-opacity hover:opacity-90"
        onClick={openPreview}
      />
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closePreview}
        >
          <img
            src={src}
            alt={segment.alt || 'AI response image'}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});
