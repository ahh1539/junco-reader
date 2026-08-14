import { describe, expect, it } from 'vitest'

import { chunkText, chunkTextWithOffsets, CRUISE_CAP_INDEX } from './chunkText'

/**
 * Fixed multi-chapter literary fixture (~8–12k chars). Odyssey-like prose with
 * mixed short and long sentences. Deterministic: no randomness.
 */
const ODYSSEY_CHAPTERS = [
  `Tell me, Muse, of the man of many turns, who wandered far after he sacked the sacred citadel of Troy. He saw the cities of many men, and learned their minds. Many pains he suffered on the open sea, fighting for his own life and for the homecoming of his companions. He did not save them. They were ruined by their own recklessness. Fools. They ate the cattle of the Sun, and the god took from them the day of their return. Begin where you will, goddess, daughter of Zeus, and tell us also of these things. The other warriors, those who had escaped steep death, were at home, safe from war and the sea. He alone still longed for his wife and for his own country. A nymph, Calypso, bright among goddesses, held him in her hollow caves, wishing him to be her husband. But when the year came in the turning of the seasons, the gods consented that he should return to Ithaca, though not even there would he be free of trials. Poseidon was still angry. He had not killed the hero, but he drove him from his course. The rest of the gods pitied him, all except the Earth-shaker. Zeus spoke among them. See now, how mortal men blame the gods. They say that evils come from us, yet they themselves, by their own folly, have sorrows beyond what is given. Consider Aegisthus. He took the wife of the son of Atreus, and killed the man when he came home. He knew it would be his own death. We had sent Hermes to warn him. He would not listen. Now he has paid. Then Athena, the grey-eyed, answered. Father, that man lies in a death he earned. But my heart is torn for Odysseus, the wise, who suffers far from his own people, on an island in the middle of the sea. Atlas's daughter holds him. She is always calling him with soft and wheedling words to forget Ithaca. Odysseus, longing to see even the smoke rising from his own land, wants to die. Did not Odysseus please you with sacrifices beside the ships of the Argives, in wide Troy? Why are you so angry with him, Zeus? The cloud-gatherer answered her. What word has escaped the barrier of your teeth? How could I forget Odysseus, who is beyond all mortals in his mind, and beyond all has given sacrifice to the immortal gods? It is Poseidon, the earth-holder, who is stubborn in his anger, because Odysseus blinded his son, the cyclops Polyphemus, whose power is greatest among all the Cyclopes. The nymph Thoosa bore him, daughter of Phorcys, lord of the barren sea, in the hollow caves. Since that day Poseidon does not kill Odysseus, but he makes him wander from his native land. Come, let us all take thought of his returning. Poseidon will have to let go of his anger. He cannot hold out alone against all the immortals. Athena was glad. If it is now pleasing to the blessed gods that Odysseus should return, then let us send Hermes to Ogygia, to tell the nymph of the fair braids our unshakable purpose: that long-suffering Odysseus is to go home. I myself will go to Ithaca, to put more spirit in his son, and to make him call the long-haired Achaeans to assembly, and speak out against the suitors who butcher his sheep and his rolling cattle. I will send him to Sparta and to sandy Pylos, to ask after his father's return, and so that a good report of him may go among men.`,
  `When they had put from them the desire of food and drink, Telemachus spoke. Stranger, will you be angry if I say something? These men care for one thing only: the lyre and the song. It is easy for them, because they are eating up the livelihood of a man whose white bones lie out in the rain, or the waves roll them in the sea. If they saw him returned to Ithaca, they would all pray to be lighter on their feet, rather than richer in gold and clothing. But he has died a wretched death, and there is no comfort for us, even if someone of men on earth should say he will come. The day of his returning is lost. Then grey-eyed Athena answered. I will prophesy to you, though I am no prophet, and I have no clear knowledge of the omens. He will not be long away from his own dear country, even if he is held in chains of iron. He will think of a way to come back. He is a man of many devices. But you, you must not go on with this childishness. You are no longer of an age for that. Have you not heard what glory Orestes won among all men, when he killed the murderer of his father? You too, my friend, for I see you are tall and handsome, be brave, so that men yet to be born may praise you. I must go to my fast ship and my companions, who are waiting for me with impatience. Think of what I have said. Telemachus answered. Stranger, you have spoken to me out of a kind heart, as a father to his son. I will not forget your words. Stay a little. Bathe, and take a gift, such as dear guests are given, so that you may have joy of it when you remember me. Athena would not stay. She flew up like a bird, and she left in his spirit strength and courage, and she made him think of his father even more than before. He understood. He was amazed. He knew it was a god. He went among the suitors, a godlike man. The famous minstrel was singing to them, and they sat listening in silence. He sang of the return of the Achaeans, the bitter return that Pallas Athena laid on them from Troy. From her upper room, Icarius's daughter, wise Penelope, heard the inspired song. She came down the high stair from her chamber, not alone: two handmaidens came with her. When she, shining among women, came near the suitors, she stood by a pillar of the roof, holding a fold of her bright head-dress before her face, and a devoted attendant stood on either side of her. She wept, and she spoke to the divine singer. Phemios, you know many other actions of men and gods, which the singers celebrate. Sit beside these men and sing one of those. Do not sing this bitter song, which wears my heart, since an unforgettable grief comes over me, more than on others. I long for so dear a person, remembering always that man, whose fame goes wide through Hellas and the heart of Argos. Telemachus spoke to her then, in a way he had not spoken before. My mother, why do you begrudge this excellent singer the right to please us in whatever way his mind is moved? It is not singers who are to blame, but Zeus, who gives to toiling men whatever he wishes, to each one. There is no reason to be angry because this man sings the evil doom of the Danaans. People celebrate more the song which is newest to those who hear it. Let your heart and spirit endure to listen. Odysseus is not the only one who lost his day of returning in Troy. Many others died there. Go back to your own hall. Look to your own work, the loom and the distaff, and tell your handmaidens to go about their business. Speech will be the men's concern, all of them, and mine most of all, because the authority in this house is mine.`,
  `When Dawn showed her rosy fingers, the dear son of Odysseus rose from his bed and put on his clothes. He slung a sharp sword from his shoulder. He bound his fair sandals under his shining feet, and he went out from his chamber, like a god to look upon. He at once told the clear-voiced heralds to call the long-haired Achaeans to assembly. They made the call, and the men gathered quickly. When they were all assembled, he went into the place of meeting, and he held a bronze spear in his hand, and he was not alone: two swift dogs followed him. Athena set a magic grace upon him, and all the people admired him as he came. The elders made way, and he sat in his father's seat. The first to speak was the hero Aegyptius, who was bent with age, and who knew a thousand things. His dear son, the spearman Antiphus, had gone with Odysseus in the hollow ships to Ilion, land of horses, and the savage cyclops had killed him in the cave, the last of the companions he ate. Aegyptius had three other sons. One, Eurynomus, went with the suitors; two kept their father's farm. Even so, he could not forget Antiphus, and he grieved. He spoke, weeping. Listen to me now, men of Ithaca. We have not held an assembly since the day Odysseus went in the hollow ships. Who has called us together now? Is it one of the young men, or one of those who are older? Has he heard some message of an army coming, which he can tell us clearly, since he was the first to hear it? Or is there some other public matter he will declare and tell us? He seems to me a good man, a blessed man. May Zeus accomplish some good thing for him. Telemachus was glad. He had been wishing to speak. He stood in the middle of the assembly. The herald Peisenor, a man of good understanding, put the staff in his hand. Telemachus spoke, turning first to the old man. Old sir, the man is not far off. You will soon know who called this gathering. It is I. I am the one who suffers most. I have heard no message of an army coming, which I could tell you clearly. This is my own need, which has fallen on my house in two ways. I have lost my noble father, who was once king among you here, and as gentle as a father. And now there is a much greater evil, which will soon break up my whole house and destroy all my livelihood. Suitors are plaguing my mother against her will, the sons of the men who are the greatest here. They shrink from going to the house of her father Icarius, so that he might marry his daughter to the man he chose, the one who pleased him. Instead they spend their days at our house, sacrificing our oxen and sheep and fat goats, and they feast and drink the bright wine, recklessly. Most of it is wasted. There is no man here like Odysseus to drive this curse from the house. We are not able to do it. We would only be pitiful, and we have no skill in fighting. If I had the power, I would do it. The things that have been done are no longer to be endured. My house is being ruined. You should be angry yourselves. You should feel shame before the neighboring men who live around us, and fear the wrath of the gods, in case they turn against you in anger at these evil deeds. I beg you, by Olympian Zeus and by Themis, who dissolves and gathers the assemblies of men, hold back, my friends. Leave me alone to waste away in my bitter grief, unless my father, the noble Odysseus, did some harm to the well-greaved Achaeans, in spite, and you are paying me back by harming me, by urging these men on. It would be better if you yourselves were eating up my treasures and my cattle. If you were to eat them, there would be some compensation. We would go up and down the city, asking for our goods back, until everything was given. But now you are putting an affliction on my heart that cannot be healed.`,
]

function chunkFixtureLikeEpub(chapters) {
  return chapters.flatMap((text, chapterIndex) =>
    chunkTextWithOffsets(text, {
      capIndexOffset: chapterIndex === 0 ? 0 : CRUISE_CAP_INDEX,
    }).map((chunk) => ({ ...chunk, chapterIndex })),
  )
}

function chunkingStats(records) {
  const lengths = records.map((record) => record.text.length)
  const firstChunkByChapter = []
  records.forEach((record) => {
    firstChunkByChapter[record.chapterIndex] ??= record.text.length
  })
  return {
    count: lengths.length,
    meanChars: lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
    minChars: Math.min(...lengths),
    maxChars: Math.max(...lengths),
    under100: lengths.filter((length) => length < 100).length,
    firstChunkByChapter,
  }
}

// Frozen from the 48/90/150/220 per-chapter-reset chunker on ODYSSEY_CHAPTERS
// (captured before cruise-350 / capIndexOffset). Do not regenerate.
const BEFORE_COUNT = 68
const BEFORE_MEAN = 154.44117647058823
const BEFORE_MIN = 44
const BEFORE_MAX = 220
const BEFORE_UNDER100 = 11
const BEFORE_CH2_FIRST = 46
const BEFORE_CH3_FIRST = 47

describe('chunkTextWithOffsets', () => {
  it('matches the existing chunk text while retaining normalized offsets', () => {
    const source = 'First sentence.\n\nSecond sentence repeats. Second sentence repeats.\nThird sentence.'
    const records = chunkTextWithOffsets(source)

    expect(records.map((record) => record.text)).toEqual(chunkText(source))
    expect(records[0]).toMatchObject({ startOffset: 0 })

    const normalized = source.replace(/\s+/g, ' ').trim()
    records.forEach((record) => {
      expect(normalized.slice(record.startOffset, record.endOffset)).toBe(record.text)
    })
  })

  it('returns no records for empty input', () => {
    expect(chunkTextWithOffsets('   ')).toEqual([])
  })

  it('hard-splits a giant sentence at the cruise cap', () => {
    const giant = `${'word '.repeat(400).trim()}.`
    const records = chunkTextWithOffsets(giant, { capIndexOffset: CRUISE_CAP_INDEX })
    expect(records.length).toBeGreaterThan(1)
    records.forEach((record) => {
      expect(record.text.length).toBeLessThanOrEqual(350)
    })
  })

  it('does not start a later chapter at the TTFA cap', () => {
    const records = chunkTextWithOffsets(ODYSSEY_CHAPTERS[1], {
      capIndexOffset: CRUISE_CAP_INDEX,
    })
    expect(records[0].text.length).toBeGreaterThan(48)
    expect(records[0].text.length).toBeGreaterThanOrEqual(180)
  })
})

describe('Odyssey fixture (EPUB chunking)', () => {
  it('is a fixed 8–12k three-chapter literary sample', () => {
    const total = ODYSSEY_CHAPTERS.reduce((sum, text) => sum + text.length, 0)
    expect(ODYSSEY_CHAPTERS).toHaveLength(3)
    expect(total).toBeGreaterThanOrEqual(8000)
    expect(total).toBeLessThanOrEqual(12000)
  })

  it('beats the frozen before snapshot: fewer chunks, cruise near 350, no 48 on later chapters', () => {
    const after = chunkingStats(chunkFixtureLikeEpub(ODYSSEY_CHAPTERS))

    expect(after.count).toBeLessThanOrEqual(BEFORE_COUNT * 0.7)
    expect(after.meanChars).toBeGreaterThan(BEFORE_MEAN)
    expect(after.meanChars).toBeGreaterThan(220)
    expect(after.firstChunkByChapter[1]).toBeGreaterThanOrEqual(180)
    expect(after.firstChunkByChapter[2]).toBeGreaterThanOrEqual(180)
    expect(after.firstChunkByChapter[1]).not.toBe(BEFORE_CH2_FIRST)
    expect(after.firstChunkByChapter[2]).not.toBe(BEFORE_CH3_FIRST)
    expect([BEFORE_MIN, BEFORE_MAX, BEFORE_UNDER100]).toEqual([44, 220, 11])

    const normalized = ODYSSEY_CHAPTERS.map((text) => text.replace(/\s+/g, ' ').trim())
    chunkFixtureLikeEpub(ODYSSEY_CHAPTERS).forEach((record) => {
      expect(normalized[record.chapterIndex].slice(record.startOffset, record.endOffset)).toBe(
        record.text,
      )
    })
  })
})
