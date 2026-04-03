// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor, act } from '@/test/component-harness';
import type { HfModelSearchResult } from '@/lib/tauri';

// Hoisted mocks — must be declared via vi.hoisted so the factory can reference them
const { mockSearchHuggingfaceModels, mockAddCustomLocalModel } = vi.hoisted(() => ({
  mockSearchHuggingfaceModels: vi.fn(),
  mockAddCustomLocalModel: vi.fn(),
}));

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri');
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      searchHuggingfaceModels: mockSearchHuggingfaceModels,
      addCustomLocalModel: mockAddCustomLocalModel,
      listLocalModels: vi.fn().mockResolvedValue([]),
      getSystemMemory: vi.fn().mockResolvedValue({ total_bytes: 16_000_000_000, available_bytes: 8_000_000_000 }),
      checkLlamaServerAvailable: vi.fn().mockResolvedValue({ available: false, location: 'not_found', path: null }),
    },
  };
});

// We need to import the component that contains AddCustomModelDialog
// Since AddCustomModelDialog is a private component inside LocalAISettings,
// we test through LocalAISettings or extract the dialog for testing.
// For unit testing the dialog behavior, let's render LocalAISettings and open the dialog.
import { LocalAISettings } from '@/components/settings/LocalAISettings';

const MOCK_SEARCH_RESULTS: HfModelSearchResult[] = [
  {
    repo_id: 'bartowski/google_gemma-4-E4B-it-GGUF',
    model_name: 'google gemma-4-E4B-it',
    author: 'bartowski',
    base_model: 'google/gemma-4-E4B-it',
    license: 'apache-2.0',
    architecture: 'gemma4',
    context_length: 131072,
    total_size: 7518069290,
    downloads: 15000,
    likes: 42,
    tags: ['gguf', 'gemma4'],
    supports_tool_calling: true,
    supports_thinking: true,
    supports_vision: true,
    files: [
      {
        filename: 'google_gemma-4-E4B-it-Q4_K_M.gguf',
        size_bytes: 5_340_000_000,
        download_url: 'https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
      },
      {
        filename: 'google_gemma-4-E4B-it-Q8_0.gguf',
        size_bytes: 9_000_000_000,
        download_url: 'https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q8_0.gguf',
        quantization: 'Q8_0',
      },
    ],
  },
  {
    repo_id: 'ggml-org/gemma-4-26B-A4B-it-GGUF',
    model_name: 'gemma-4-26B-A4B-it',
    author: 'ggml-org',
    base_model: null,
    license: null,
    architecture: null,
    context_length: null,
    total_size: null,
    downloads: 8000,
    likes: 20,
    tags: ['gguf'],
    supports_tool_calling: false,
    supports_thinking: false,
    supports_vision: false,
    files: [
      {
        filename: 'gemma-4-26B-A4B-it-Q4_K_M.gguf',
        size_bytes: 16_800_000_000,
        download_url: 'https://huggingface.co/ggml-org/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
      },
    ],
  },
];

describe('AddModelDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSearchHuggingfaceModels.mockReset();
    mockAddCustomLocalModel.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openDialog() {
    renderWithProviders(<LocalAISettings />);
    const addButton = screen.getByText('Add model');
    await act(async () => {
      fireEvent.click(addButton);
    });
  }

  // -----------------------------------------------------------------------
  // Dialog structure
  // -----------------------------------------------------------------------

  it('opens dialog with Search HF tab active by default', async () => {
    await openDialog();
    expect(screen.getByText('Add Model')).toBeTruthy();
    expect(screen.getByText('Search Hugging Face')).toBeTruthy();
    expect(screen.getByText('Paste URL')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search models/)).toBeTruthy();
  });

  it('switches to URL tab and shows name/url inputs', async () => {
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByText('Paste URL'));
    });
    expect(screen.getByPlaceholderText('e.g. Phi-4 Mini')).toBeTruthy();
    expect(screen.getByPlaceholderText(/huggingface.co/)).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Search tab
  // -----------------------------------------------------------------------

  it('shows hint when query is too short', async () => {
    await openDialog();
    expect(screen.getByText('Type at least 2 characters to search.')).toBeTruthy();
  });

  it('searches HF after debounce when typing >= 2 chars', async () => {
    mockSearchHuggingfaceModels.mockResolvedValue(MOCK_SEARCH_RESULTS);
    await openDialog();

    const input = screen.getByPlaceholderText(/Search models/);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'gemma' } });
    });

    // Advance past debounce timer (400ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(mockSearchHuggingfaceModels).toHaveBeenCalledWith('gemma', 30, undefined);
    });

    // Search results should appear
    await waitFor(() => {
      expect(screen.getByText('google gemma-4-E4B-it')).toBeTruthy();
      expect(screen.getByText('gemma-4-26B-A4B-it')).toBeTruthy();
    });
  });

  it('shows "no results" when search returns empty', async () => {
    mockSearchHuggingfaceModels.mockResolvedValue([]);
    await openDialog();

    const input = screen.getByPlaceholderText(/Search models/);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'nonexistent-model-xyz' } });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(screen.getByText(/No GGUF models found/)).toBeTruthy();
    });
  });

  it('shows file picker when clicking a search result', async () => {
    mockSearchHuggingfaceModels.mockResolvedValue(MOCK_SEARCH_RESULTS);
    await openDialog();

    const input = screen.getByPlaceholderText(/Search models/);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'gemma' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(screen.getByText('google gemma-4-E4B-it')).toBeTruthy();
    });

    // Click the first result to drill into file picker
    await act(async () => {
      fireEvent.click(screen.getByText('google gemma-4-E4B-it'));
    });

    // Should show the back button and file list (quantization as title, filename in detail)
    expect(screen.getByText(/Back/)).toBeTruthy();
    expect(screen.getAllByText(/Q4_K_M/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Q8_0/).length).toBeGreaterThanOrEqual(1);
  });

  it('adds model from search when clicking a file', async () => {
    mockSearchHuggingfaceModels.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockAddCustomLocalModel.mockResolvedValue({
      id: 'google_gemma-4-e4b-it-q4_k_m',
      name: 'google gemma-4-E4B-it',
      filename: 'google_gemma-4-E4B-it-Q4_K_M.gguf',
      downloaded: false,
    });
    await openDialog();

    const input = screen.getByPlaceholderText(/Search models/);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'gemma' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(screen.getByText('google gemma-4-E4B-it')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('google gemma-4-E4B-it'));
    });

    // Click the Q4_K_M variant — find the download icon buttons in the file picker
    const downloadIcons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.includes('Q4_K_M')
    );
    await act(async () => {
      fireEvent.click(downloadIcons[0]);
    });

    await waitFor(() => {
      expect(mockAddCustomLocalModel).toHaveBeenCalledWith(
        'google gemma-4-E4B-it',
        'https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q4_K_M.gguf',
        expect.objectContaining({
          supportsToolCalling: true,
          supportsThinking: true,
          supportsVision: true,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // URL tab
  // -----------------------------------------------------------------------

  it('adds model from URL tab', async () => {
    mockAddCustomLocalModel.mockResolvedValue({
      id: 'custom-model',
      name: 'Custom Model',
      filename: 'custom-model.gguf',
      downloaded: false,
    });
    await openDialog();

    // Switch to URL tab
    await act(async () => {
      fireEvent.click(screen.getByText('Paste URL'));
    });

    const nameInput = screen.getByPlaceholderText('e.g. Phi-4 Mini');
    const urlInput = screen.getByPlaceholderText(/huggingface.co/);

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'My Custom Model' } });
      fireEvent.change(urlInput, { target: { value: 'https://huggingface.co/org/model/resolve/main/model-Q4_K_M.gguf' } });
    });

    // Click the submit button inside the dialog (not the trigger button)
    const submitButton = screen.getAllByText('Add model').find(
      (el) => el.tagName === 'BUTTON' && !el.hasAttribute('data-state'),
    )!;
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(mockAddCustomLocalModel).toHaveBeenCalledWith(
        'My Custom Model',
        'https://huggingface.co/org/model/resolve/main/model-Q4_K_M.gguf',
        undefined,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Search error handling
  // -----------------------------------------------------------------------

  it('shows toast on search failure', async () => {
    mockSearchHuggingfaceModels.mockRejectedValue(new Error('Network error'));
    await openDialog();

    const input = screen.getByPlaceholderText(/Search models/);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'gemma' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(mockSearchHuggingfaceModels).toHaveBeenCalled();
    });
    // After error, results should be empty (no crash)
    await waitFor(() => {
      expect(screen.getByText(/No GGUF models found/)).toBeTruthy();
    });
  });
});
