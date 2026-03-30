/**
 * Table column type definitions and constants for dynamic table enhancements.
 *
 * Column metadata is stored as attributes on TableHeader nodes in the
 * ProseMirror document model.  Other tasks in this feature consume
 * these types for UI controls, formatting, and aggregation logic.
 */

// ---------------------------------------------------------------------------
// Column type
// ---------------------------------------------------------------------------

export type ColumnType = 'text' | 'number' | 'currency' | 'percentage' | 'date';

export const COLUMN_TYPES: readonly ColumnType[] = [
  'text',
  'number',
  'currency',
  'percentage',
  'date',
] as const;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max';

export const AGGREGATION_TYPES: readonly AggregationType[] = [
  'sum',
  'avg',
  'count',
  'min',
  'max',
] as const;

// ---------------------------------------------------------------------------
// Sort direction (transient — not persisted to markdown)
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Combined metadata interface
// ---------------------------------------------------------------------------

export interface ColumnMetadata {
  colType: ColumnType;
  colCurrency: string | null;
  colAggregation: AggregationType | null;
  colSortDirection: SortDirection | null;
}

// ---------------------------------------------------------------------------
// Currency codes (ISO 4217 — common subset)
// ---------------------------------------------------------------------------

export const CURRENCY_CODES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'SEK',
  'JPY',
  'CNY',
  'KRW',
  'INR',
  'CAD',
  'AUD',
  'CHF',
  'NOK',
  'DKK',
  'PLN',
  'BRL',
  'MXN',
  'ZAR',
  'NZD',
  'SGD',
  'HKD',
  'TWD',
  'THB',
  'TRY',
  'RUB',
  'AED',
  'SAR',
] as const;
