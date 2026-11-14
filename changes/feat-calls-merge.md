### Added

- Each call's description says what became of it, for `meetings show`, search, WireCat Desktop and an agent: `Incoming
  call to 600: answered by 101 Анна Смирнова after 0:03, talk 0:24. 102 Борис Кузнецов did not answer.`

### Changed — may break callers

- One call is one meeting. Every CDR row of a call (a ring group's members, a queue, a transfer) is joined by its
  `linkedid`, and the meeting's id is that `linkedid`. Its people are the caller and each employee who talked; its
  metadata says what became of it (`outcome`: answered, voicemail, busy, no_answer, failed), who answered
  (`answeredBy`), who rang without answering (`rang`), what was dialled, the wait before the first answer
  (`waitMs`), the talk time (`talkMs`) and every leg. The next sync marks the one-row meetings of 0.3.0 and older
  deleted; a transcript made of one of them is made again by `meetings transcribe`.

### Fixed

- A caller is linked to the CRM contact or messenger person with the same mobile number, as Beeline's are: the
  caller's participant now carries its phone number.
- A recording with nothing but its header, which MixMonitor leaves when nobody talked, is no longer linked or sent to
  transcription.
- A ring group's or queue's member who answered is named by the channel that reached them, not by the group's number,
  and employees are named from the caller ID of the calls they make.
- A build starts from an empty `dist/`, so a renamed file no longer ships: 0.3.0 carried an unused
  `dist/bin/asterisk.js`.
