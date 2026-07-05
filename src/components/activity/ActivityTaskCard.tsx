import { TranscriptionCard } from './cards/TranscriptionCard';
import { RecordingCard } from './cards/RecordingCard';
import { AutomationCard } from './cards/AutomationCard';
import { AgentTaskCardInner } from './cards/AgentTaskCard';
import type { ActivityTaskCardProps } from './cards/AgentTaskCard';

export function ActivityTaskCard(props: ActivityTaskCardProps) {
  // Branch by kind. Transcription + recording have their own self-contained
  // cards (each manages its own hooks); the `agent` path below is unchanged.
  if (props.task.kind === 'transcription') {
    return <TranscriptionCard task={props.task} onRemove={props.onRemove} />;
  }
  if (props.task.kind === 'recording') {
    return <RecordingCard task={props.task} />;
  }
  if (props.task.kind === 'automation') {
    return <AutomationCard task={props.task} />;
  }
  return <AgentTaskCardInner {...props} />;
}
