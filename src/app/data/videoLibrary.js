'use client';

export const VIDEO_LIBRARY_CATEGORY_OPTIONS = [
  { key: 'distinctive', label: 'Distinctive' },
  { key: 'interview', label: 'Interviews' },
  { key: 'lecture', label: 'Lectures / Masterclasses' },
  { key: 'speech', label: 'Speeches / Addresses' },
  { key: 'documentary', label: 'Documentaries' },
  { key: 'analysis', label: 'Analysis & Profiles' },
  { key: 'performance', label: 'Festival / Performance' },
  { key: 'keynote', label: 'Keynotes' },
];

export const VIDEO_LIBRARY_RESOURCE_TYPE_OPTIONS = [
  { key: 'official', label: 'Official text' },
  { key: 'archive', label: 'Archive' },
  { key: 'essay', label: 'Essay' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'context', label: 'Context' },
];

// Figures of interest are grouped by topic. Topic order here is the display priority
// (Leaders of the Middle East is prioritized first). Scales as more topics are added.
export const VIDEO_LIBRARY_TOPIC_OPTIONS = [
  { key: 'me_leaders', label: 'Leaders of the Middle East' },
  { key: 'ai', label: 'AI' },
  { key: 'leadership', label: 'Leadership & Vision' },
];

export const VIDEO_LIBRARY_CREATOR_OPTIONS = [
  {
    key: 'mohammed-bin-rashid',
    label: 'Sheikh Mohammed bin Rashid Al Maktoum',
    aliases: ['mohammed bin rashid', 'mohammed bin rashid al maktoum', 'محمد بن راشد', 'mbr', 'ruler of dubai', 'uae prime minister'],
    queryHint: 'leadership, personality, Dubai governance, innovation, speeches, and long-form interviews',
  },
  {
    key: 'sam-altman',
    label: 'Sam Altman',
    aliases: ['sam altman', 'altman', 'openai ceo'],
    queryHint: 'long-form interviews and talks on OpenAI, AGI, and scaling',
  },
  {
    key: 'dario-amodei',
    label: 'Dario Amodei',
    aliases: ['dario amodei', 'amodei', 'anthropic ceo'],
    queryHint: 'long-form interviews on Claude, AI safety, and scaling',
  },
  {
    key: 'demis-hassabis',
    label: 'Demis Hassabis',
    aliases: ['demis hassabis', 'hassabis', 'deepmind ceo'],
    queryHint: 'long-form interviews and lectures on AGI, AlphaFold, and science',
  },
  {
    key: 'elon-musk',
    label: 'Elon Musk',
    aliases: ['elon musk', 'elon', 'xai', 'grok'],
    queryHint: 'long-form interviews on xAI, AGI, and first-principles thinking',
  },
  {
    key: 'mohamed-bin-zayed',
    label: 'Sheikh Mohamed bin Zayed',
    aliases: ['mohamed bin zayed', 'mohammed bin zayed', 'mbz', 'bin zayed', 'uae president'],
    queryHint: 'speeches, addresses, and long-form remarks on UAE vision and strategy',
  },
  {
    key: 'saddam-hussein',
    label: 'Saddam Hussein',
    aliases: ['saddam hussein', 'saddam', 'iraq president'],
    queryHint: 'primary speeches, interviews, and the journalistic record of his rule',
  },
  {
    key: 'osama-bin-laden',
    label: 'Osama bin Laden',
    aliases: ['osama bin laden', 'bin laden', 'osama', 'al-qaeda'],
    queryHint: 'journalistic interviews and credible documentaries (no propaganda)',
  },
  {
    key: 'mohammed-bin-salman',
    label: 'Mohammed bin Salman',
    aliases: ['mohammed bin salman', 'mohammad bin salman', 'mbs', 'saudi crown prince'],
    queryHint: 'primary interviews and credible long-form investigations',
  },
  {
    key: 'tamim-bin-hamad',
    label: 'Sheikh Tamim bin Hamad Al Thani',
    aliases: ['tamim bin hamad', 'tamim', 'qatar emir', 'emir of qatar'],
    queryHint: 'UN addresses and on-record interviews',
  },
  {
    key: 'jordan-peterson',
    label: 'Jordan Peterson',
    aliases: ['jordan peterson', 'jordan b peterson', 'peterson', 'maps of meaning'],
    queryHint: 'Maps of Meaning lectures, distinctive lectures, and long-form talks',
  },
  {
    key: 'steve-jobs',
    label: 'Steve Jobs',
    aliases: ['steve jobs', 'jobs'],
    queryHint: 'distinctive talks, interviews, and iconic Apple keynotes',
  },
  {
    key: 'niles-hollowell-dhar',
    label: 'Niles Hollowell-Dhar / KSHMR',
    aliases: ['niles hollowell dhar', 'niles dhar', 'kshmr', 'the cataracs'],
    queryHint: 'interviews, masterclasses, and festival sets rather than music videos',
  },
];

export const DEFAULT_VIDEO_LIBRARY_PREFERENCES = {
  creators: VIDEO_LIBRARY_CREATOR_OPTIONS.map((creator) => creator.key),
  categories: VIDEO_LIBRARY_CATEGORY_OPTIONS.map((category) => category.key),
  inlinePlayback: true,
};

const RAW_CURATED_VIDEO_LIBRARY = [
  {
    key: 'mohammed-bin-rashid',
    label: 'Sheikh Mohammed bin Rashid Al Maktoum',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'Vice President and Prime Minister of the UAE; Ruler of Dubai',
    essay: `A priority study in visionary state-building, executive temperament, and symbolic leadership  -  how a ruler turned Dubai into a global city by combining speed, spectacle, risk appetite, institutional pressure, poetry, philanthropy, and future-facing governance. This figure is watched first for personality, decision style, leadership method, and the deeper pattern behind Dubai's transformation.`,
    searchFocus: `Primary speeches, interviews, Dubai future institutions, official initiatives, and serious profiles on his leadership personality`,
    resources: [
      {
        title: 'Mohammed Bin Rashid Center for Leadership Development',
        url: 'https://www.mbrcld.ae/en',
        source: 'MBRCLD',
        type: 'official',
        year: 'current',
        value: 'Official leadership-development institution connected to his governing philosophy and leadership pipeline.',
      },
      {
        title: 'Dubai Future Foundation',
        url: 'https://www.dubaifuture.ae/',
        source: 'Dubai Future Foundation',
        type: 'official',
        year: 'current',
        value: 'Institutional proof of the future-oriented governance model around Dubai, foresight, AI, and innovation.',
      },
      {
        title: 'Mohammed bin Rashid Al Maktoum Knowledge Foundation',
        url: 'https://mbrf.ae/en',
        source: 'MBRF',
        type: 'official',
        year: 'current',
        value: 'Knowledge, reading, and human-capital initiatives that reveal the education and civilization layer of his project.',
      },
      {
        title: 'Official Sheikh Mohammed website',
        url: 'https://sheikhmohammed.ae/en-us/',
        source: 'Official website',
        type: 'official',
        year: 'current',
        value: 'Primary home for biography, speeches, poetry, initiatives, and official personal framing.',
      },
    ],
    years: [
      {
        key: '2007',
        label: '2007',
        videos: [
          { title: 'Sheikh Mohammed bin Rashid Al Maktoum: CBS 60 Minutes (Dubai Inc.)', url: 'https://www.youtube.com/watch?v=4T7k9mC_b_E', categories: ['interview', 'distinctive'], summary: `CBS News 60 Minutes: An in-depth interview with the Ruler of Dubai on his vision for turning Dubai into a global financial hub, the pace of construction, and state governance.` },
        ],
      },
      {
        key: '2010',
        label: '2010',
        videos: [
          { title: 'Sheikh Mohammed on the future of Dubai', url: 'https://www.youtube.com/watch?v=MeDb2nU9jKU', categories: ['interview', 'distinctive'], summary: `BBC News: a direct interview on Dubai's crisis, ambition, confidence, and the ruler's own framing of risk and future-building.` },
        ],
      },
      {
        key: '2011',
        label: '2011',
        videos: [
          { title: 'Sheikh Mohammed bin Rashid Al Maktoum: CNN Erin Burnett Interview', url: 'https://www.youtube.com/watch?v=HSiHHRHlWam', categories: ['interview'], summary: `CNN OutFront: Erin Burnett interviews Sheikh Mohammed on Dubai's debt recovery, regional revolutions (Arab Spring), and UAE economic progress.` },
        ],
      },
      {
        key: '2015',
        label: '2015',
        videos: [
          { title: 'Sheikh Mohammed bin Rashid Al Maktoum: World Governments Summit Keynote', url: 'https://www.youtube.com/watch?v=GjjDmD5BvCc', categories: ['speech', 'keynote'], summary: `Official keynote address at the World Governments Summit focusing on government efficiency, Arab youth, and future planning.` },
        ],
      },
      {
        key: '2017',
        label: '2017',
        videos: [
          { title: 'Sheikh Mohammed bin Rashid Al Maktoum: Historic Q&A Session', url: 'https://www.youtube.com/watch?v=AUZIYQFa-IJ', categories: ['interview', 'distinctive'], summary: `A rare interactive question-and-answer session discussing leadership challenges, decision-making, and his personal life.` },
        ],
      },
    ],
  },
  {
    key: 'saddam-hussein',
    label: 'Saddam Hussein',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'President of Iraq (1979-2003)',
    essay: `A defining case study in 20th-century authoritarian state-building  -  how a Ba'athist apparatchik fused personality cult, sectarian patronage, and brutal security organs into three decades of total control, then miscalculated through the Iran-Iraq War, Kuwait, and 2003. His own words and the journalistic record illuminate the mechanics of dictatorship and modern Gulf politics.`,
    searchFocus: `Primary speeches, interviews, and the journalistic record of his rule`,
    resources: [
      {
        title: 'Saddam Hussein Regime Collection',
        url: 'https://www.wilsoncenter.org/blog-post/reintroducing-saddam-hussein-regime-collection-conflict-records-research-center',
        source: 'Wilson Center',
        type: 'archive',
        year: '2024',
        value: 'Declassified regime records for studying how the state operated.',
      },
      {
        title: 'The Iraq Project',
        url: 'https://nsarchive.gwu.edu/index.php/project/iraq-project',
        source: 'National Security Archive',
        type: 'archive',
        year: 'current',
        value: 'US-Iraq document collections for policy context and invasion history.',
      },
    ],
    years: [
      {
        key: '1980',
        label: '1980',
        videos: [
          { title: 'SYND 14 11 80: President Saddam Hussein gives news conference', url: 'https://www.youtube.com/watch?v=5Z3cl8UYhpM', categories: ['speech'], summary: `AP Archive: raw, un-narrated news conference early in the Iran-Iraq War  -  his wartime self-presentation before the personality cult matured.` },
        ],
      },
      {
        key: '1990',
        label: '1990',
        videos: [
          { title: 'ITN Exclusive: Saddam Hussein interviewed on the eve of the Gulf War', url: 'https://www.youtube.com/watch?v=H-2Zj86_Z9A', categories: ['interview'], summary: `Frontline by ITN: an hour-long Baghdad interview at the height of the Gulf crisis  -  his framing of the Kuwait invasion in his own words.` },
        ],
      },
      {
        key: '2006',
        label: '2006',
        videos: [
          { title: 'Saddam Hussein found guilty and sentenced to death', url: 'https://www.youtube.com/watch?v=akylkk7Go9A', categories: ['documentary'], summary: `AP Archive: courtroom footage of the Nov. 2006 Dujail verdict  -  a primary record of his trial and fall.` },
        ],
      },
    ],
  },
  {
    key: 'osama-bin-laden',
    label: 'Osama bin Laden',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'Founder of al-Qaeda',
    essay: `His rare on-camera statements document, in his own words, the grievances and strategic logic that drove al-Qaeda from a marginal network into the force behind 9/11  -  and the credible record illuminates the intelligence-failure question: the warnings seen years before the attacks. Curated strictly as educational/journalistic history, not propaganda.`,
    searchFocus: `Journalistic interviews and credible documentaries (no propaganda)`,
    resources: [
      {
        title: 'Harmony Program',
        url: 'https://ctc.westpoint.edu/harmony-program/',
        source: 'Combating Terrorism Center at West Point',
        type: 'archive',
        year: 'current',
        value: 'Captured-document archive with explicit scholarly caution notes.',
      },
      {
        title: 'The 9/11 Commission Report',
        url: 'https://www.9-11commission.gov/report/',
        source: '9/11 Commission (official)',
        type: 'report',
        year: '2004',
        value: 'The authoritative U.S. inquiry into the 9/11 attacks and al-Qaeda — a primary historical record for serious study.',
      },
    ],
    years: [
      {
        key: '1997',
        label: '1997',
        videos: [
          { title: 'Osama bin Laden declares jihad in 1997 CNN interview', url: 'https://www.youtube.com/watch?v=orawG7vt68o', categories: ['interview'], summary: `CNN: a clip from the 1997 Peter Arnett interview where he states his rationale for jihad against the U.S.  -  primary source from a major outlet.` },
        ],
      },
      {
        key: '2002',
        label: '2002',
        videos: [
          { title: 'The Man Who Knew (full documentary) | FRONTLINE', url: 'https://www.youtube.com/watch?v=pbXPqWGGQ5U', categories: ['documentary'], summary: `PBS FRONTLINE: the FBI's John O'Neill, who tracked bin Laden and warned of al-Qaeda before 9/11  -  the intelligence-failure question.` },
          { title: 'In Search of Al Qaeda (full documentary) | FRONTLINE', url: 'https://www.youtube.com/watch?v=BlhQ1cc3EbQ', categories: ['documentary'], summary: `PBS FRONTLINE: an investigation of al-Qaeda's network after Tora Bora  -  credible journalistic analysis for serious study, not glorification.` },
        ],
      },
    ],
  },
  {
    key: 'mohammed-bin-salman',
    label: 'Mohammed bin Salman',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'Crown Prince & PM of Saudi Arabia',
    essay: `The de facto ruler who consolidated unprecedented power, launched the Vision 2030 transformation, and became internationally defined by the murder of journalist Jamal Khashoggi  -  a study in how authoritarian modernization, oil geopolitics, and personalized power converge in one young leader reshaping a pivotal Gulf state.`,
    searchFocus: `Primary interviews and credible long-form investigations`,
    resources: [
      {
        title: 'Saudi Vision 2030 overview',
        url: 'https://www.vision2030.gov.sa/en/overview',
        source: 'Vision 2030',
        type: 'official',
        year: 'current',
        value: 'Official state transformation frame: economy, citizens, investment.',
      },
      {
        title: 'Saudi Vision 2030 text',
        url: 'https://www.mofa.gov.sa/en/ksa/Pages/vision.aspx',
        source: 'Saudi Ministry of Foreign Affairs',
        type: 'official',
        year: 'current',
        value: 'Government-hosted text of the Vision 2030 program.',
      },
    ],
    years: [
      {
        key: '2019',
        label: '2019',
        videos: [
          { title: 'The Crown Prince of Saudi Arabia (full documentary) | FRONTLINE', url: 'https://www.youtube.com/watch?v=5IBa88VkM6g', categories: ['documentary'], summary: `PBS FRONTLINE: the definitive long-form investigation into MBS's rise and rule, a year after Khashoggi  -  with an on-camera MBS interview.` },
          { title: 'EXCLUSIVE: MBS speaks about his role in the murder of Jamal Khashoggi | FRONTLINE', url: 'https://www.youtube.com/watch?v=jNIysBbhSYA', categories: ['interview'], summary: `PBS FRONTLINE: MBS in his own words on the Khashoggi killing  -  "it happened under my watch" while denying knowledge.` },
          { title: '"60 Minutes" asks Saudi prince: Did you order Khashoggi murder?', url: 'https://www.youtube.com/watch?v=EkYmEeKizgg', categories: ['interview'], summary: `60 Minutes (CBS): MBS's first on-camera interview about the Khashoggi murder, with Norah O'Donnell.` },
        ],
      },
      {
        key: '2020',
        label: '2020',
        videos: [
          { title: 'MBS: The Rise to Power of Mohammed bin Salman  -  with Ben Hubbard', url: 'https://www.youtube.com/watch?v=iR7HtyzE_ug', categories: ['analysis'], summary: `World Affairs Council of Houston: NYT's Ben Hubbard on his investigative book about MBS's emergence from the royal family.` },
        ],
      },
    ],
  },
  {
    key: 'mohamed-bin-zayed',
    label: 'Sheikh Mohamed bin Zayed',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'President of the UAE; Ruler of Abu Dhabi',
    essay: `One of the most consequential and least publicly verbose Gulf leaders of his generation  -  architect of the UAE's regional power, its hard-security posture, its energy-and-climate diplomacy (hosting COP28), and normalization with Israel. He governs through actions and tightly managed messaging, so each deliberate address is a window into how a small state projects strategic influence.`,
    searchFocus: `Speeches and addresses on UAE vision, energy, and statecraft`,
    resources: [
      {
        title: 'UAE President elected',
        url: 'https://www.mofa.gov.ae/en/mediahub/news/2022/5/14/14-05-2022-uae',
        source: 'UAE Ministry of Foreign Affairs',
        type: 'official',
        year: '2022',
        value: 'Official transition point for his presidency.',
      },
      {
        title: 'Major Economies Forum remarks',
        url: 'https://www.mohamedbinzayed.ae/en/latest-news-listing/2022/06/UAE-President-at-Major-Economies-Forum-Peace-and-Collaboration-Essential-for-Sustainable-Economic-an',
        source: 'Mohamed bin Zayed official site',
        type: 'official',
        year: '2022',
        value: 'Primary climate, cooperation, and statecraft framing.',
      },
    ],
    years: [
      {
        key: '2020',
        label: '2020',
        videos: [
          { title: 'UAE leader Mohammed bin Zayed rises in the Middle East', url: 'https://www.youtube.com/watch?v=BZRvLECb2vk', categories: ['analysis'], summary: `CBS News: a journalistic profile of MBZ's emergence as a pivotal regional power-broker amid US-Iran tensions.` },
        ],
      },
      {
        key: '2022',
        label: '2022',
        videos: [
          { title: 'Sheikh Mohamed bin Zayed speaks at the World Leaders Summit, COP27', url: 'https://www.youtube.com/watch?v=KqbyNUt93pY', categories: ['speech'], summary: `Office of the UAE Special Envoy for Climate: his full COP27 speech to heads of state  -  a clear articulation of UAE energy & climate diplomacy.` },
          { title: 'UAE President sets out national priorities in address to the nation', url: 'https://www.youtube.com/watch?v=tarGOMn6TZU', categories: ['speech'], summary: `Gulf News: his first major televised address to the nation as president  -  security, economy, and strategic priorities.` },
        ],
      },
      {
        key: '2023',
        label: '2023',
        videos: [
          { title: 'COP28: Opening Ceremony', url: 'https://www.youtube.com/watch?v=kJhgEnRI4HU', categories: ['speech'], summary: `UN Climate Change: the COP28 opening ceremony hosted under the UAE presidency  -  the UAE positioned as a bridge on climate.` },
          { title: 'Sheikh Mohamed bin Zayed: remarks at the Major Economies Forum on Energy and Climate', url: 'https://www.youtube.com/watch?v=Gu_lDez07i8', categories: ['speech'], summary: `COP28 UAE: his remarks to the Major Economies Forum on energy transition and climate finance.` },
        ],
      },
    ],
  },
  {
    key: 'tamim-bin-hamad',
    label: 'Sheikh Tamim bin Hamad Al Thani',
    tier: 'figure',
    topic: 'me_leaders',
    role: 'Emir of Qatar',
    essay: `The architect of "punching above its weight" small-state statecraft  -  ruling a gas-rich micro-state, he turned Qatar into an indispensable global mediator (Gaza, Afghanistan, Iran-US backchannels) and soft-power hub (Al Jazeera, the 2022 World Cup) while surviving the 2017 GCC blockade. A case study in balancing US security guarantees with an independent, often confrontational foreign policy.`,
    searchFocus: `Primary UN addresses and on-record interviews`,
    resources: [
      {
        title: 'UN General Debate 79 statement',
        url: 'https://gadebate.un.org/sites/default/files/gastatements/79/qa_en.pdf',
        source: 'United Nations',
        type: 'official',
        year: '2024',
        value: 'Primary Qatar statement on Gaza, mediation, and international law.',
      },
      {
        title: 'UN General Debate 69 statement',
        url: 'https://www.un.org/en/ga/69/meetings/gadebate/24sep/qatar.shtml',
        source: 'United Nations',
        type: 'official',
        year: '2014',
        value: 'Older baseline for Qatar mediation and humanitarian framing.',
      },
    ],
    years: [
      {
        key: '2017',
        label: '2017',
        videos: [
          { title: 'Qatar emir: Our sovereignty is a red line', url: 'https://www.youtube.com/watch?v=NtNThEqB31Q', categories: ['interview'], summary: `Al Jazeera English: his "sovereignty is a red line" remarks during the 2017 GCC blockade.` },
        ],
      },
      {
        key: '2024',
        label: '2024',
        videos: [
          { title: 'Qatar  -  Amir addresses the UN General Debate, 79th Session', url: 'https://www.youtube.com/watch?v=znwv69vAhqc', categories: ['speech'], summary: `United Nations: his full address to the 79th UN General Debate  -  Qatar on Gaza, mediation, and international law.` },
          { title: "Emir of Qatar condemns 'blatant aggression' against Palestinians", url: 'https://www.youtube.com/watch?v=9FwqGAPtTdE', categories: ['speech'], summary: `Al Jazeera English: his speech condemning the Gaza campaign and international silence.` },
        ],
      },
      {
        key: '2025',
        label: '2025',
        videos: [
          { title: 'Qatar  -  Amir addresses the UN General Debate, 80th Session', url: 'https://www.youtube.com/watch?v=4A0KnN6VWs4', categories: ['speech'], summary: `United Nations: his most recent UN General Assembly address  -  confrontational diplomacy over Gaza.` },
        ],
      },
    ],
  },
  {
    key: 'sam-altman',
    label: 'Sam Altman',
    tier: 'figure',
    topic: 'ai',
    role: 'CEO, OpenAI',
    essay: 'Turned a research lab into the company that put generative AI in front of hundreds of millions. Watch how his framing of AGI, safety, and scale shifts year to year.',
    searchFocus: 'Long-form interviews on OpenAI, AGI, and scaling',
    resources: [
      {
        title: 'Planning for AGI and beyond',
        url: 'https://openai.com/index/planning-for-agi-and-beyond/',
        source: 'OpenAI',
        type: 'essay',
        year: '2023',
        value: 'Official AGI governance and deployment frame.',
      },
      {
        title: 'The Intelligence Age',
        url: 'https://ia.samaltman.com/',
        source: 'Sam Altman',
        type: 'essay',
        year: '2024',
        value: 'Personal public frame for intelligence abundance and agency.',
      },
    ],
    years: [
      {
        key: '2023',
        label: '2023',
        videos: [
          { title: 'Sam Altman: OpenAI CEO on GPT-4, ChatGPT, and the Future of AI | Lex Fridman Podcast #367', url: 'https://www.youtube.com/watch?v=L_Guz73e6fw', categories: ['distinctive', 'interview'], summary: 'The 2023 conversation on GPT-4, ChatGPT, safety, and where OpenAI is heading.' },
        ],
      },
      {
        key: '2024',
        label: '2024',
        videos: [
          { title: 'Sam Altman: OpenAI, GPT-5, Sora, Board Saga, Elon Musk, Ilya, Power & AGI | Lex Fridman Podcast #419', url: 'https://www.youtube.com/watch?v=jvqFAi7vkBc', categories: ['distinctive', 'interview'], summary: 'Post-board-saga: power, AGI, Sora, Ilya, and the road to GPT-5.' },
        ],
      },
    ],
  },
  {
    key: 'dario-amodei',
    label: 'Dario Amodei',
    tier: 'figure',
    topic: 'ai',
    role: 'CEO & co-founder, Anthropic',
    essay: 'Left OpenAI to build Anthropic around AI safety and the team behind Claude. Watch his "scaling laws" thesis and his case for a safe, optimistic path to powerful AI.',
    searchFocus: 'Long-form interviews on Claude, AI safety, and scaling',
    resources: [
      {
        title: 'Machines of Loving Grace',
        url: 'https://www.darioamodei.com/essay/machines-of-loving-grace',
        source: 'Dario Amodei',
        type: 'essay',
        year: '2024',
        value: 'Long-form upside thesis for powerful AI.',
      },
      {
        title: 'Core views on AI safety',
        url: 'https://www.anthropic.com/news/core-views-on-ai-safety?cam=claude',
        source: 'Anthropic',
        type: 'official',
        year: '2023',
        value: 'Anthropic safety rationale and strategy.',
      },
    ],
    years: [
      {
        key: '2024',
        label: '2024',
        videos: [
          { title: 'Dario Amodei: Anthropic CEO on Claude, AGI & the Future of AI & Humanity | Lex Fridman Podcast #452', url: 'https://www.youtube.com/watch?v=ugvHCXCOmm4', categories: ['distinctive', 'interview'], summary: 'The flagship long-form interview on Claude, scaling, safety, and the future.' },
          { title: 'Dario Amodei on why he left OpenAI | Lex Fridman Podcast Clips', url: 'https://www.youtube.com/watch?v=FzkCLR378fE', categories: ['interview'], summary: 'The short version of why he split from OpenAI to start Anthropic.' },
        ],
      },
    ],
  },
  {
    key: 'demis-hassabis',
    label: 'Demis Hassabis',
    tier: 'figure',
    topic: 'ai',
    role: 'CEO, Google DeepMind',
    essay: 'Chess prodigy to games AI to AlphaGo, AlphaFold, and a Nobel Prize. Watch how he fuses neuroscience, games, and science-first research into a route to AGI.',
    searchFocus: 'Long-form interviews and lectures on AGI, AlphaFold, and science',
    resources: [
      {
        title: 'AlphaFold',
        url: 'https://deepmind.google/science/alphafold/',
        source: 'Google DeepMind',
        type: 'official',
        year: 'current',
        value: 'Science-first proof case for AI discovery.',
      },
      {
        title: '2024 Chemistry Nobel press release',
        url: 'https://www.nobelprize.org/uploads/2024/10/press-chemistryprize2024-3.pdf',
        source: 'Nobel Prize',
        type: 'archive',
        year: '2024',
        value: 'Independent recognition of AlphaFold work.',
      },
    ],
    years: [
      {
        key: '2022',
        label: '2022',
        videos: [
          { title: 'Demis Hassabis: DeepMind - AI, Superintelligence & the Future of Humanity | Lex Fridman Podcast #299', url: 'https://www.youtube.com/watch?v=Gfr50f6ZBvo', categories: ['distinctive', 'interview'], summary: 'DeepMind, superintelligence, AlphaFold, and the science of intelligence.' },
        ],
      },
      {
        key: '2025',
        label: '2025',
        videos: [
          { title: 'Demis Hassabis: Future of AI, Simulating Reality, Physics and Video Games | Lex Fridman Podcast #475', url: 'https://www.youtube.com/watch?v=-HzgcbRXUK8', categories: ['distinctive', 'interview'], summary: 'The recent conversation on simulating reality, physics, and the road ahead.' },
        ],
      },
    ],
  },
  {
    key: 'elon-musk',
    label: 'Elon Musk',
    tier: 'figure',
    topic: 'ai',
    role: 'CEO, xAI (also Tesla, SpaceX)',
    essay: 'Co-founded OpenAI, then launched xAI and Grok. Watch his first-principles framing of intelligence and why he broke with OpenAI.',
    searchFocus: 'Long-form interviews on xAI, AGI, and first-principles thinking',
    resources: [
      {
        title: 'xAI company mission',
        url: 'https://x.ai/about',
        source: 'xAI',
        type: 'official',
        year: 'current',
        value: 'Official mission and operating principles.',
      },
      {
        title: 'xAI developer docs',
        url: 'https://docs.x.ai/',
        source: 'xAI',
        type: 'official',
        year: 'current',
        value: 'Current model and API surface.',
      },
    ],
    years: [
      {
        key: '2023',
        label: '2023',
        videos: [
          { title: 'Elon Musk: War, AI, Aliens, Politics, Physics, Video Games, and Humanity | Lex Fridman Podcast #400', url: 'https://www.youtube.com/watch?v=JN3KPFbWCy8', categories: ['distinctive', 'interview'], summary: 'A wide-ranging long-form conversation spanning AI, humanity, and engineering.' },
        ],
      },
      {
        key: '2024',
        label: '2024',
        videos: [
          { title: 'Elon Musk: Will xAI build AGI? | Lex Fridman Podcast', url: 'https://www.youtube.com/watch?v=gwTh4wPQK28', categories: ['interview'], summary: 'On xAI, Grok, and whether they will build AGI.' },
        ],
      },
    ],
  },
  {
    key: 'jordan-peterson',
    label: 'Jordan Peterson',
    searchFocus: 'Maps of Meaning lectures grouped by year',
    years: [
      {
        key: '2015',
        label: '2015',
        videos: [
          { title: 'Maps of Meaning Lecture 01a: Introduction (Part 1)', url: 'https://www.youtube.com/watch?v=4tQOlQRp3gQ', categories: ['distinctive', 'lecture'], summary: 'Course frame: myth, belief, and action.' },
          { title: 'Maps of Meaning Lecture 01b: Introduction (Part 2)', url: 'https://www.youtube.com/watch?v=rM8JsibkrI8', categories: ['lecture'], summary: 'Narrative as the basis of orientation.' },
          { title: 'Maps of Meaning Lecture 02a: Object and Meaning (Part 1)', url: 'https://www.youtube.com/watch?v=mO9LUWs5M60', categories: ['distinctive', 'lecture'], summary: 'Meaning before object perception.' },
          { title: 'Maps of Meaning Lecture 02b: Object and Meaning (Part 2)', url: 'https://www.youtube.com/watch?v=6Rd10PQVsGs', categories: ['lecture'], summary: 'Objects as tools and affordances.' },
          { title: 'Maps of Meaning Lecture 03a: Narrative, Neuropsychology & Mythology I (Part 1)', url: 'https://www.youtube.com/watch?v=6NVY5KdSfQI', categories: ['lecture'], summary: 'Story structure and action.' },
          { title: 'Maps of Meaning Lecture 03b: Narrative, Neuropsychology & Mythology I (Part 2)', url: 'https://www.youtube.com/watch?v=3nAIAPYuD7c', categories: ['lecture'], summary: 'Language, categories, and behavior.' },
          { title: 'Maps of Meaning 04a: Narrative, Neuropsychology & Mythology II (Part 1)', url: 'https://www.youtube.com/watch?v=rlGqUfIgJfc', categories: ['lecture'], summary: 'Mythic patterning deepens.' },
          { title: 'Maps of Meaning 04b: Narrative, Neuropsychology & Mythology II (Part 2)', url: 'https://www.youtube.com/watch?v=YCc-Rk1GPpQ', categories: ['lecture'], summary: 'Neuropsychology meets story.' },
          { title: 'Maps of Meaning 05a: Narrative, Neuropsychology & Mythology III (Part 1)', url: 'https://www.youtube.com/watch?v=Ov5pYNPi358', categories: ['lecture'], summary: 'Narrative and brain integration.' },
          { title: 'Maps of Meaning 05b: Mythology: Enuma Elish (Part 2)', url: 'https://www.youtube.com/watch?v=VJVMtUb-LEY', categories: ['lecture'], summary: 'Order wrested from chaos.' },
          { title: 'Maps of Meaning 06a: Mythology: Introduction (Part 1)', url: 'https://www.youtube.com/watch?v=r_ShAseOvNE', categories: ['lecture'], summary: 'Why myth encodes reality.' },
          { title: 'Maps of Meaning 06b: Mythology: Egyptian Myths (Part 2)', url: 'https://www.youtube.com/watch?v=aI-pET9YD6A', categories: ['lecture'], summary: 'Egyptian symbolic structure.' },
          { title: 'Maps of Meaning 07a: Mythology: Chaos (Part 1)', url: 'https://www.youtube.com/watch?v=44dcUoh0oT4', categories: ['lecture'], summary: 'Chaos as the unknown.' },
          { title: 'Maps of Meaning 07b: Mythology: Chaos (Part 2)', url: 'https://www.youtube.com/watch?v=rnw4SXX7cGY', categories: ['lecture'], summary: 'Encountering disorder.' },
          { title: 'Maps of Meaning 08a: Mythology: The Great Mother (Part 1)', url: 'https://www.youtube.com/watch?v=NOzjfqO6-K8', categories: ['lecture'], summary: 'The maternal archetype.' },
          { title: 'Maps of Meaning 08b: Mythology: The Great Mother (Part 2)', url: 'https://www.youtube.com/watch?v=w1scgquS2mo', categories: ['lecture'], summary: 'The maternal archetype continued.' },
          { title: 'Maps of Meaning 09a: Mythology: The Great Father (Part 1)', url: 'https://www.youtube.com/watch?v=134BCxbMUlU', categories: ['lecture'], summary: 'The paternal order archetype.' },
          { title: 'Maps of Meaning 09b: Mythology: The Great Father (Part 2)', url: 'https://www.youtube.com/watch?v=tIZb0YEcyNo', categories: ['lecture'], summary: 'The paternal archetype continued.' },
          { title: 'Maps of Meaning 10a: Culture & Anomaly (Part 1)', url: 'https://www.youtube.com/watch?v=Bj6HgQBNiZE', categories: ['distinctive', 'lecture'], summary: 'Culture against anomaly.' },
          { title: 'Maps of Meaning 10b: Genesis I (Part 2)', url: 'https://www.youtube.com/watch?v=sJVtAIIHxu0', categories: ['lecture'], summary: 'Creation and order.' },
          { title: 'Maps of Meaning 11a: Genesis II (Part 1)', url: 'https://www.youtube.com/watch?v=Q_2UYIuvDXI', categories: ['lecture'], summary: 'Moral structure in Genesis.' },
          { title: 'Maps of Meaning 11b: Conclusion - The Hero (Part 2)', url: 'https://www.youtube.com/watch?v=G7U9el_yVhI', categories: ['distinctive', 'lecture'], summary: 'Hero synthesis and close.' },
        ],
      },
      {
        key: '2016',
        label: '2016',
        videos: [
          { title: 'Lecture 01: Introduction and Overview', url: 'https://www.youtube.com/watch?v=bjnvtRgpg6g', categories: ['distinctive', 'lecture'], summary: 'Meaning beyond objectivity.' },
          { title: 'Lecture 02: Playable and Non-Playable Games', url: 'https://www.youtube.com/watch?v=RcmWssTLFv0', categories: ['distinctive', 'lecture'], summary: 'Rules, games, and orientation.' },
          { title: 'Lecture 03 Part I: The Basic Story and Its Transformations', url: 'https://www.youtube.com/watch?v=ux6TVYqdN-E', categories: ['lecture'], summary: 'Basic narrative structure.' },
          { title: 'Lecture 03 Part II: The Basic Story and Its Transformations', url: 'https://www.youtube.com/watch?v=DmpUQEDRIKA', categories: ['lecture'], summary: 'Narrative structure continued.' },
          { title: 'Lecture 04: Anomaly', url: 'https://www.youtube.com/watch?v=DjYqkPrCvXQ', categories: ['lecture'], summary: 'What happens when maps fail.' },
          { title: 'Lecture 05 Part I: Anomaly and the Brain', url: 'https://www.youtube.com/watch?v=ZHmklvx9oJ4', categories: ['lecture'], summary: 'Brain basis of anomaly.' },
          { title: 'Lecture 05 Part II: The Brain, Continued', url: 'https://www.youtube.com/watch?v=cFS6fPLQ024', categories: ['lecture'], summary: 'Neural continuation.' },
          { title: 'Lecture 06 Part I: The Primordial Narrative', url: 'https://www.youtube.com/watch?v=mJI0hVV-5Vs', categories: ['lecture'], summary: 'Foundational mythic pattern.' },
          { title: 'Lecture 06 Part II: The Primordial Narrative Continued', url: 'https://www.youtube.com/watch?v=5Q_GIHDpuZw', categories: ['lecture'], summary: 'Primordial narrative continued.' },
          { title: 'Lecture 07 Part I: Osiris, Set, Isis and Horus', url: 'https://www.youtube.com/watch?v=HueFqvz1oDU', categories: ['lecture'], summary: 'The Egyptian myth cycle.' },
          { title: 'Lecture 07 Part II: Osiris, Set, Isis and Horus', url: 'https://www.youtube.com/watch?v=sta4zLcTAII', categories: ['lecture'], summary: 'Egyptian myth continued.' },
          { title: 'Lecture 08 Part I: Hierarchies and Chaos', url: 'https://www.youtube.com/watch?v=PcYLzW1B6cY', categories: ['lecture'], summary: 'Hierarchy as adaptive order.' },
          { title: 'Lecture 09: Genesis', url: 'https://www.youtube.com/watch?v=Gacjj2aCo7Q', categories: ['lecture'], summary: 'Genesis as a map of meaning.' },
          { title: 'Lecture 10: Gautama Buddha, Adam and Eve', url: 'https://www.youtube.com/watch?v=F7T5cg1a77A', categories: ['distinctive', 'lecture'], summary: 'Buddha and Genesis compared.' },
          { title: 'Maps of Meaning Final', url: 'https://www.youtube.com/watch?v=AdAdf4watJQ', categories: ['distinctive', 'lecture'], summary: 'Final synthesis of belief and morality.' },
        ],
      },
      {
        key: '2017',
        label: '2017',
        videos: [
          { title: 'Maps of Meaning 01: Context and Background', url: 'https://www.youtube.com/watch?v=I8Xc2_FtpHI', categories: ['distinctive', 'lecture'], summary: 'Why the meaning problem matters.' },
          { title: 'Maps of Meaning 02: Marionettes & Individuals (Part 1)', url: 'https://www.youtube.com/watch?v=EN2lyN7rM4E', categories: ['lecture'], summary: 'Pinocchio, goals, and agency.' },
          { title: 'Maps of Meaning 03: Marionettes and Individuals (Part 2)', url: 'https://www.youtube.com/watch?v=Us979jCjHu8', categories: ['lecture'], summary: 'Responsibility, deceit, and temptation.' },
          { title: 'Maps of Meaning 04: Marionettes and Individuals (Part 3)', url: 'https://www.youtube.com/watch?v=bV16NEWld8Q', categories: ['lecture'], summary: 'Shadow, naivety, and evil capacity.' },
          { title: 'Maps of Meaning 05: Story and Metastory (Part 1)', url: 'https://www.youtube.com/watch?v=RudKmwzDpNY', categories: ['distinctive', 'lecture'], summary: 'Narrative layers and truth.' },
          { title: 'Maps of Meaning 06: Story and Metastory (Part 2)', url: 'https://www.youtube.com/watch?v=nsZ8XqHPjI4', categories: ['lecture'], summary: 'Story logic continued.' },
          { title: 'Maps of Meaning 07: Images of Story & Metastory', url: 'https://www.youtube.com/watch?v=F3n5qtj89QE', categories: ['lecture'], summary: 'The image layer of story.' },
          { title: 'Maps of Meaning 08: Neuropsychology of Symbolic Representation', url: 'https://www.youtube.com/watch?v=Nb5cBkbQpGY', categories: ['lecture'], summary: 'How symbols map onto brain and action.' },
          { title: 'Maps of Meaning 09: Patterns of Symbolic Representation', url: 'https://www.youtube.com/watch?v=yXZSeiAl4PI', categories: ['lecture'], summary: 'Why symbolic patterns persist.' },
          { title: 'Maps of Meaning 10: Genesis and the Buddha', url: 'https://www.youtube.com/watch?v=7XtEZvLo-Sc', categories: ['distinctive', 'lecture'], summary: 'Genesis beside Buddhist structure.' },
          { title: 'Maps of Meaning 11: The Flood and the Tower', url: 'https://www.youtube.com/watch?v=T4fjSrVCDvA', categories: ['distinctive', 'lecture'], summary: 'Sacrifice, evil, flood, and Babel.' },
          { title: 'Maps of Meaning 12: Final - The Divinity of the Individual', url: 'https://www.youtube.com/watch?v=6V1eMvGGcXQ', categories: ['distinctive', 'lecture'], summary: 'Final synthesis and moral claim.' },
        ],
      },
    ],
  },
  {
    key: 'steve-jobs',
    label: 'Steve Jobs',
    searchFocus: 'Distinctive talks, interviews, and Apple keynotes',
    years: [
      {
        key: '1983',
        label: '1983',
        videos: [
          { title: 'A 28-year-old Steve Jobs Gives a Talk at the 1983 International Design Conference in Aspen', url: 'https://www.youtube.com/watch?v=t9HmOz8H0qI', categories: ['distinctive', 'lecture'], summary: 'Early Jobs on networked personal computing and portable devices.' },
        ],
      },
      {
        key: '1984',
        label: '1984',
        videos: [
          { title: 'Steve Jobs introduces the first Macintosh', url: 'https://www.youtube.com/watch?v=2B-XGouKcxM', categories: ['distinctive', 'keynote'], summary: 'The historic launch of the original Macintosh computer, showcasing graphical interface computing.' },
        ],
      },
      {
        key: '1995',
        label: '1995',
        videos: [
          { title: 'Smithsonian Interview - April 20, 1995', url: 'https://www.youtube.com/watch?v=M6Oxl5dAnR0', categories: ['distinctive', 'interview'], summary: 'Deep oral-history conversation on Apple, NeXT, Pixar, hiring, and the internet.' },
        ],
      },
      {
        key: '1997',
        label: '1997',
        videos: [
          { title: 'Steve Jobs at WWDC 1997', url: 'https://www.youtube.com/watch?v=oeqPrUmVz-o', categories: ['distinctive', 'lecture', 'interview'], summary: 'The iconic unscripted fireside chat wrapping up WWDC, discussing the return to Apple, focus, and "saying no".' },
        ],
      },
      {
        key: '2001',
        label: '2001',
        videos: [
          { title: 'Steve Jobs Introduces the First iPod', url: 'https://www.youtube.com/watch?v=kN0SVBCJqLs', categories: ['distinctive', 'keynote'], summary: 'A foundational product launch focused on simplicity and consequence.' },
        ],
      },
      {
        key: '2005',
        label: '2005',
        videos: [
          { title: 'Steve Jobs\' 2005 Stanford Commencement Address', url: 'https://www.youtube.com/watch?v=UF8uR6Z6KLc', categories: ['distinctive', 'lecture'], summary: 'The canonical talk on connecting the dots, loss, and mortality.' },
        ],
      },
      {
        key: '2007',
        label: '2007',
        videos: [
          { title: 'Steve Jobs Introduces iPhone in 2007', url: 'https://www.youtube.com/watch?v=9hUIxyE2Ns8', categories: ['distinctive', 'keynote'], summary: 'The defining category-creation keynote.' },
          { title: 'Steve Jobs and Bill Gates Together at D5 Conference 2007', url: 'https://www.youtube.com/watch?v=wvhW8cp15tk', categories: ['distinctive', 'interview'], summary: 'A rare long-form conversation between two foundational tech leaders.' },
          { title: 'iPhone Introduction CNBC Interview', url: 'https://www.youtube.com/watch?v=SX1Lz8PDgg8', categories: ['interview'], summary: 'Follow-up interview on the iPhone and the broader market logic behind it.' },
        ],
      },
      {
        key: '2010',
        label: '2010',
        videos: [
          { title: 'Steve Jobs at D8: The Full, Uncut Interview', url: 'https://www.youtube.com/watch?v=7J9U2xVSmos', categories: ['distinctive', 'interview'], summary: 'Late-period Jobs on Google, Adobe, the iPad, competition, and product philosophy.' },
          { title: 'Steve Jobs Introduces the iPad - 2010 (Full)', url: 'https://www.youtube.com/watch?v=zZtWlSDvb_k', categories: ['keynote'], summary: 'The original iPad launch and Jobs\' explanation of the new device category.' },
        ],
      },
      {
        key: '2011',
        label: '2011',
        videos: [
          { title: 'Steve Jobs Secrets of Life', url: 'https://www.youtube.com/watch?v=kYfNvmF0Bqw', categories: ['distinctive', 'interview'], summary: 'A compact archival reflection on work, focus, and what matters.' },
        ],
      },
    ],
  },
  {
    key: 'niles-hollowell-dhar',
    label: 'Niles Hollowell-Dhar / KSHMR',
    searchFocus: 'Interviews, masterclasses, and festival sets rather than music videos',
    years: [
      {
        key: '2010',
        label: '2010',
        videos: [
          { title: 'Recording with The Cataracs', url: 'https://www.youtube.com/watch?v=lyuP1Cd4YK0', categories: ['distinctive'], summary: 'Behind-the-scenes studio footage from the pre-KSHMR era.' },
        ],
      },
      {
        key: '2013',
        label: '2013',
        videos: [
          { title: 'The Cataracs on Heartbeatz Radio w/ DJ Caroline D\'Amore', url: 'https://www.youtube.com/watch?v=9enQdT-nci8', categories: ['interview'], summary: 'Niles on the breakup of The Cataracs and the direction of his solo sound.' },
        ],
      },
      {
        key: '2014',
        label: '2014',
        videos: [
          { title: 'The Producers Conference with KSHMR (The Cataracs)', url: 'https://www.youtube.com/watch?v=gNQj9aEqFSg', categories: ['lecture'], summary: 'An inspiring producer talk focused on creative growth and career mindset.' },
        ],
      },
      {
        key: '2017',
        label: '2017',
        videos: [
          { title: 'KSHMR | Ultra Miami 2017 | Official Video', url: 'https://www.youtube.com/watch?v=VG4VDrAc2bo', categories: ['performance'], summary: 'A flagship early KSHMR festival set.' },
          { title: 'KSHMR Talks About Eminem, Indian Heritage, Spinnin\' Records & More!', url: 'https://www.youtube.com/watch?v=i-rPthf_Znk', categories: ['interview'], summary: 'Identity, heritage, and career development in one high-signal interview.' },
        ],
      },
      {
        key: '2018',
        label: '2018',
        videos: [
          { title: 'KSHMR Interview - Advice for Producers, Indian Background, Revealing Secret Identity', url: 'https://www.youtube.com/watch?v=CUdWm1dfJMQ', categories: ['interview'], summary: 'A strong entry-point interview on advice, identity, and background.' },
          { title: 'KSHMR Studio XL - Full Masterclass from ADE 2018', url: 'https://www.youtube.com/watch?v=-bNTte9dftI', categories: ['lecture'], summary: 'A long-form masterclass with practical workflow insight.' },
        ],
      },
      {
        key: '2019',
        label: '2019',
        videos: [
          { title: 'Back To Back with Willy Joy, Episode 105: KSHMR', url: 'https://www.youtube.com/watch?v=O1IeM_uVXfQ', categories: ['interview'], summary: 'A long-form conversation on work habits, plugins, ghost production, and new music.' },
          { title: 'KSHMR | Tomorrowland Belgium 2019 - W1', url: 'https://www.youtube.com/watch?v=2U29V4MakT4', categories: ['performance'], summary: 'A peak-era Tomorrowland performance.' },
          { title: 'KSHMR Interview at the Berklee College of Music', url: 'https://www.youtube.com/watch?v=JGwWnZ1Rso8', categories: ['interview', 'lecture'], summary: 'A conversation with a stronger educational slant on craft and career.' },
        ],
      },
      {
        key: '2020',
        label: '2020',
        videos: [
          { title: 'KSHMR: Live Ableton Studio Session and Q&A', url: 'https://www.youtube.com/watch?v=g58K4n3GVrk', categories: ['lecture'], summary: 'A production-heavy Ableton session with live Q&A.' },
        ],
      },
      {
        key: '2022',
        label: '2022',
        videos: [
          { title: 'KSHMR | Ultra Miami 2022 | The Live Orchestral Experience', url: 'https://www.youtube.com/watch?v=DhTtsgUUI3Y', categories: ['performance'], summary: 'A standout hybrid orchestral festival show.' },
          { title: 'KSHMR in Kashmir | Official DJ Set', url: 'https://www.youtube.com/watch?v=Xdyiln9Q79c', categories: ['distinctive', 'performance'], summary: 'A uniquely personal set tied directly to his heritage.' },
        ],
      },
      {
        key: '2024',
        label: '2024',
        videos: [
          { title: '#204 KSHMR - Writing for Beyonce, Selena Gomez, Cracking Jokes with Jay Z & Becoming Huge in EDM', url: 'https://www.youtube.com/watch?v=31cFF8eS_fc', categories: ['interview'], summary: 'A detailed career interview on songwriting, scale, and the EDM rise.' },
          { title: 'KSHMR on Ghost Producing, from Pop to EDM, Hit Song vs Sample Pack, Career Advice, Hidden Talent #20', url: 'https://www.youtube.com/watch?v=Ojqk1cdPyOI', categories: ['interview'], summary: 'Long-form career advice and transition stories.' },
          { title: 'KSHMR LIVE AT ULTRA MUSIC FESTIVAL MIAMI 2024 (FULL 4K MAINSTAGE SET)', url: 'https://www.youtube.com/watch?v=xE2k7P8k8Gs', categories: ['performance'], summary: 'A modern large-stage performance entry.' },
        ],
      },
      {
        key: '2025',
        label: '2025',
        videos: [
          { title: 'How KSHMR Creates His Signature Melodies in Ableton (Cook Up)', url: 'https://www.youtube.com/watch?v=qjqHehL1nW0', categories: ['lecture'], summary: 'A melody-focused studio cook-up from Splice.' },
        ],
      },
      {
        key: '2026',
        label: '2026',
        videos: [
          { title: 'KSHMR Gives a Walkthrough of His Iconic LA Studio (Studio Tour)', url: 'https://www.youtube.com/watch?v=RQ7XoytvE18', categories: ['distinctive', 'lecture'], summary: 'A current visual walkthrough of his room, tools, and creative setup.' },
          { title: 'KSHMR Talks Producing for Justin Bieber & Beyonce, Making Sample Packs, and Learning Through Failure', url: 'https://www.youtube.com/watch?v=dW0tqhcAqPE', categories: ['interview'], summary: 'Recent discussion on pop credits, sample packs, and learning through failure.' },
        ],
      },
    ],
  },
];

function normalizeString(value = '') {
  return String(value || '').trim();
}

function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeString(value)).filter(Boolean))];
}

function stripHtml(value = '') {
  return normalizeString(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHistoryTitle(value = '') {
  return stripHtml(value)
    .replace(/^(watched|visited|liked|saved)\s+/i, '')
    .replace(/\s+-\s+YouTube$/i, '')
    .trim();
}

function normalizeHistoryAction(value = '') {
  const text = normalizeString(value).toLowerCase();
  if (/\bliked\b/.test(text)) return 'liked';
  if (/\bsaved\b/.test(text)) return 'saved';
  return 'watched';
}

function pushHistoryPreviewEntry(entries, raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const title = normalizeHistoryTitle(source.title || source.name || source.description || source.titleText || source.text);
  if (!title) {
    return;
  }

  const action = normalizeHistoryAction(`${source.action || ''} ${source.title || ''} ${source.description || ''}`);
  const playCount = Number(source.playCount || source.count || 1);
  entries.push({
    title,
    action,
    playCount: Number.isFinite(playCount) && playCount > 0 ? Math.min(999, Math.round(playCount)) : 1,
    url: normalizeString(source.titleUrl || source.url),
    channel: normalizeString(source.channel || source.owner || source.subtitles?.[0]?.name),
  });
}

function getCreatorOptionMap() {
  return Object.fromEntries(VIDEO_LIBRARY_CREATOR_OPTIONS.map((creator) => [creator.key, creator]));
}

function findCreatorKey(value = '') {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }

  const exact = VIDEO_LIBRARY_CREATOR_OPTIONS.find((creator) => creator.key === normalized);
  if (exact) {
    return exact.key;
  }

  const aliasMatch = VIDEO_LIBRARY_CREATOR_OPTIONS.find((creator) => (
    creator.aliases.some((alias) => normalized.includes(alias))
  ));

  return aliasMatch?.key || '';
}

export function getVideoLibraryCreatorLabel(key = '') {
  return getCreatorOptionMap()[normalizeString(key)]?.label || normalizeString(key);
}

export function getVideoLibraryCategoryLabel(key = '') {
  return VIDEO_LIBRARY_CATEGORY_OPTIONS.find((option) => option.key === normalizeString(key))?.label || normalizeString(key);
}

export function getVideoLibraryResourceTypeLabel(key = '') {
  return VIDEO_LIBRARY_RESOURCE_TYPE_OPTIONS.find((option) => option.key === normalizeString(key))?.label || normalizeString(key);
}

export function getVideoLibraryTopicLabel(key = '') {
  return VIDEO_LIBRARY_TOPIC_OPTIONS.find((option) => option.key === normalizeString(key))?.label || normalizeString(key);
}

export function normalizeVideoCreatorKeys(values = [], fallback = DEFAULT_VIDEO_LIBRARY_PREFERENCES.creators) {
  const normalized = [];

  for (const value of Array.isArray(values) ? values : []) {
    const key = findCreatorKey(value);
    if (key && !normalized.includes(key)) {
      normalized.push(key);
    }
  }

  return normalized.length ? normalized : [...fallback];
}

export function normalizeVideoCategoryKeys(values = [], fallback = DEFAULT_VIDEO_LIBRARY_PREFERENCES.categories) {
  const validKeys = new Set(VIDEO_LIBRARY_CATEGORY_OPTIONS.map((option) => option.key));
  const normalized = normalizeList(values)
    .map((value) => value.toLowerCase())
    .filter((value) => validKeys.has(value));

  return normalized.length ? normalized : [...fallback];
}

export function normalizeVideoLibraryPreferences(value = {}, fallback = DEFAULT_VIDEO_LIBRARY_PREFERENCES) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    creators: normalizeVideoCreatorKeys(source.creators, fallback.creators),
    categories: normalizeVideoCategoryKeys(source.categories, fallback.categories),
    inlinePlayback: source.inlinePlayback !== false,
  };
}

export function detectVideoCreatorKeysFromText(text = '') {
  const normalized = normalizeString(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  return VIDEO_LIBRARY_CREATOR_OPTIONS
    .filter((creator) => creator.aliases.some((alias) => normalized.includes(alias)))
    .map((creator) => creator.key);
}

export function detectVideoCategoryKeysFromText(text = '') {
  const normalized = normalizeString(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  const detected = [];

  if (/\b(distinctive|unique|never replicated|never repeated|rare|iconic)\b/.test(normalized)) {
    detected.push('distinctive');
  }
  if (/\b(interview|conversation|podcast|q&a|q and a)\b/.test(normalized)) {
    detected.push('interview');
  }
  if (/\b(lecture|masterclass|class|talk|teaching|educational|beneficial)\b/.test(normalized)) {
    detected.push('lecture');
  }
  if (/\b(festival|set|live set|performance|tomorrowland|ultra|parookaville|edc)\b/.test(normalized)) {
    detected.push('performance');
  }
  if (/\b(keynote|launch|apple event|presentation)\b/.test(normalized)) {
    detected.push('keynote');
  }

  return detected;
}

export function parseYouTubeFootprintPreview(rawText = '') {
  const text = normalizeString(rawText);
  if (!text) {
    return [];
  }

  const entries = [];
  try {
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.activities)
        ? parsed.activities
        : Array.isArray(parsed?.history)
          ? parsed.history
          : [];

    items.forEach((entry) => {
      pushHistoryPreviewEntry(entries, {
        ...entry,
        action: normalizeHistoryAction(entry?.title || entry?.description || ''),
      });
    });
  } catch {
    const anchorPattern = /(?:Watched|Visited|Liked|Saved)\s*<a[^>]*(?:href="([^"]+)")?[^>]*>(.*?)<\/a>/gi;
    let match = anchorPattern.exec(text);
    while (match) {
      pushHistoryPreviewEntry(entries, {
        title: match[2],
        url: match[1],
        action: normalizeHistoryAction(match[0]),
      });
      match = anchorPattern.exec(text);
    }

    if (!entries.length) {
      text.split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => /\b(watched|visited|liked|saved)\b/i.test(line))
        .forEach((line) => pushHistoryPreviewEntry(entries, {
          title: line,
          action: normalizeHistoryAction(line),
        }));
    }
  }

  const aggregated = new Map();
  entries.forEach((entry) => {
    const key = `${entry.action}:${entry.title.toLowerCase()}`;
    const current = aggregated.get(key) || { ...entry, playCount: 0 };
    current.playCount += entry.playCount * (entry.action === 'liked' || entry.action === 'saved' ? 3 : 1);
    aggregated.set(key, current);
  });

  return [...aggregated.values()]
    .sort((left, right) => right.playCount - left.playCount)
    .slice(0, 50);
}

function tokenOverlap(left = '', right = '') {
  const leftTokens = new Set(normalizeString(left).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const rightTokens = new Set(normalizeString(right).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let hits = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) hits += 1;
  });
  return hits / Math.max(4, Math.min(leftTokens.size, rightTokens.size));
}

export function buildWatchHistoryRecommendationBrief(historyEntries = [], collections = []) {
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  const weightedText = entries
    .slice(0, 30)
    .map((entry) => `${entry.title} ${entry.channel || ''} `.repeat(Math.max(1, Math.min(5, entry.playCount || 1))))
    .join(' ');

  const rankedCollections = (Array.isArray(collections) ? collections : [])
    .map((collection) => {
      const searchable = [
        collection.label,
        collection.topicLabel,
        collection.role,
        collection.essay,
        collection.searchFocus,
        ...(collection.resources || []).map((resource) => `${resource.title} ${resource.value || ''}`),
        ...(collection.years || []).flatMap((year) => (year.videos || []).map((video) => `${video.title} ${video.summary || ''}`)),
      ].join(' ');
      return {
        key: collection.key,
        label: collection.label,
        score: Number(tokenOverlap(weightedText, searchable).toFixed(3)),
        reason: collection.searchFocus || collection.essay || collection.topicLabel || 'Matched by repeated watch signals.',
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const likedCount = entries.filter((entry) => entry.action === 'liked' || entry.action === 'saved').length;
  const topSignals = entries.slice(0, 5).map((entry) => entry.title);

  return {
    hasSignal: entries.length > 0,
    importedCount: entries.length,
    likedCount,
    topSignals,
    rankedCollections,
    explorationRule: likedCount
      ? 'Favor liked signals, then add one surprising adjacent source.'
      : 'Favor repeated watches, then add one surprising adjacent source.',
  };
}

export function buildVideoLibrarySearchProfiles(preferences = {}) {
  const normalized = normalizeVideoLibraryPreferences(preferences);
  const categoryLabels = normalized.categories.map((key) => getVideoLibraryCategoryLabel(key));

  return normalized.creators.map((key) => {
    const creator = VIDEO_LIBRARY_CREATOR_OPTIONS.find((entry) => entry.key === key);
    if (!creator) {
      return null;
    }

    return {
      key: creator.key,
      label: creator.label,
      queryHint: creator.queryHint,
      categoryLabels,
    };
  }).filter(Boolean);
}

export function getYouTubeVideoId(value = '') {
  const text = normalizeString(value);
  if (!text) {
    return '';
  }

  const directMatch = text.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  return /^[A-Za-z0-9_-]{11}$/.test(text) ? text : '';
}

export function buildYouTubeThumbnailUrl(value = '') {
  const videoId = getYouTubeVideoId(value);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
}

export function buildYouTubeEmbedUrl(value = '') {
  const videoId = getYouTubeVideoId(value);
  return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1` : '';
}

function getResourceHost(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeVideoLibraryResource(input, index = 0, ownerLabel = '') {
  const source = typeof input === 'string' ? { url: input } : (input && typeof input === 'object' ? input : null);
  if (!source) {
    return null;
  }

  const url = normalizeString(source.url);
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  const host = getResourceHost(url);
  const type = normalizeString(source.type) || 'context';

  return {
    id: `${slugifyKey(ownerLabel || 'resource')}:resource:${index}:${slugifyKey(source.title || host || url)}`,
    title: normalizeString(source.title) || host || `${ownerLabel || 'Source'} source ${index + 1}`,
    url,
    source: normalizeString(source.source) || host,
    type,
    typeLabel: getVideoLibraryResourceTypeLabel(type),
    year: normalizeString(source.year) || 'current',
    value: normalizeString(source.value || source.summary || source.note),
  };
}

export function normalizeVideoLibraryResources(resources = [], ownerLabel = '') {
  return (Array.isArray(resources) ? resources : [])
    .map((resource, index) => normalizeVideoLibraryResource(resource, index, ownerLabel))
    .filter(Boolean);
}

export function buildCuratedVideoLibrary(preferences = {}) {
  const normalized = normalizeVideoLibraryPreferences(preferences);
  const allowedCreators = new Set(normalized.creators);
  const allowedCategories = new Set(normalized.categories);

  return RAW_CURATED_VIDEO_LIBRARY
    // Figures of interest are curated app content and always show; lower-order
    // creators follow the user's saved creator preferences.
    .filter((creator) => creator.tier === 'figure' || allowedCreators.has(creator.key))
    .map((creator) => {
      const resources = normalizeVideoLibraryResources(creator.resources, creator.label);
      const sourceVideos = creator.years.flatMap((year) => (
        year.videos
          .filter((video) => (
            Array.isArray(video.categories)
              ? video.categories.some((category) => allowedCategories.has(category))
              : true
          ))
          .map((video) => ({ ...video, _sourceYearKey: year.key, _sourceYearLabel: year.label }))
      ));
      const judged = judgeVideoLibraryVideos(sourceVideos, creator);
      const years = creator.years
        .map((year) => {
          const videos = judged.visibleVideos.filter((video) => video._sourceYearKey === year.key);

          return videos.length ? {
            ...year,
            videos,
            videoCount: videos.length,
          } : null;
        })
        .filter(Boolean);

      return years.length || resources.length ? {
        ...creator,
        years,
        resources,
        videoCount: years.reduce((total, year) => total + year.videoCount, 0),
        resourceCount: resources.length,
        hiddenVideoCount: judged.trashVideos.length + judged.duplicateVideos.length,
        duplicateVideoCount: judged.duplicateVideos.length,
        trashVideos: [...judged.trashVideos, ...judged.duplicateVideos],
        qualityRule: 'Best-first, duplicate-free, low-noise videos only.',
      } : null;
    })
    .filter(Boolean);
}

// User-added "figures of interest". Stored locally for now (see VideoLibraryScreen);
// these merge into the curated figures and are grouped under their own topic.
export const USER_FIGURES_STORAGE_KEY = 'explore-user-figures';

function slugifyKey(value = '') {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUserFigureVideo(input, index = 0, figureLabel = '') {
  const source = typeof input === 'string' ? { url: input } : (input && typeof input === 'object' ? input : null);
  if (!source) {
    return null;
  }

  const url = normalizeString(source.url);
  if (!getYouTubeVideoId(url)) {
    return null;
  }

  const categories = Array.isArray(source.categories) && source.categories.length
    ? normalizeList(source.categories)
    : ['interview'];

  return {
    title: normalizeString(source.title) || `${figureLabel || 'Figure'} - clip ${index + 1}`,
    url,
    categories,
    summary: normalizeString(source.summary),
  };
}

export function normalizeUserFigure(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const label = normalizeString(source.label || source.name);
  if (!label) {
    return null;
  }

  const topicLabel = normalizeString(source.topicLabel || source.topic) || 'Figures of interest';

  return {
    key: slugifyKey(source.key || label) || slugifyKey(`figure-${label}`),
    label,
    topic: slugifyKey(source.topicKey || source.topic || topicLabel) || 'other',
    topicLabel,
    role: normalizeString(source.role),
    essay: normalizeString(source.essay),
    resources: normalizeVideoLibraryResources(source.resources, label),
    videos: (Array.isArray(source.videos) ? source.videos : [])
      .map((video, index) => normalizeUserFigureVideo(video, index, label))
      .filter(Boolean),
    userAdded: true,
  };
}

export function normalizeUserFigures(list = []) {
  const seen = new Set();
  const figures = [];

  for (const entry of Array.isArray(list) ? list : []) {
    const figure = normalizeUserFigure(entry);
    if (figure && figure.key && !seen.has(figure.key)) {
      seen.add(figure.key);
      figures.push(figure);
    }
  }

  return figures;
}

// Trash filter: forms a low-value bucket so the main library stays useful.
// Curated library entries are hand-verified (reputable channels only); this guards
// USER-ADDED and future AUTO-DISCOVERED videos: reaction clips, AI-voice/TTS narration,
// clickbait, lifestyle/net-worth fluff, remixes, "status" edits, and fan compilations.
export const VIDEO_LIBRARY_TRASH_TITLE_SIGNALS = [
  /\breaction\b/i, /reacts?\s+to\b/i, /\bai[ -]?voice\b/i, /text[ -]to[ -]speech/i, /\btts\b/i,
  /deepfake/i, /\bwhats\s?app\b/i, /\bstatus\b/i, /\bremix\b/i, /\blyrics?\b/i, /\bslowed\b/i,
  /\bsped\s?up\b/i, /net\s?worth/i, /lifestyle/i, /\brichest\b/i, /\btrillionaire\b/i,
  /you\s?won'?t\s?believe/i, /\bshocking\b/i, /\bexposed\b/i, /gone\s?wrong/i, /\btribute\b/i,
  /\bcompilation\b/i, /fan[ -]?made/i, /\bmotivation(al)?\b/i, /\bedits?\b/i, /\bsigma\b/i,
];

export function isLikelyTrashVideo(video = {}) {
  const title = String(video.title || '');
  if (VIDEO_LIBRARY_TRASH_TITLE_SIGNALS.some((pattern) => pattern.test(title))) {
    return true;
  }
  // Clusters of emoji / clickbait punctuation are a strong low-value signal.
  if (/(?:\p{Extended_Pictographic}\s*){2,}|\u203C\uFE0F|\u{1F525}{2,}/u.test(title)) {
    return true;
  }
  return false;
}

const VIDEO_LIBRARY_CATEGORY_WEIGHTS = {
  distinctive: 26,
  interview: 22,
  lecture: 20,
  speech: 18,
  keynote: 18,
  documentary: 15,
  analysis: 8,
  performance: 4,
};

const VIDEO_LIBRARY_TITLE_SIGNAL_WEIGHTS = [
  [/60\s*minutes|bbc|cnn|frontline|ap archive|world governments summit|official/i, 20, 'trusted source'],
  [/interview|conversation|q&a|question[- ]and[- ]answer|full interview/i, 18, 'direct interview'],
  [/keynote|speech|address|lecture|masterclass|talk/i, 16, 'primary talk'],
  [/documentary|profile|archive|rare|historic|exclusive/i, 12, 'context-rich record'],
  [/future|vision|strategy|governance|leadership|decision|building/i, 10, 'matches study goal'],
];

const VIDEO_LIBRARY_LOW_VALUE_PENALTIES = [
  [/shorts?|clip|snippet|highlights?|trailer/i, 14],
  [/reaction|compilation|tribute|motivation|status|edit|remix|net\s?worth|lifestyle/i, 28],
];

function normalizeVideoIdentity(video = {}) {
  const videoId = getYouTubeVideoId(video.url);
  if (videoId) {
    return `yt:${videoId}`;
  }

  return `title:${normalizeString(video.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

function buildCreatorSignalText(creator = {}) {
  return normalizeList([
    creator.label,
    creator.role,
    creator.searchFocus,
    ...(Array.isArray(creator.aliases) ? creator.aliases : []),
  ]).join(' ').toLowerCase();
}

export function scoreVideoLibraryVideo(video = {}, creator = {}) {
  const title = normalizeString(video.title);
  const summary = normalizeString(video.summary);
  const content = `${title} ${summary}`.toLowerCase();
  const creatorSignals = buildCreatorSignalText(creator);
  const categories = normalizeList(video.categories);
  const reasons = [];
  let score = 40;

  for (const category of categories) {
    const weight = VIDEO_LIBRARY_CATEGORY_WEIGHTS[category] || 0;
    if (weight) {
      score += weight;
    }
  }

  for (const [pattern, weight, reason] of VIDEO_LIBRARY_TITLE_SIGNAL_WEIGHTS) {
    if (pattern.test(content)) {
      score += weight;
      reasons.push(reason);
    }
  }

  for (const [pattern, penalty] of VIDEO_LIBRARY_LOW_VALUE_PENALTIES) {
    if (pattern.test(content)) {
      score -= penalty;
    }
  }

  const labelTokens = normalizeString(creator.label).toLowerCase().split(/\s+/).filter((token) => token.length > 3);
  const directMatchCount = labelTokens.filter((token) => content.includes(token)).length;
  if (directMatchCount >= Math.min(2, labelTokens.length)) {
    score += 18;
    reasons.push('directly about figure');
  } else if (creatorSignals && labelTokens.some((token) => content.includes(token))) {
    score += 8;
    reasons.push('figure match');
  }

  if (summary.length >= 80) {
    score += 8;
    reasons.push('has usable context');
  }

  if (isLikelyTrashVideo(video)) {
    score -= 60;
    reasons.push('noise pattern');
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const uniqueReasons = normalizeList(reasons).slice(0, 3);

  return {
    score: boundedScore,
    label: boundedScore >= 82 ? 'Essential' : boundedScore >= 68 ? 'Strong' : boundedScore >= 52 ? 'Useful' : 'Weak',
    reason: uniqueReasons.length ? uniqueReasons.join(' + ') : 'general relevance',
  };
}

export function judgeVideoLibraryVideos(videos = [], creator = {}) {
  const visibleVideos = [];
  const duplicateVideos = [];
  const trashVideos = [];
  const seen = new Map();

  for (const original of Array.isArray(videos) ? videos : []) {
    const judgment = scoreVideoLibraryVideo(original, creator);
    const video = {
      ...original,
      _qualityScore: judgment.score,
      _qualityLabel: judgment.label,
      _judgment: judgment.reason,
    };
    const identity = normalizeVideoIdentity(video);

    if (!identity || identity === 'title:') {
      trashVideos.push({ ...video, reason: 'Missing a stable video identity.' });
      continue;
    }

    if (isLikelyTrashVideo(video) || judgment.score < 36) {
      trashVideos.push({ ...video, reason: judgment.reason || 'Low-value YouTube noise.' });
      continue;
    }

    if (seen.has(identity)) {
      const keptIndex = seen.get(identity);
      const kept = visibleVideos[keptIndex];
      if ((video._qualityScore || 0) > (kept._qualityScore || 0)) {
        duplicateVideos.push({ ...kept, reason: `Duplicate of ${video.title}.` });
        visibleVideos[keptIndex] = video;
      } else {
        duplicateVideos.push({ ...video, reason: `Duplicate of ${kept.title}.` });
      }
      continue;
    }

    seen.set(identity, visibleVideos.length);
    visibleVideos.push(video);
  }

  visibleVideos.sort((a, b) => (b._qualityScore || 0) - (a._qualityScore || 0));

  return { visibleVideos, duplicateVideos, trashVideos };
}

export function partitionVideosByQuality(videos = []) {
  const valuable = [];
  const trash = [];
  for (const video of Array.isArray(videos) ? videos : []) {
    (isLikelyTrashVideo(video) ? trash : valuable).push(video);
  }
  return { valuable, trash };
}

export function buildUserFigureCollections(list = [], preferences = {}) {
  const normalized = normalizeVideoLibraryPreferences(preferences);
  const allowedCategories = new Set(normalized.categories);

  return normalizeUserFigures(list).map((figure) => {
    const judged = judgeVideoLibraryVideos(figure.videos, figure);
    const visibleVideos = judged.visibleVideos.filter((video) => (
        Array.isArray(video.categories)
          ? video.categories.some((category) => allowedCategories.has(category))
          : true
      ));
    const years = visibleVideos.length
      ? [{ key: 'added', label: 'Added', videos: visibleVideos, videoCount: visibleVideos.length }]
      : [];

    return {
      key: figure.key,
      label: figure.label,
      tier: 'figure',
      topic: figure.topic,
      topicLabel: figure.topicLabel,
      role: figure.role,
      essay: figure.essay,
      resources: figure.resources,
      searchFocus: figure.essay || `Interviews and talks featuring ${figure.label}`,
      userAdded: true,
      years,
      videoCount: years.reduce((total, year) => total + year.videoCount, 0),
      resourceCount: figure.resources.length,
      hiddenVideoCount: Math.max(0, figure.videos.length - visibleVideos.length),
      duplicateVideoCount: judged.duplicateVideos.length,
      trashVideos: [...judged.trashVideos, ...judged.duplicateVideos],
      qualityRule: 'Best-first, duplicate-free, low-noise videos only.',
    };
  });
}

export function buildVideoLibraryGapReport(collection = {}) {
  const years = Array.isArray(collection.years) ? collection.years : [];
  const resources = Array.isArray(collection.resources) ? collection.resources : [];
  const trashVideos = Array.isArray(collection.trashVideos) ? collection.trashVideos : [];
  const videoCount = years.reduce((total, year) => total + (Number(year.videoCount) || (Array.isArray(year.videos) ? year.videos.length : 0)), 0);

  return [
    {
      key: 'videos',
      label: videoCount ? 'Video ready' : 'Video missing',
      status: videoCount ? 'ready' : 'missing',
      detail: videoCount ? `${videoCount} curated videos` : 'Add primary interviews, speeches, or lectures.',
    },
    {
      key: 'texts',
      label: resources.length ? 'Texts ready' : 'Texts missing',
      status: resources.length ? 'ready' : 'missing',
      detail: resources.length ? `${resources.length} source references` : 'Add official texts, essays, or archives.',
    },
    {
      key: 'trash',
      label: trashVideos.length ? 'Noise hidden' : 'Noise guard',
      status: 'watch',
      detail: trashVideos.length ? `${trashVideos.length} duplicate or low-value links hidden` : 'Duplicates and low-value links are filtered before display.',
    },
    {
      key: 'graph',
      label: collection.topic === 'me_leaders' ? 'Graph ready' : 'Graph pending',
      status: collection.topic === 'me_leaders' ? 'ready' : 'missing',
      detail: collection.topic === 'me_leaders' ? 'Country comparison visible below.' : 'Reference-network graph still needs this topic pack.',
    },
  ];
}

export function toVideoLibraryItem(creator = {}, year = {}, video = {}) {
  const categoryLabels = normalizeList(video.categories).map((category) => getVideoLibraryCategoryLabel(category));
  const videoId = getYouTubeVideoId(video.url);

  return {
    id: `library:${creator.key}:${year.key}:${videoId || normalizeString(video.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title: video.title,
    source: `${creator.label} - ${year.label}`,
    creatorKey: creator.key,
    creatorLabel: creator.label,
    yearLabel: year.label,
    url: video.url,
    embedUrl: buildYouTubeEmbedUrl(video.url),
    thumbnail: buildYouTubeThumbnailUrl(video.url),
    summary: video.summary || creator.searchFocus || '',
    reason: video.summary || creator.searchFocus || '',
    date: `${year.key}-01-01`,
    channelType: 'socialVideo',
    libraryVideo: true,
    videoCategories: normalizeList(video.categories),
    videoCategoryLabels: categoryLabels,
    qualityScore: video._qualityScore || 0,
    qualityLabel: video._qualityLabel || 'Useful',
    qualityReason: video._judgment || video.summary || creator.searchFocus || '',
    topics: [creator.label, year.label, ...categoryLabels],
  };
}
