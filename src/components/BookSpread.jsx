import InteractiveChapterText from './InteractiveChapterText'

export default function BookSpread({
  chapter,
  chapterChunks = [],
  activeChunkIndex = -1,
  selectedChunkIndex = -1,
  onSectionSelect,
  onChunkSeek,
  optimizeForSpeech = true,
  onOptimizeForSpeechChange,
  speechToggleLocked = false,
}) {
  return (
    <div className="jr-book-stage">
      <InteractiveChapterText
        chapter={chapter}
        chapterChunks={chapterChunks}
        activeChunkIndex={activeChunkIndex}
        selectedChunkIndex={selectedChunkIndex}
        onSectionSelect={onSectionSelect}
        onChunkSeek={onChunkSeek}
        optimizeForSpeech={optimizeForSpeech}
        onOptimizeForSpeechChange={onOptimizeForSpeechChange}
        speechToggleLocked={speechToggleLocked}
        variant="room"
      />
    </div>
  )
}
