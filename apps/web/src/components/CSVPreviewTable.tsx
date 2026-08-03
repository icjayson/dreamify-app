import { useState, useMemo, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Search, SlidersHorizontal, Columns3, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
  PaginationPrevious,
  PaginationNext,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface CSVPreviewTableProps {
  columns: string[];
  rows: string[][];
  filename: string;
  totalRows: number;
  displayedRows: number;
  isLoading?: boolean;
  error?: string | null;
  sourceType?: string;
  /** Client-side pagination: how many rows to show per page (slices loaded `rows`). */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Reduce outer padding — for use inside a panel/frame */
  compact?: boolean;
  /** Hide the filename / row-count / column-count header section */
  hideHeader?: boolean;
  /** Show a subtle spinner in the header while more chunks are being fetched */
  isLoadingMore?: boolean;
  /** Number of rows fetched so far (used in header text when loading more) */
  loadedRows?: number;
}

export default function CSVPreviewTable({
  columns,
  rows,
  filename,
  totalRows,
  displayedRows,
  isLoading = false,
  error = null,
  sourceType,
  pageSize: pageSizeProp,
  onPageSizeChange,
  pageSizeOptions = [100, 1000, 2000],
  compact = false,
  hideHeader = false,
  isLoadingMore = false,
  loadedRows,
}: CSVPreviewTableProps) {
  const normalizeColumnName = (name: string) => name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  const getDateFormatted = (raw: string) => {
    const d = String(raw).trim();
    if (!/^\d{8}$/.test(d)) return raw;
    const parsed = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const toTitleCase = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();

  const effectivePageSize = pageSizeProp ?? 100;
  const [currentPage, setCurrentPage] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [deviceFilters, setDeviceFilters] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<number[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});

  useEffect(() => {
    setCurrentPage(0);
  }, [effectivePageSize, rows, searchTerm, deviceFilters]);

  useEffect(() => {
    setVisibleColumns(columns.map((_, idx) => idx));
  }, [columns]);
  useEffect(() => {
    setColumnWidths({});
  }, [columns]);
  const [sortConfig, setSortConfig] = useState<{
    column: number | null;
    direction: 'asc' | 'desc';
  } | null>(null);
  const isMobile = useIsMobile();
  const normalizedColumns = useMemo(() => columns.map(normalizeColumnName), [columns]);
  const regionColumnIndex = useMemo(
    () => normalizedColumns.findIndex((name) => name.includes('region')),
    [normalizedColumns]
  );
  const sessionSourceColumnIndex = useMemo(
    () => normalizedColumns.findIndex((name) => name.includes('session source') || name === 'source'),
    [normalizedColumns]
  );
  const deviceCategoryColumnIndex = useMemo(
    () => normalizedColumns.findIndex((name) => name.includes('device category') || name === 'device'),
    [normalizedColumns]
  );
  const bounceRateColumnIndex = useMemo(
    () => normalizedColumns.findIndex((name) => name.includes('bounce rate')),
    [normalizedColumns]
  );
  const dateColumnIndexes = useMemo(
    () =>
      normalizedColumns
        .map((name, idx) => ({ name, idx }))
        .filter((entry) => entry.name.includes('date'))
        .map((entry) => entry.idx),
    [normalizedColumns]
  );

  const availableDeviceValues = useMemo(() => {
    if (deviceCategoryColumnIndex < 0) return [];
    const values = new Set<string>();
    rows.forEach((row) => {
      const value = String(row[deviceCategoryColumnIndex] ?? '').trim().toLowerCase();
      if (value) values.add(value);
    });
    return Array.from(values);
  }, [rows, deviceCategoryColumnIndex]);

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (query) {
        const regionValue = regionColumnIndex >= 0 ? String(row[regionColumnIndex] ?? '').toLowerCase() : '';
        const sourceValue = sessionSourceColumnIndex >= 0 ? String(row[sessionSourceColumnIndex] ?? '').toLowerCase() : '';
        if (!regionValue.includes(query) && !sourceValue.includes(query)) return false;
      }
      if (deviceFilters.length > 0 && deviceCategoryColumnIndex >= 0) {
        const deviceValue = String(row[deviceCategoryColumnIndex] ?? '').trim().toLowerCase();
        if (!deviceFilters.includes(deviceValue)) return false;
      }
      return true;
    });
  }, [rows, searchTerm, deviceFilters, regionColumnIndex, sessionSourceColumnIndex, deviceCategoryColumnIndex]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortConfig || sortConfig.column === null) {
      return filteredRows;
    }

    return [...filteredRows].sort((a, b) => {
      const aValue = a[sortConfig.column!] ?? '';
      const bValue = b[sortConfig.column!] ?? '';

      // Try to parse as number
      const aNum = parseFloat(aValue);
      const bNum = parseFloat(bValue);
      const isNumeric = !isNaN(aNum) && !isNaN(bNum) && isFinite(aNum) && isFinite(bNum);

      if (isNumeric) {
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }

      // String comparison (case-insensitive)
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();

      if (aStr < bStr) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aStr > bStr) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [filteredRows, sortConfig]);

  // Paginate sorted rows
  const paginatedRows = useMemo(() => {
    const startIndex = currentPage * effectivePageSize;
    return sortedRows.slice(startIndex, startIndex + effectivePageSize);
  }, [sortedRows, currentPage, effectivePageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / effectivePageSize));

  const handleSort = (columnIndex: number) => {
    setSortConfig((prev) => {
      if (prev?.column === columnIndex) {
        // Toggle direction: asc -> desc -> null
        if (prev.direction === 'asc') {
          return { column: columnIndex, direction: 'desc' };
        } else {
          return null; // Remove sort
        }
      }
      // New column, start with asc
      return { column: columnIndex, direction: 'asc' };
    });
    // Reset to first page when sorting changes
    setCurrentPage(0);
  };

  const getSortIcon = (columnIndex: number) => {
    if (!sortConfig || sortConfig.column !== columnIndex) {
      return <ArrowUpDown className="ml-2 h-3 w-3 opacity-50" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="ml-2 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-2 h-3 w-3" />
    );
  };

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
  };

  const toggleVisibleColumn = (columnIndex: number, checked: boolean) => {
    setVisibleColumns((prev) => {
      if (checked) return [...prev, columnIndex].sort((a, b) => a - b);
      if (prev.length <= 1) return prev;
      return prev.filter((idx) => idx !== columnIndex);
    });
  };

  const toggleDeviceFilter = (value: string, checked: boolean) => {
    setDeviceFilters((prev) => {
      if (checked) return [...prev, value];
      return prev.filter((item) => item !== value);
    });
  };

  const getColumnStyle = useCallback(
    (colIdx: number) => (columnWidths[colIdx] ? { width: `${columnWidths[colIdx]}px`, minWidth: `${columnWidths[colIdx]}px` } : undefined),
    [columnWidths]
  );

  const handleColumnResizeStart = (event: React.MouseEvent<HTMLButtonElement>, colIdx: number) => {
    event.preventDefault();
    event.stopPropagation();
    const th = (event.currentTarget.closest('th') as HTMLTableCellElement | null);
    if (!th) return;

    const startX = event.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const minWidth = 90;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, Math.round(startWidth + delta));
      setColumnWidths((prev) => ({ ...prev, [colIdx]: nextWidth }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const renderCellValue = (value: string, colIdx: number) => {
    const normalized = normalizedColumns[colIdx] ?? '';
    const text = String(value ?? '');

    if (colIdx === bounceRateColumnIndex) {
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed)) return text;
      const percentage = parsed * 100;
      const display = `${percentage.toFixed(1)}%`;
      const clamped = Math.max(0, Math.min(100, percentage));
      return (
        <div className="min-w-[110px]">
          <div className="text-sm">{display}</div>
          <div className="mt-1 h-[3px] w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${clamped}%` }} />
          </div>
        </div>
      );
    }

    if (colIdx === deviceCategoryColumnIndex) {
      const lower = text.trim().toLowerCase();
      if (lower === 'mobile' || lower === 'desktop') {
        const isMobileCategory = lower === 'mobile';
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isMobileCategory ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-800'}`}>
            {toTitleCase(lower)}
          </span>
        );
      }
      return text;
    }

    if (dateColumnIndexes.includes(colIdx) && /^\d{8}$/.test(text.trim())) {
      return getDateFormatted(text);
    }

    const parsedNumeric = Number.parseFloat(text);
    if (!Number.isNaN(parsedNumeric) && Number.isFinite(parsedNumeric) && text.includes('.')) {
      const decimals = text.split('.')[1]?.length ?? 0;
      if (decimals > 2) return parsedNumeric.toFixed(2);
    }

    if (normalized.includes('rows') || normalized.includes('count')) {
      const numericValue = Number.parseInt(text, 10);
      if (!Number.isNaN(numericValue) && Number.isFinite(numericValue)) return numericValue.toLocaleString();
    }

    return text;
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = isMobile ? 3 : 7;

    if (totalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 0; i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (isMobile) {
        // Mobile: show only current page and adjacent pages
        if (currentPage === 0) {
          // At start: show first 2 pages and last page
          pages.push(0);
          pages.push(1);
          pages.push('ellipsis');
          pages.push(totalPages - 1);
        } else if (currentPage === totalPages - 1) {
          // At end: show first page and last 2 pages
          pages.push(0);
          pages.push('ellipsis');
          pages.push(totalPages - 2);
          pages.push(totalPages - 1);
        } else {
          // In middle: show first, current-1, current, current+1, last
          pages.push(0);
          pages.push('ellipsis');
          pages.push(currentPage - 1);
          pages.push(currentPage);
          pages.push(currentPage + 1);
          pages.push('ellipsis');
          pages.push(totalPages - 1);
        }
      } else {
        // Desktop: show more pages
        // Always show first page
        pages.push(0);

        if (currentPage <= 3) {
          // Near the start
          for (let i = 1; i <= 5; i++) {
            pages.push(i);
          }
          pages.push('ellipsis');
          pages.push(totalPages - 1);
        } else if (currentPage >= totalPages - 4) {
          // Near the end
          pages.push('ellipsis');
          for (let i = totalPages - 5; i < totalPages; i++) {
            pages.push(i);
          }
        } else {
          // In the middle
          pages.push('ellipsis');
          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
            pages.push(i);
          }
          pages.push('ellipsis');
          pages.push(totalPages - 1);
        }
      }
    }

    return pages;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <div>
            <h3 className="text-lg font-semibold mb-2">Error loading preview</h3>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const startRow = sortedRows.length === 0 ? 0 : currentPage * effectivePageSize + 1;
  const endRow = Math.min((currentPage + 1) * effectivePageSize, sortedRows.length);

  if (compact) {
    return (
      <div className="w-full flex-1 min-h-0 flex flex-col bg-card">
        {/* Header */}
        {!hideHeader && (
          <div className="border-b bg-muted/50 p-4 flex-shrink-0">
            <h1 className="text-xl font-semibold mb-1">
              {sourceType ? `${sourceType} Data` : filename}
            </h1>
            <div className="flex items-center gap-4 md:text-sm text-xs text-muted-foreground">
              <span>{totalRows.toLocaleString()} total rows</span>
              <span>{columns.length} columns</span>
              {isLoadingMore && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  {loadedRows != null
                    ? `Loading… ${loadedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows`
                    : 'Loading more rows…'}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="border-b bg-background/80 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by region, source…"
                className="h-9 pl-8"
                aria-label="Search by region or session source"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                  Filter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Device category</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableDeviceValues.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No values</div>
                ) : (
                  availableDeviceValues.map((value) => (
                    <DropdownMenuCheckboxItem
                      key={value}
                      checked={deviceFilters.includes(value)}
                      onCheckedChange={(checked) => toggleDeviceFilter(value, Boolean(checked))}
                    >
                      {toTitleCase(value)}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Columns3 className="mr-1.5 h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((col, idx) => (
                  <DropdownMenuCheckboxItem
                    key={idx}
                    checked={visibleColumns.includes(idx)}
                    onCheckedChange={(checked) => toggleVisibleColumn(idx, Boolean(checked))}
                  >
                    {col || `Column ${idx + 1}`}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {(deviceFilters.length > 0 || searchTerm.trim()) && (
            <div className="flex flex-wrap items-center gap-2">
              {deviceFilters.map((filterValue) => (
                <button
                  key={filterValue}
                  type="button"
                  onClick={() => toggleDeviceFilter(filterValue, false)}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800"
                >
                  {toTitleCase(filterValue)}
                  <X className="h-3 w-3" />
                </button>
              ))}
              {searchTerm.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                >
                  Search: {searchTerm}
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable table — thead sticky, only tbody scrolls */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80">
                  #
                </th>
                {visibleColumns.map((idx) => (
                  <th
                    key={idx}
                    onClick={() => handleSort(idx)}
                    style={getColumnStyle(idx)}
                    className="relative px-4 py-3 text-left text-xs font-medium text-muted-foreground bg-muted/80 cursor-pointer hover:bg-muted transition-colors select-none whitespace-normal break-words"
                  >
                    <div className="flex items-center pr-2">
                      {normalizedColumns[idx] === 'bounce rate' ? 'Bounce rate' : (columns[idx] || `Column ${idx + 1}`)}
                      {getSortIcon(idx)}
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnResizeStart(e, idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="group absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none"
                      aria-label={`Resize column ${columns[idx] || idx + 1}`}
                      title="Drag to resize column"
                    >
                      <span className="pointer-events-none absolute inset-y-2 left-1/2 -translate-x-1/2 w-px bg-border/70 group-hover:bg-primary/70 transition-colors" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No data rows found
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2 text-sm text-muted-foreground bg-muted/30 font-mono">
                      {startRow + rowIdx}
                    </td>
                    {visibleColumns.map((colIdx) => (
                      <td key={colIdx} style={getColumnStyle(colIdx)} className="px-4 py-2 text-sm whitespace-nowrap">
                        {renderCellValue(row[colIdx] ?? '', colIdx)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — always pinned at bottom */}
        {sortedRows.length > 0 && (
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t bg-muted/50 px-4 py-3">
            <div className="text-sm text-muted-foreground">
              Showing {startRow.toLocaleString()}-{endRow.toLocaleString()} of {sortedRows.length.toLocaleString()} rows
            </div>
            <Pagination className="w-auto overflow-x-auto">
              <PaginationContent className="justify-end flex-wrap">
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={handlePreviousPage}
                      className={currentPage === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {getPageNumbers().map((page, idx) => {
                    if (page === 'ellipsis') {
                      return (
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      );
                    }
                    return (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={(e) => { e.preventDefault(); handlePageClick(page); }}
                          isActive={currentPage === page}
                          className={`cursor-pointer ${currentPage === page ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  <PaginationItem>
                    <PaginationNext
                      onClick={handleNextPage}
                      className={currentPage >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            {onPageSizeChange && (
              <div className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-sm text-muted-foreground">Rows per page:</span>
                <Select
                  value={String(effectivePageSize)}
                  onValueChange={(v) => onPageSizeChange(Number(v))}
                >
                  <SelectTrigger className="h-9 w-[100px] bg-background" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top" className="z-[200000]">
                    {pageSizeOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n.toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4 md:p-6 lg:p-8">
      <div className="w-full h-full flex flex-col bg-card overflow-hidden max-w-[95vw] lg:max-w-[1400px] max-h-[95vh] border border-border rounded-lg shadow-sm">
        {/* Header — hidden in compact/panel mode */}
        {!hideHeader && (
          <div className="border-b bg-muted/50 p-4 flex-shrink-0">
            <h1 className="text-xl font-semibold mb-1">
              {sourceType ? `${sourceType} Data` : filename}
            </h1>
            <div className="flex items-center gap-4 md:text-sm text-xs text-muted-foreground">
              <span>{totalRows.toLocaleString()} total rows</span>
              {displayedRows < totalRows && (
                <span className="text-amber-600">
                  Showing first {displayedRows.toLocaleString()} rows
                </span>
              )}
              <span>{columns.length} columns</span>
              {isLoadingMore && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  {loadedRows != null
                    ? `Loading… ${loadedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows`
                    : 'Loading more rows…'}
                </span>
              )}
            </div>
          </div>
        )}

      <div className="border-b bg-background/80 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by region, source…"
              className="h-9 pl-8"
              aria-label="Search by region or session source"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Device category</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableDeviceValues.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No values</div>
              ) : (
                availableDeviceValues.map((value) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    checked={deviceFilters.includes(value)}
                    onCheckedChange={(checked) => toggleDeviceFilter(value, Boolean(checked))}
                  >
                    {toTitleCase(value)}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 className="mr-1.5 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col, idx) => (
                <DropdownMenuCheckboxItem
                  key={idx}
                  checked={visibleColumns.includes(idx)}
                  onCheckedChange={(checked) => toggleVisibleColumn(idx, Boolean(checked))}
                >
                  {col || `Column ${idx + 1}`}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {(deviceFilters.length > 0 || searchTerm.trim()) && (
          <div className="flex flex-wrap items-center gap-2">
            {deviceFilters.map((filterValue) => (
              <button
                key={filterValue}
                type="button"
                onClick={() => toggleDeviceFilter(filterValue, false)}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800"
              >
                {toTitleCase(filterValue)}
                <X className="h-3 w-3" />
              </button>
            ))}
            {searchTerm.trim() && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
              >
                Search: {searchTerm}
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-full inline-block">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80">
                  #
                </th>
                {visibleColumns.map((idx) => (
                  <th
                    key={idx}
                    onClick={() => handleSort(idx)}
                    style={getColumnStyle(idx)}
                    className="relative px-4 py-3 text-left text-xs font-medium text-muted-foreground bg-muted/80 cursor-pointer hover:bg-muted transition-colors select-none whitespace-normal break-words"
                  >
                    <div className="flex items-center pr-2">
                      {normalizedColumns[idx] === 'bounce rate' ? 'Bounce rate' : (columns[idx] || `Column ${idx + 1}`)}
                      {getSortIcon(idx)}
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnResizeStart(e, idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="group absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none"
                      aria-label={`Resize column ${columns[idx] || idx + 1}`}
                      title="Drag to resize column"
                    >
                      <span className="pointer-events-none absolute inset-y-2 left-1/2 -translate-x-1/2 w-px bg-border/70 group-hover:bg-primary/70 transition-colors" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No data rows found
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-4 py-2 text-sm text-muted-foreground bg-muted/30 font-mono">
                      {startRow + rowIdx}
                    </td>
                    {visibleColumns.map((colIdx) => (
                      <td
                        key={colIdx}
                        style={getColumnStyle(colIdx)}
                        className="px-4 py-2 text-sm whitespace-nowrap"
                      >
                        {renderCellValue(row[colIdx] ?? '', colIdx)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

        {/* Footer — same pagination layout as before; optional rows-per-page on the right */}
        {sortedRows.length > 0 && (
          <div className="flex flex-shrink-0 flex-col gap-3 border-t bg-muted/50 px-4 py-3">
            <div className="w-full">
              <Pagination className="w-full overflow-x-auto">
                <PaginationContent className="justify-center flex-wrap">
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={handlePreviousPage}
                      className={currentPage === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {getPageNumbers().map((page, idx) => {
                    if (page === 'ellipsis') {
                      return (
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      );
                    }
                    return (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={(e) => {
                            e.preventDefault();
                            handlePageClick(page);
                          }}
                          isActive={currentPage === page}
                          className={`cursor-pointer ${currentPage === page ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  <PaginationItem>
                    <PaginationNext
                      onClick={handleNextPage}
                      className={currentPage >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {startRow.toLocaleString()}-{endRow.toLocaleString()} of {sortedRows.length.toLocaleString()} rows
                {!compact && totalRows > sortedRows.length && (
                  <span className="ml-2 text-amber-600 dark:text-amber-500">
                    ({totalRows.toLocaleString()} total in file)
                  </span>
                )}
              </div>
              {onPageSizeChange && (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="whitespace-nowrap text-sm text-muted-foreground">Rows per page:</span>
                  <Select
                    value={String(effectivePageSize)}
                    onValueChange={(v) => onPageSizeChange(Number(v))}
                  >
                    <SelectTrigger className="h-9 w-[100px] bg-background" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent side="top" className="z-[200000]">
                      {pageSizeOptions.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n.toLocaleString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
