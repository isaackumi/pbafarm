// components/Pagination.js
import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  // Generate array of page numbers to display
  const getPageNumbers = () => {
    const pages = []

    // Always include first page
    pages.push(1)

    // Add ellipsis if needed
    if (currentPage > 3) {
      pages.push('...')
    }

    // Add pages around current page
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      if (
        pages[pages.length - 1] !== '...' &&
        pages[pages.length - 1] !== i - 1
      ) {
        pages.push('...')
      }
      pages.push(i)
    }

    // Add ellipsis if needed
    if (currentPage < totalPages - 2) {
      if (pages[pages.length - 1] !== '...') {
        pages.push('...')
      }
    }

    // Always include last page if there's more than one page
    if (totalPages > 1 && !pages.includes(totalPages)) {
      pages.push(totalPages)
    }

    return pages
  }

  // Don't render pagination if there's only one page
  if (totalPages <= 1) {
    return null
  }

  const pageNumbers = getPageNumbers()

  return (
    <nav
      className="relative z-0 inline-flex rounded-lg -space-x-px"
      aria-label="Pagination"
    >
      {/* Previous Page Button */}
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        className={`relative inline-flex items-center justify-center min-h-10 min-w-10 px-2 rounded-l-lg border border-foam-deep bg-surface text-sm font-medium focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake ${
          currentPage === 1
            ? 'text-muted opacity-50 cursor-not-allowed'
            : 'text-muted hover:bg-foam'
        }`}
      >
        <span className="sr-only">Previous</span>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Page Numbers */}
      {pageNumbers.map((page, index) => {
        if (page === '...') {
          return (
            <span
              key={`ellipsis-${index}`}
              className="relative inline-flex items-center min-h-10 px-3 border border-foam-deep bg-surface text-sm font-medium text-muted"
            >
              ...
            </span>
          )
        }

        return (
          <button
            key={page}
            type="button"
        onClick={() => onPageChange(page)}
            className={`relative inline-flex items-center justify-center min-h-10 min-w-10 px-3 border text-sm font-medium tabular-nums focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake ${
              currentPage === page
                ? 'z-10 bg-lake-soft border-lake text-lake'
                : 'bg-surface border-foam-deep text-muted hover:bg-foam'
            }`}
            aria-current={currentPage === page ? 'page' : undefined}
          >
            {page}
          </button>
        )
      })}

      {/* Next Page Button */}
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        className={`relative inline-flex items-center justify-center min-h-10 min-w-10 px-2 rounded-r-lg border border-foam-deep bg-surface text-sm font-medium focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake ${
          currentPage === totalPages
            ? 'text-muted opacity-50 cursor-not-allowed'
            : 'text-muted hover:bg-foam'
        }`}
      >
        <span className="sr-only">Next</span>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </nav>
  )
}

export default Pagination
