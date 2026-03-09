import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RecordingSource } from '@/stores/recording-store';

interface RecordingBarProps {
  elapsedTime: number;
  source: RecordingSource;
  micLevel: number;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const SOURCE_LABELS: Record<RecordingSource, string> = {
  microphone: 'Mic',
  system: 'System',
  both: 'Mic + System',
};

export function RecordingBar({ elapsedTime, source, micLevel, onStop }: RecordingBarProps) {
  // Normalize level for visual display (0 to 1, clamped)
  const normalizedLevel = Math.min(micLevel * 5, 1);

  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 h-9 bg-background/80 backdrop-blur-sm border-b border-border">
      {/* Recording dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>

      {/* Elapsed time */}
      <span className="text-xs font-medium tabular-nums text-foreground">
        {formatTime(elapsedTime)}
      </span>

      {/* Source label */}
      <span className="text-xs text-muted-foreground">
        {SOURCE_LABELS[source]}
      </span>

      {/* Audio level meter */}
      <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-100',
            normalizedLevel > 0.6 ? 'bg-red-500' : 'bg-foreground/50'
          )}
          style={{ width: `${normalizedLevel * 100}%` }}
        />
      </div>

      {/* Spacer */}
      <span className="flex-1" />

      {/* Stop button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onStop}
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Square className="h-3 w-3 mr-1" strokeWidth={0} fill="currentColor" />
        Stop
      </Button>
    </div>
  );
}
