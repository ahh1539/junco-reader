import { memo, useEffect, useMemo, useRef, useState } from 'react'
import './ContentsRail.css'

function CollapseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ContentsRail({
  chapters = [],
  chapterIndex = 0,
  narratingChapterIndex = null,
  narratingSectionId = null,
  selectedSectionId = null,
  onChapterSelect,
  onSectionSelect,
  mobileOpen = false,
  onMobileOpenChange,
  desktopOpen = true,
  onDesktopOpenChange,
}) {
  const [expanded, setExpanded] = useState(() => new Set([chapterIndex]))
  const mobileTriggerRef = useRef(null)
  const mobileDrawerRef = useRef(null)
  const mobileCloseRef = useRef(null)

  useEffect(() => {
    setExpanded((prev) => {
      if (prev.has(chapterIndex)) return prev
      const next = new Set(prev)
      next.add(chapterIndex)
      return next
    })
  }, [chapterIndex])

  useEffect(() => {
    if (!mobileOpen) return undefined
    const restoreFocus = mobileTriggerRef.current
    mobileCloseRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onMobileOpenChange?.(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        mobileDrawerRef.current?.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocus?.focus?.()
    }
  }, [mobileOpen, onMobileOpenChange])

  const chapter = chapters[chapterIndex]
  const sections = chapter?.sections || []

  const labeled = useMemo(
    () =>
      chapters.map((item, index) => ({
        ...item,
        index,
        label: item.title,
      })),
    [chapters],
  )

  const toggleExpanded = (index) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const renderList = (idPrefix = 'contents') => (
    <>
      <ol className="jr-contents-list">
        {labeled.map((item) => {
          const isCurrent = item.index === chapterIndex
          const isNarratingChapter = item.index === narratingChapterIndex
          const isOpen = expanded.has(item.index)
          const itemSections = item.sections || []
          return (
            <li
              key={`${idPrefix}-${item.id}`}
              className={`jr-contents-item${isCurrent ? ' is-current' : ''}${isNarratingChapter ? ' is-narrating' : ''}`}
            >
              <div className="jr-contents-row">
                <button
                  type="button"
                  className="jr-contents-chapter"
                  onClick={() => {
                    onChapterSelect?.(item.index)
                    onMobileOpenChange?.(false)
                    setExpanded((prev) => new Set(prev).add(item.index))
                  }}
                >
                  {item.label}
                </button>
                {itemSections.length ? (
                  <button
                    type="button"
                    className="jr-contents-toggle"
                    aria-expanded={isOpen}
                    aria-label={isOpen ? 'Hide sections' : 'Show sections'}
                    onClick={() => toggleExpanded(item.index)}
                  >
                    {isOpen ? '−' : '+'}
                  </button>
                ) : null}
              </div>
              {isOpen && itemSections.length ? (
                <ol className="jr-contents-sections">
                  {itemSections.map((section) => {
                    const isNarrating = isNarratingChapter && narratingSectionId === section.id
                    const isSelected = isCurrent && selectedSectionId === section.id && !isNarrating
                    return (
                    <li key={`${idPrefix}-${section.id}`}>
                      <button
                        type="button"
                        className={`jr-contents-section${isNarrating ? ' is-narrating' : ''}${isSelected ? ' is-selected' : ''}`}
                        style={{ '--jr-section-level': Math.max(0, (section.level || 2) - 1) }}
                        aria-current={isNarrating ? 'true' : undefined}
                        aria-pressed={isSelected ? true : undefined}
                        onClick={() => {
                          onSectionSelect?.(item.index, section)
                          onMobileOpenChange?.(false)
                        }}
                      >
                        <span className="jr-contents-marker" aria-hidden="true" />
                        {section.title}
                      </button>
                    </li>
                    )
                  })}
                </ol>
              ) : null}
            </li>
          )
        })}
      </ol>
      {sections.length ? (
        <p className="jr-contents-hint">{sections.length} sections in this chapter</p>
      ) : null}
    </>
  )

  return (
    <div className={`jr-contents-shell ${desktopOpen ? 'is-open' : 'is-collapsed'}`}>
      <div className="jr-contents-desktop">
        <nav
          className={`jr-contents-panel${desktopOpen ? ' is-open' : ''}`}
          aria-label="Book contents"
          aria-hidden={!desktopOpen}
          inert={!desktopOpen ? true : undefined}
        >
          <div className="jr-contents-head">
            <p className="jr-contents-kicker">Contents</p>
            <button
              type="button"
              className="jr-contents-collapse"
              aria-label="Hide contents"
              onClick={() => onDesktopOpenChange?.(false)}
            >
              <CollapseIcon />
            </button>
          </div>
          {renderList('desktop')}
        </nav>
        <button
          type="button"
          className={`jr-contents-reveal${desktopOpen ? '' : ' is-visible'}`}
          aria-expanded={desktopOpen}
          aria-hidden={desktopOpen}
          tabIndex={desktopOpen ? -1 : 0}
          aria-label="Show contents"
          onClick={() => onDesktopOpenChange?.(true)}
        >
          Contents
        </button>
      </div>

      <div className="jr-contents-mobile">
        <button
          ref={mobileTriggerRef}
          type="button"
          className="jr-contents-mobile-trigger"
          aria-expanded={mobileOpen}
          onClick={() => onMobileOpenChange?.(!mobileOpen)}
        >
          Contents
        </button>
        <button
          type="button"
          className={`jr-contents-backdrop${mobileOpen ? ' is-open' : ''}`}
          aria-label="Close contents"
          tabIndex={-1}
          onClick={() => onMobileOpenChange?.(false)}
        />
        <div
          ref={mobileDrawerRef}
          className={`jr-contents-drawer${mobileOpen ? ' is-open' : ''}`}
          role="dialog"
          aria-modal={mobileOpen ? 'true' : undefined}
          aria-labelledby="jr-contents-drawer-title"
          aria-hidden={!mobileOpen}
          inert={!mobileOpen ? true : undefined}
        >
          <div className="jr-contents-drawer-head">
            <p id="jr-contents-drawer-title" className="jr-contents-kicker">Contents</p>
            <button
              ref={mobileCloseRef}
              type="button"
              className="jr-btn jr-btn-ghost"
              onClick={() => onMobileOpenChange?.(false)}
            >
              Close
            </button>
          </div>
          <nav className="jr-contents" aria-label="Book contents">
            {renderList('mobile')}
          </nav>
        </div>
      </div>
    </div>
  )
}

export default memo(ContentsRail)
