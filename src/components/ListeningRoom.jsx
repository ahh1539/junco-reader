import { useCallback, useState } from 'react'
import BookSpread from './BookSpread'
import ContentsRail from './ContentsRail'
import ListenDock from './ListenDock'
import { adjacentSection, nearestSection } from '../lib/epubSeek'
import { chapterProgressPercent } from '../lib/epubProgress'
import './ListeningRoom.css'

export default function ListeningRoom({
  document,
  chunkRecords,
  chapterLengths,
  chapterChunks,
  previewChapterIndex,
  activeChunkIndex,
  activeChunkRecord,
  browsingTarget,
  bookPercent,
  progressLabel,
  playing,
  paused,
  genStats,
  engineReady,
  readyHint,
  ingestBusy,
  resumePosition,
  resumeChapter,
  resumePercent,
  resumeAtChapterStart,
  onOpenAnother,
  onChapterSelect,
  onSectionSeek,
  onChunkSeek,
  onPlay,
  onPlayFromBrowsingTarget,
  onPause,
  onResume,
  onStop,
  onResumeBook,
  onStartOver,
  onPrevChapter,
  onNextChapter,
  onPrevSection,
  onNextSection,
  voiceProps,
  speed,
  onSpeedChange,
  onListenInstantly,
  canPause = true,
  modelDownloadProps,
  optimizeForSpeech,
  onOptimizeForSpeechChange,
}) {
  const [contentsOpen, setContentsOpen] = useState(false)
  const [desktopRailOpen, setDesktopRailOpen] = useState(true)

  const chapter = document.chapters?.[previewChapterIndex] || document.chapters?.[0]
  const narratingChapterIndex = activeChunkRecord?.chapterIndex ?? null
  const narratingChapter =
    narratingChapterIndex != null ? document.chapters?.[narratingChapterIndex] : null
  const narratedSection = nearestSection(narratingChapter?.sections, activeChunkRecord?.startOffset ?? 0)
  const title = document.meta?.title || document.name
  const creator = document.meta?.creator

  const browsingOffset =
    browsingTarget?.chapterIndex === previewChapterIndex
      ? chunkRecords[browsingTarget.chunkIndex]?.startOffset ?? 0
      : 0
  const progressChapterIndex =
    playing || paused ? narratingChapterIndex ?? previewChapterIndex : previewChapterIndex
  const progressOffset =
    playing || paused
      ? activeChunkRecord?.startOffset ?? 0
      : browsingTarget
        ? browsingOffset
        : resumePosition?.chapterIndex === previewChapterIndex
          ? resumePosition.characterOffset
          : 0
  const chapterPercent = chapterProgressPercent(
    chapterLengths?.[progressChapterIndex] ?? 0,
    progressOffset,
  )

  const resumeOffer =
    resumePosition && resumeChapter
      ? {
          copy: resumeAtChapterStart
            ? `Resume at chapter ${resumePosition.chapterIndex + 1}, ${resumeChapter.title} — speech optimization changed, so playback will begin at this chapter’s start.`
            : `Continue from chapter ${resumePosition.chapterIndex + 1}, ${resumeChapter.title} — about ${resumePercent}% through the book.`,
        }
      : null

  const transportChapterIndex =
    playing && !paused && narratingChapterIndex != null
      ? narratingChapterIndex
      : browsingTarget?.chapterIndex ?? narratingChapterIndex ?? previewChapterIndex
  const transportChapter = document.chapters?.[transportChapterIndex]
  const transportOffset =
    playing && !paused
      ? activeChunkRecord?.startOffset ?? 0
      : browsingTarget
        ? chunkRecords[browsingTarget.chunkIndex]?.startOffset ?? 0
        : activeChunkRecord?.startOffset ?? 0
  const sections = transportChapter?.sections || []
  const canPrevSection =
    Boolean(adjacentSection(sections, transportOffset, -1)) || transportChapterIndex > 0
  const canNextSection =
    Boolean(adjacentSection(sections, transportOffset, 1)) ||
    transportChapterIndex < (document.chapters?.length || 0) - 1
  const handleRailSectionSelect = useCallback(
    (chapterIndex, section) => onSectionSeek?.(chapterIndex, section),
    [onSectionSeek],
  )

  return (
    <section className="jr-listening-room" aria-label="Listening Room">
      <header className="jr-room-head">
        <div className="jr-room-heading-copy">
          {creator ? <p className="jr-room-byline">{creator}</p> : null}
          <h2 className="jr-room-title">{title}</h2>
          {chapter ? <p className="jr-room-chapter">{chapter.title}</p> : null}
        </div>
        <div className="jr-room-head-actions">
          <p className="jr-room-position" aria-label={`Chapter ${previewChapterIndex + 1} of ${document.chapters.length}, ${bookPercent}% through book`}>
            <span>Chapter {previewChapterIndex + 1} of {document.chapters.length}</span>
            <span>{bookPercent}% read</span>
          </p>
          <button type="button" className="jr-btn jr-btn-ghost" onClick={onOpenAnother}>
            Open another book
          </button>
        </div>
      </header>

      {resumeOffer ? (
        <div className="jr-room-resume">
          <p className="jr-room-resume-copy">
            <span className="jr-room-resume-kicker">Saved position</span>
            {resumeOffer.copy}
          </p>
          <div className="jr-room-resume-actions">
            <button
              type="button"
              className="jr-btn jr-btn-primary jr-btn-sm"
              onClick={onResumeBook}
              disabled={!engineReady}
              title={!engineReady ? readyHint || undefined : undefined}
            >
              Continue
            </button>
            <button type="button" className="jr-btn jr-btn-ghost jr-btn-sm" onClick={onStartOver}>
              Start over
            </button>
          </div>
        </div>
      ) : null}

      <div className={`jr-room-stage${desktopRailOpen ? '' : ' is-rail-collapsed'}`}>
        <ContentsRail
          chapters={document.chapters}
          chapterIndex={previewChapterIndex}
          narratingChapterIndex={narratingChapterIndex}
          narratingSectionId={narratedSection?.id || null}
          selectedSectionId={browsingTarget?.sectionId || null}
          onChapterSelect={onChapterSelect}
          onSectionSelect={handleRailSectionSelect}
          mobileOpen={contentsOpen}
          onMobileOpenChange={setContentsOpen}
          desktopOpen={desktopRailOpen}
          onDesktopOpenChange={setDesktopRailOpen}
        />

        <BookSpread
          chapter={chapter}
          chapterChunks={chapterChunks}
          activeChunkIndex={activeChunkRecord?.chapterIndex === previewChapterIndex ? activeChunkIndex : -1}
          selectedChunkIndex={browsingTarget?.chunkIndex ?? -1}
          onSectionSelect={(section) => onSectionSeek?.(previewChapterIndex, section)}
          onChunkSeek={onChunkSeek}
          optimizeForSpeech={optimizeForSpeech}
          onOptimizeForSpeechChange={onOptimizeForSpeechChange}
          speechToggleLocked={playing || paused}
        />
      </div>

      <ListenDock
        ready={engineReady}
        readyHint={readyHint}
        playing={playing}
        paused={paused}
        genStats={genStats}
        disabled={!chunkRecords.length || ingestBusy}
        progressLabel={progressLabel}
        bookPercent={bookPercent}
        chapterPercent={chapterPercent}
        chapterTitle={(playing || paused ? narratingChapter : chapter)?.title}
        browsingTarget={browsingTarget}
        onPlayFromBrowsingTarget={onPlayFromBrowsingTarget}
        onPlay={onPlay}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        onPrevSection={onPrevSection}
        onNextSection={onNextSection}
        canPrevChapter={transportChapterIndex > 0}
        canNextChapter={transportChapterIndex < document.chapters.length - 1}
        canPrevSection={canPrevSection}
        canNextSection={canNextSection}
        voiceProps={voiceProps}
        speed={speed}
        onSpeedChange={onSpeedChange}
        onListenInstantly={onListenInstantly}
        canPause={canPause}
        modelDownloadProps={modelDownloadProps}
      />
    </section>
  )
}
