/** Titles and indices only — never chapter or section body text. */
export function epubChapterListing(doc) {
  if (doc?.kind !== 'epub') {
    throw new Error('Open an EPUB to list chapters.')
  }
  return {
    title: doc.meta?.title || doc.name || null,
    creator: doc.meta?.creator || null,
    chapters: (doc.chapters || []).map((chapter, index) => ({
      chapter: index + 1,
      title: chapter.title || `Chapter ${index + 1}`,
      sections: (chapter.sections || []).map((section) => ({
        id: section.id,
        title: section.title,
      })),
    })),
  }
}
