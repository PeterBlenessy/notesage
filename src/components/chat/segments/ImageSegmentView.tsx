import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { ImageSegment } from '@/lib/ai/types';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

interface ImageSegmentViewProps {
  segment: ImageSegment;
}

export const ImageSegmentView = memo(function ImageSegmentView({ segment }: ImageSegmentViewProps) {
  useLocale();
  const [showPreview, setShowPreview] = useState(false);

  const openPreview = useCallback(() => setShowPreview(true), []);
  const closePreview = useCallback(() => setShowPreview(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPreview) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // Move focus into the preview, and hand it back to the thumbnail on close.
    const trigger = triggerRef.current;
    overlayRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [showPreview, closePreview]);

  const src = `data:${segment.mimeType};base64,${segment.data}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPreview}
        className="inline-block max-w-full rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <img
          src={src}
          alt={segment.alt || 'AI response image'}
          className="max-w-full max-h-[400px] object-contain rounded-md border border-border transition-opacity hover:opacity-90"
        />
      </button>
      {showPreview && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={segment.alt || t('editor.aiResponseImage')}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm focus:outline-none"
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
