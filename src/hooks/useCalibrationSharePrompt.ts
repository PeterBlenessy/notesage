import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useModelFitMeasurementStore } from '@/stores/model-fit-measurement-store';

/** Show the share prompt once the host has measured this many distinct models. */
const SHARE_PROMPT_MODEL_THRESHOLD = 3;

/**
 * Decides when to surface the opt-in calibration share dialog: once the user
 * has real measurements for ≥ N distinct local models, AND they haven't turned
 * the offer off or already been prompted / dismissed. Fires at most once
 * (guarded by the persisted `calibrationSharePromptedAt`). The prompt only ever
 * opens a reviewable submission — it never sends anything.
 */
export function useCalibrationSharePrompt(): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const offer = useSettingsStore((s) => s.offerCalibrationShare);
  const dismissed = useSettingsStore((s) => s.calibrationShareDismissed);
  const promptedAt = useSettingsStore((s) => s.calibrationSharePromptedAt);
  const measurements = useModelFitMeasurementStore((s) => s.measurements);
  const hardwareProfile = useLocalAIStore((s) => s.hardwareProfile);

  useEffect(() => {
    if (!offer || dismissed || promptedAt) return;
    if (!hardwareProfile) return;
    if (Object.keys(measurements).length < SHARE_PROMPT_MODEL_THRESHOLD) return;

    useSettingsStore.getState().markCalibrationSharePrompted();
    setOpen(true);
  }, [offer, dismissed, promptedAt, measurements, hardwareProfile]);

  return { open, setOpen };
}
