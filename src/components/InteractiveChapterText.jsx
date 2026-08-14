import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { buildChapterUnits } from '../lib/paginateChapter'
import SpeechOptimizeToggle from './SpeechOptimizeToggle'
import './BookSpread.css'

const ChapterColumn = memo(function ChapterColumn({
  chapterId,
  units,
  onSectionActivate,
  onChunkActivate,
  registerChunkEl,
}) {
  return (
    <div key={chapterId} className="jr-book-column">
      {units.map((unit) => {
        if (unit.type === 'heading') {
          return (
            <button
              key={unit.id}
              type="button"
              className={`jr-book-heading is-h${unit.level || 2}`}
              onClick={() => onSectionActivate(unit.sectionId || unit.id)}
            >
              {unit.title}
            </button>
          )
        }

        return (
          <span
            key={unit.id}
            role="button"
            tabIndex={0}
            aria-label={`Read from ${unit.text.slice(0, 80)}`}
            data-chunk={unit.globalIndex}
            className="jr-book-chunk"
            ref={(element) => registerChunkEl(unit.globalIndex, element)}
            onClick={() => onChunkActivate(unit.globalIndex, true)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onChunkActivate(unit.globalIndex, false)
            }}
          >
            {unit.text}{' '}
          </span>
        )
      })}
    </div>
  )
})

function updateNarrationHighlight(element, { active, past }) {
  if (!element) return
  element.classList.toggle('is-active', active)
  element.classList.toggle('is-past', past)
}

export default function InteractiveChapterText({
  chapter,
  chapterChunks = [],
  activeChunkIndex = -1,
  selectedChunkIndex = -1,
  onSectionSelect,
  onChunkSeek,
  optimizeForSpeech = true,
  onOptimizeForSpeechChange,
  speechToggleLocked = false,
  variant = 'room',
}) {
  const scrollerRef = useRef(null)
  const chapterIdRef = useRef(null)
  const chunkElsRef = useRef(new Map())
  const activeIndexRef = useRef(-1)
  const scrollRafRef = useRef(0)
  const onSectionSelectRef = useRef(onSectionSelect)
  const onChunkSeekRef = useRef(onChunkSeek)
  onSectionSelectRef.current = onSectionSelect
  onChunkSeekRef.current = onChunkSeek

  const units = useMemo(() => buildChapterUnits(chapter, chapterChunks), [chapter, chapterChunks])

  const registerChunkEl = useCallback((index, element) => {
    const map = chunkElsRef.current
    if (element) map.set(index, element)
    else map.delete(index)
  }, [])

  const handleSectionActivate = useCallback(
    (sectionId) => {
      const section = chapter?.sections?.find((item) => item.id === sectionId)
      if (section) onSectionSelectRef.current?.(section)
    },
    [chapter],
  )

  const handleChunkActivate = useCallback((index, respectTextSelection) => {
    if (respectTextSelection) {
      const selection = window.getSelection?.()
      if (selection && !selection.isCollapsed) return
    }
    onChunkSeekRef.current?.(index)
  }, [])

  useLayoutEffect(() => {
    const map = chunkElsRef.current
    const previous = activeIndexRef.current
    const next = activeChunkIndex
    const adjacent =
      previous >= 0 &&
      next >= 0 &&
      Math.abs(next - previous) === 1 &&
      map.has(previous) &&
      map.has(next)

    if (next < 0) {
      for (const element of map.values()) element.classList.remove('is-active', 'is-past')
    } else if (adjacent && next === previous + 1) {
      updateNarrationHighlight(map.get(previous), { active: false, past: true })
      updateNarrationHighlight(map.get(next), { active: true, past: false })
    } else if (adjacent && next === previous - 1) {
      updateNarrationHighlight(map.get(previous), { active: false, past: false })
      updateNarrationHighlight(map.get(next), { active: true, past: false })
    } else {
      for (const [index, element] of map) {
        updateNarrationHighlight(element, { active: index === next, past: index < next })
      }
    }

    activeIndexRef.current = next
  }, [activeChunkIndex, units])

  useLayoutEffect(() => {
    for (const [index, element] of chunkElsRef.current) {
      element.classList.toggle('is-selected', selectedChunkIndex >= 0 && index === selectedChunkIndex)
    }
  }, [selectedChunkIndex, units])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined

    const chapterChanged = chapterIdRef.current !== chapter?.id
    chapterIdRef.current = chapter?.id

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = 0
    }

    const focusChunkIndex = selectedChunkIndex >= 0 ? selectedChunkIndex : activeChunkIndex
    if (focusChunkIndex < 0) {
      if (chapterChanged) scroller.scrollTop = 0
      return undefined
    }

    const target = chunkElsRef.current.get(focusChunkIndex)
    if (!target) {
      if (chapterChanged) scroller.scrollTop = 0
      return undefined
    }

    const scrollerRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const delta =
      targetRect.top + targetRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2)
    const followBand = scrollerRect.height * 0.22
    if (!chapterChanged && Math.abs(delta) < followBand) return undefined

    const top = scroller.scrollTop + delta
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      scroller.scrollTo({ top, behavior: 'auto' })
    })

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = 0
      }
    }
  }, [activeChunkIndex, chapter?.id, selectedChunkIndex, units])

  return (
    <div
      className={`jr-book-scroll jr-interactive-chapter is-${variant}`}
      ref={scrollerRef}
      tabIndex={0}
      aria-label="Chapter text"
    >
      <div className="jr-book-speech-bar">
        <SpeechOptimizeToggle
          checked={optimizeForSpeech}
          disabled={speechToggleLocked}
          onChange={onOptimizeForSpeechChange}
        />
      </div>
      <ChapterColumn
        chapterId={chapter?.id}
        units={units}
        onSectionActivate={handleSectionActivate}
        onChunkActivate={handleChunkActivate}
        registerChunkEl={registerChunkEl}
      />
    </div>
  )
}
