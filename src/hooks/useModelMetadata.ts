import { useEffect, useRef, useState } from 'react';
import { tauriApi, ModelMetadata } from '@/lib/tauri';

/**
 * Batch-fetches model metadata for all given model IDs when the component mounts.
 * Returns a map of modelId → metadata for instant tooltip display.
 */
export function useModelMetadata(
  models: { id: string }[],
  modelType: 'llm' | 'whisper',
) {
  const [metadataMap, setMetadataMap] = useState<Record<string, ModelMetadata>>({});
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);
  const lastModelTypeRef = useRef(modelType);

  // Reset fetchedRef when modelType changes so we refetch
  if (lastModelTypeRef.current !== modelType) {
    lastModelTypeRef.current = modelType;
    fetchedRef.current = false;
  }

  // Create a stable key from model IDs to detect when models list changes
  const modelsKey = models.map((m) => m.id).sort().join(',');
  const lastModelsKeyRef = useRef(modelsKey);

  // Reset fetchedRef when models list changes so we refetch
  useEffect(() => {
    if (lastModelsKeyRef.current !== modelsKey) {
      lastModelsKeyRef.current = modelsKey;
      fetchedRef.current = false;
    }
  }, [modelsKey]);

  useEffect(() => {
    if (models.length === 0 || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);

    const fetchAll = async () => {
      const results: Record<string, ModelMetadata> = {};
      // Fetch in parallel
      const promises = models.map(async (model) => {
        try {
          const meta = await tauriApi.getModelMetadata(model.id, modelType);
          results[model.id] = meta;
        } catch (e) {
          // Graceful degradation — model just won't have tooltip data
        }
      });
      await Promise.all(promises);
      setMetadataMap(results);
      setLoading(false);
    };

    fetchAll();
  }, [models, modelType]);

  return { metadataMap, loading };
}
