import { useState, useMemo, useEffect } from 'react';
import { Loader2, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
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
  const effectivePageSize = pageSizeProp ?? 100;
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    setCurrentPage(0);
  }, [effectivePageSize, rows]);
  const [sortConfig, setSortConfig] = useState<{
    column: number | null;
    direction: 'asc' | 'desc';
  } | null>(null);
  const isMobile = useIsMobile();

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortConfig || sortConfig.column === null) {
      return rows;
    }

    return [...rows].sort((a, b) => {
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
  }, [rows, sortConfig]);

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

        {/* Scrollable table — thead sticky, only tbody scrolls */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80">
                  #
                </th>
                {columns.map((col, idx) => (
                  <th
                    key={idx}
                    onClick={() => handleSort(idx)}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80 cursor-pointer hover:bg-muted transition-colors select-none"
                  >
                    <div className="flex items-center">
                      {col || `Column ${idx + 1}`}
                      {getSortIcon(idx)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
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
                    {columns.map((_, colIdx) => (
                      <td key={colIdx} className="px-4 py-2 text-sm whitespace-nowrap">
                        {row[colIdx] ?? ''}
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
          <div className="flex flex-shrink-0 flex-col gap-3 border-t bg-muted/50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-0">
            <div className="w-full text-sm text-muted-foreground text-right lg:w-auto lg:text-left">
              Showing {startRow} to {endRow} of {sortedRows.length} entries
            </div>
            <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-end lg:w-auto lg:flex-row lg:items-center lg:gap-4">
              <Pagination className="w-full overflow-x-auto lg:w-auto">
                <PaginationContent className="justify-center lg:justify-start flex-wrap">
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
                          className="cursor-pointer"
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

      {/* Table Container */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-full inline-block">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80">
                  #
                </th>
                {columns.map((col, idx) => (
                  <th
                    key={idx}
                    onClick={() => handleSort(idx)}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/80 cursor-pointer hover:bg-muted transition-colors select-none"
                  >
                    <div className="flex items-center">
                      {col || `Column ${idx + 1}`}
                      {getSortIcon(idx)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
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
                    {columns.map((_, colIdx) => (
                      <td
                        key={colIdx}
                        className="px-4 py-2 text-sm whitespace-nowrap"
                      >
                        {row[colIdx] ?? ''}
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
          <div className="flex flex-shrink-0 flex-col gap-3 border-t bg-muted/50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-0">
            <div className="w-full text-sm text-muted-foreground text-right lg:w-auto lg:text-left">
              Showing {startRow} to {endRow} of {sortedRows.length} entries
              {!compact && totalRows > sortedRows.length && (
                <span className="ml-2 text-amber-600 dark:text-amber-500">
                  ({totalRows.toLocaleString()} total in file)
                </span>
              )}
            </div>

            <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-end lg:w-auto lg:flex-row lg:items-center lg:gap-4">
              <Pagination className="w-full overflow-x-auto lg:w-auto">
                <PaginationContent className="justify-center lg:justify-start flex-wrap">
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
                          className="cursor-pointer"
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
          </div>
        )}
      </div>
    </div>
  );
}
