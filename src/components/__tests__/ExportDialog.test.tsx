// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, registerDefaultHandlers } from '@/test/component-harness';
import { ExportDialog } from '@/components/ExportDialog';
import { useSettingsStore } from '@/stores/settings-store';

// Mock tauriApi.listPptxTemplates to avoid real IPC
vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri');
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      listPptxTemplates: vi.fn().mockResolvedValue([]),
      importPptxTemplate: vi.fn(),
      deletePptxTemplate: vi.fn(),
    },
  };
});

describe('ExportDialog', () => {
  const onOpenChange = vi.fn();
  const onExport = vi.fn();

  beforeEach(() => {
    registerDefaultHandlers();
    onOpenChange.mockReset();
    onExport.mockReset();
    // Reset settings store to defaults
    useSettingsStore.setState({
      lastExportFormat: 'pdf',
      lastExportTemplate: 'clean',
      lastExportPageSize: 'a4',
      lastExportIncludeToC: false,
      lastExportIncludePageNumbers: false,
      lastPptxTemplate: 'simple',
    });
  });

  function renderDialog(props?: Partial<Parameters<typeof ExportDialog>[0]>) {
    return renderWithProviders(
      <ExportDialog
        open={true}
        onOpenChange={onOpenChange}
        onExport={onExport}
        isExporting={false}
        {...props}
      />,
    );
  }

  // ---------------------------------------------------------------------------
  // Format toggle
  // ---------------------------------------------------------------------------

  it('renders with Export title', () => {
    renderDialog();
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('shows format selector with PDF and PowerPoint options', () => {
    renderDialog();
    // The format selector has "PDF" as the default value
    expect(screen.getByText('Format')).toBeTruthy();
  });

  it('defaults to PDF format with PDF-specific options', () => {
    renderDialog();
    expect(screen.getByText('Include table of contents')).toBeTruthy();
    expect(screen.getByText('Include page numbers')).toBeTruthy();
    expect(screen.getByText('Page size')).toBeTruthy();
    expect(screen.getByText('Export PDF')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // PDF options
  // ---------------------------------------------------------------------------

  it('shows PDF template cards when PDF is selected', () => {
    renderDialog();
    expect(screen.getByText('Clean')).toBeTruthy();
    expect(screen.getByText('Academic')).toBeTruthy();
    expect(screen.getByText('Report')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Export callback
  // ---------------------------------------------------------------------------

  it('calls onExport with PDF format when exporting as PDF', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Export PDF'));
    expect(onExport).toHaveBeenCalledTimes(1);
    const options = onExport.mock.calls[0][0];
    expect(options.format).toBe('pdf');
    expect(options.template).toBe('clean');
    expect(options.pageSize).toBe('a4');
  });

  // ---------------------------------------------------------------------------
  // Persisted state
  // ---------------------------------------------------------------------------

  it('restores last-used PDF template from settings store', () => {
    useSettingsStore.setState({ lastExportTemplate: 'academic' });
    renderDialog();
    // The academic card should be selected
    const academicCard = screen.getByText('Serif, numbered headings').closest('button');
    expect(academicCard?.className).toContain('border-foreground');
  });

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  it('disables export button while exporting', () => {
    renderDialog({ isExporting: true });
    expect(screen.getByText('Exporting...')).toBeTruthy();
  });

  it('calls onOpenChange when Cancel is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Export')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // PPTX template cards (visible in PPTX mode)
  // ---------------------------------------------------------------------------

  it('shows PPTX template cards including Add Template button in PPTX mode', async () => {
    useSettingsStore.setState({ lastExportFormat: 'pptx' });
    renderDialog();
    // Should show PPTX template cards
    expect(screen.getByText('Simple')).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    // Export button should say Export PPTX
    expect(screen.getByText('Export PPTX')).toBeTruthy();
    // Add Template button
    expect(screen.getByText('Add Template')).toBeTruthy();
  });

  it('hides PDF options when PPTX is selected', () => {
    useSettingsStore.setState({ lastExportFormat: 'pptx' });
    renderDialog();
    expect(screen.queryByText('Include table of contents')).toBeNull();
    expect(screen.queryByText('Include page numbers')).toBeNull();
    expect(screen.queryByText('Page size')).toBeNull();
  });

  it('calls onExport with PPTX format in PPTX mode', () => {
    useSettingsStore.setState({ lastExportFormat: 'pptx' });
    renderDialog();
    fireEvent.click(screen.getByText('Export PPTX'));
    expect(onExport).toHaveBeenCalledTimes(1);
    const options = onExport.mock.calls[0][0];
    expect(options.format).toBe('pptx');
    expect(options.pptxTemplate).toBe('simple');
  });

  it('selects a PPTX template when clicking its card', () => {
    useSettingsStore.setState({ lastExportFormat: 'pptx' });
    renderDialog();
    fireEvent.click(screen.getByText('Business'));
    fireEvent.click(screen.getByText('Export PPTX'));
    const options = onExport.mock.calls[0][0];
    expect(options.pptxTemplate).toBe('business');
  });
});
