'use client';

import { useState, useMemo } from 'react';
import { ArrowLeftIcon, ExternalLinkIcon } from './Icons';

// ─────────────────────────────────────────────────────────────────────────────
// Nobel Prize data — top 100 prizes spanning all 6 domains, curated by
// historical significance, citation impact, and public influence.
// Each entry includes year, laureate(s), domain, one-sentence significance,
// and a Wikipedia / NobelPrize.org link.
// ─────────────────────────────────────────────────────────────────────────────
const NOBEL_DATA = [
  // PHYSICS
  { id: 'p1921', year: 1921, domain: 'Physics',    laureates: 'Albert Einstein',                           title: 'Theory of the Photoelectric Effect',              blurb: 'Proved light travels in discrete quanta (photons), founding quantum mechanics.',                                   link: 'https://www.nobelprize.org/prizes/physics/1921/einstein/facts/' },
  { id: 'p1903', year: 1903, domain: 'Physics',    laureates: 'Marie & Pierre Curie, Henri Becquerel',      title: 'Discovery of Radioactivity',                      blurb: 'First demonstration that atoms can spontaneously emit energy, opening nuclear physics.',                          link: 'https://www.nobelprize.org/prizes/physics/1903/marie-curie/facts/' },
  { id: 'p1918', year: 1918, domain: 'Physics',    laureates: 'Max Planck',                                title: 'Quantum Theory',                                  blurb: 'Introduced the energy quantum h·ν, resolving the ultraviolet catastrophe and launching quantum theory.',          link: 'https://www.nobelprize.org/prizes/physics/1918/planck/facts/' },
  { id: 'p1933', year: 1933, domain: 'Physics',    laureates: 'Erwin Schrödinger & Paul Dirac',            title: 'Wave Mechanics & Quantum Field Theory',           blurb: 'Formulated the wave equation governing quantum particles and predicted the positron.',                            link: 'https://www.nobelprize.org/prizes/physics/1933/schrodinger/facts/' },
  { id: 'p1965', year: 1965, domain: 'Physics',    laureates: 'Feynman, Schwinger & Tomonaga',             title: 'Quantum Electrodynamics (QED)',                   blurb: 'The most precisely tested theory in science — describes how light and matter interact.',                          link: 'https://www.nobelprize.org/prizes/physics/1965/feynman/facts/' },
  { id: 'p1983', year: 1983, domain: 'Physics',    laureates: 'Subramanyan Chandrasekhar',                 title: 'Stellar Evolution & Black Holes',                 blurb: 'Derived the Chandrasekhar limit defining when a star collapses into a neutron star or black hole.',                link: 'https://www.nobelprize.org/prizes/physics/1983/chandrasekhar/facts/' },
  { id: 'p1993', year: 1993, domain: 'Physics',    laureates: 'Hulse & Taylor',                            title: 'Binary Pulsar & Gravitational Waves',             blurb: 'First indirect proof of gravitational waves by observing orbital decay of a pulsar pair.',                       link: 'https://www.nobelprize.org/prizes/physics/1993/hulse/facts/' },
  { id: 'p2017', year: 2017, domain: 'Physics',    laureates: 'Weiss, Barish & Thorne (LIGO)',             title: 'Direct Detection of Gravitational Waves',         blurb: 'LIGO detected spacetime ripples from merging black holes, confirming Einstein\'s 1916 prediction.',              link: 'https://www.nobelprize.org/prizes/physics/2017/summary/' },
  { id: 'p2019', year: 2019, domain: 'Physics',    laureates: 'Peebles, Mayor & Queloz',                   title: 'Cosmology & Exoplanet Discovery',                 blurb: 'Theoretical cosmology framework and first confirmed exoplanet orbiting a Sun-like star.',                         link: 'https://www.nobelprize.org/prizes/physics/2019/summary/' },
  { id: 'p2022', year: 2022, domain: 'Physics',    laureates: 'Aspect, Clauser & Zeilinger',               title: 'Quantum Entanglement Experiments',                blurb: 'Proved Bell\'s theorem violations, ruling out local hidden-variable theories and enabling quantum cryptography.',  link: 'https://www.nobelprize.org/prizes/physics/2022/summary/' },
  { id: 'p1956', year: 1956, domain: 'Physics',    laureates: 'Bardeen, Brattain & Shockley',              title: 'Invention of the Transistor',                     blurb: 'The transistor underpins every computer, smartphone, and electronic device on Earth.',                            link: 'https://www.nobelprize.org/prizes/physics/1956/bardeen/facts/' },
  { id: 'p2009', year: 2009, domain: 'Physics',    laureates: 'Charles K. Kao',                            title: 'Fiber-Optic Communication',                       blurb: 'Theoretical groundwork for transmitting light through glass fiber, enabling the modern internet.',                link: 'https://www.nobelprize.org/prizes/physics/2009/kao/facts/' },
  { id: 'p1915', year: 1915, domain: 'Physics',    laureates: 'William H. & William L. Bragg',             title: 'X-Ray Crystallography',                           blurb: 'Technique that later revealed DNA\'s double helix and the structure of thousands of proteins.',                   link: 'https://www.nobelprize.org/prizes/physics/1915/wh-bragg/facts/' },
  { id: 'p2024', year: 2024, domain: 'Physics',    laureates: 'John Hopfield & Geoffrey Hinton',           title: 'Foundations of Machine Learning',                 blurb: 'Hopfield networks and backpropagation laid the groundwork for the deep-learning revolution.',                    link: 'https://www.nobelprize.org/prizes/physics/2024/summary/' },

  // CHEMISTRY
  { id: 'c1962', year: 1962, domain: 'Chemistry',  laureates: 'Max Perutz & John Kendrew',                 title: 'Structure of Globular Proteins',                  blurb: 'First 3-D atomic maps of haemoglobin and myoglobin, founding structural biology.',                              link: 'https://www.nobelprize.org/prizes/chemistry/1962/perutz/facts/' },
  { id: 'c1980', year: 1980, domain: 'Chemistry',  laureates: 'Berg, Gilbert & Sanger',                    title: 'DNA Sequencing & Recombinant DNA',                blurb: 'Sanger sequencing and recombinant DNA methods enabled all of modern genomics and biotechnology.',                 link: 'https://www.nobelprize.org/prizes/chemistry/1980/sanger/facts/' },
  { id: 'c1993', year: 1993, domain: 'Chemistry',  laureates: 'Kary Mullis',                               title: 'Polymerase Chain Reaction (PCR)',                 blurb: 'PCR amplifies specific DNA sequences, powering diagnostics, forensics, and COVID-19 testing.',                  link: 'https://www.nobelprize.org/prizes/chemistry/1993/mullis/facts/' },
  { id: 'c2020', year: 2020, domain: 'Chemistry',  laureates: 'Charpentier & Doudna',                      title: 'CRISPR-Cas9 Gene Editing',                        blurb: 'A molecular scissors tool enabling precise genome editing of any living organism.',                               link: 'https://www.nobelprize.org/prizes/chemistry/2020/summary/' },
  { id: 'c1954', year: 1954, domain: 'Chemistry',  laureates: 'Linus Pauling',                             title: 'Nature of the Chemical Bond',                    blurb: 'Explained molecular structure through quantum resonance, shaping chemistry for a generation.',                   link: 'https://www.nobelprize.org/prizes/chemistry/1954/pauling/facts/' },
  { id: 'c2018', year: 2018, domain: 'Chemistry',  laureates: 'Arnold, Smith & Winter',                    title: 'Directed Evolution of Proteins',                  blurb: 'Harnessing Darwinian evolution in test tubes to engineer enzymes used in medicines and fuels.',                  link: 'https://www.nobelprize.org/prizes/chemistry/2018/summary/' },
  { id: 'c2023', year: 2023, domain: 'Chemistry',  laureates: 'Bawendi, Brus & Ekimov',                    title: 'Discovery of Quantum Dots',                       blurb: 'Nanoscale semiconductor crystals whose tunable optical properties drive QLED displays and bioimaging.',          link: 'https://www.nobelprize.org/prizes/chemistry/2023/summary/' },
  { id: 'c2008', year: 2008, domain: 'Chemistry',  laureates: 'Shimomura, Chalfie & Tsien',                title: 'Green Fluorescent Protein (GFP)',                 blurb: 'GFP lets scientists tag and watch any protein glow inside living cells in real time.',                          link: 'https://www.nobelprize.org/prizes/chemistry/2008/shimomura/facts/' },
  { id: 'c2003', year: 2003, domain: 'Chemistry',  laureates: 'Agre & MacKinnon',                          title: 'Water Channels & Ion Channels',                   blurb: 'Revealed how cells selectively pass water and charged ions, crucial for all physiology.',                         link: 'https://www.nobelprize.org/prizes/chemistry/2003/agre/facts/' },
  { id: 'c1911', year: 1911, domain: 'Chemistry',  laureates: 'Marie Curie',                               title: 'Discovery of Radium & Polonium',                  blurb: 'First person to win two Nobels — isolated radium and polonium, pioneering atomic science.',                      link: 'https://www.nobelprize.org/prizes/chemistry/1911/marie-curie/facts/' },
  { id: 'c2001', year: 2001, domain: 'Chemistry',  laureates: 'Knowles, Noyori & Sharpless',               title: 'Asymmetric Catalysis',                            blurb: 'Catalysts that produce only one mirror-image of a molecule — critical for pharmaceutical synthesis.',            link: 'https://www.nobelprize.org/prizes/chemistry/2001/sharpless/facts/' },
  { id: 'c2010', year: 2010, domain: 'Chemistry',  laureates: 'Heck, Negishi & Suzuki',                    title: 'Palladium-Catalyzed Cross-Coupling',              blurb: 'Carbon-coupling reactions that assemble complex organic molecules used in drugs and materials.',                  link: 'https://www.nobelprize.org/prizes/chemistry/2010/heck/facts/' },

  // MEDICINE / PHYSIOLOGY
  { id: 'm1962', year: 1962, domain: 'Medicine',   laureates: 'Watson, Crick & Wilkins',                   title: 'Structure of DNA',                                blurb: 'The double-helix model revealed how genetic information is stored and copied.',                                   link: 'https://www.nobelprize.org/prizes/medicine/1962/watson/facts/' },
  { id: 'm1945', year: 1945, domain: 'Medicine',   laureates: 'Fleming, Chain & Florey',                   title: 'Discovery of Penicillin',                         blurb: 'The first antibiotic; saved hundreds of millions of lives by treating previously fatal infections.',               link: 'https://www.nobelprize.org/prizes/medicine/1945/fleming/facts/' },
  { id: 'm1984', year: 1984, domain: 'Medicine',   laureates: 'Köhler & Milstein',                         title: 'Monoclonal Antibody Technology',                  blurb: 'Method to produce identical antibodies at scale, enabling cancer immunotherapy drugs.',                          link: 'https://www.nobelprize.org/prizes/medicine/1984/kohler/facts/' },
  { id: 'm2018', year: 2018, domain: 'Medicine',   laureates: 'Allison & Honjo',                           title: 'Cancer Immunotherapy (Checkpoint Inhibitors)',     blurb: 'Releasing immune-system brakes to fight cancer — transformed oncology treatment.',                               link: 'https://www.nobelprize.org/prizes/medicine/2018/summary/' },
  { id: 'm2006', year: 2006, domain: 'Medicine',   laureates: 'Fire & Mello',                              title: 'RNA Interference (RNAi)',                          blurb: 'Silencing specific genes with double-stranded RNA, a tool for drug discovery and therapeutics.',                  link: 'https://www.nobelprize.org/prizes/medicine/2006/fire/facts/' },
  { id: 'm2009', year: 2009, domain: 'Medicine',   laureates: 'Blackburn, Greider & Szostak',              title: 'Telomeres & Telomerase',                          blurb: 'Telomeres protect chromosomes; telomerase rebuilds them — key to aging and cancer.',                             link: 'https://www.nobelprize.org/prizes/medicine/2009/blackburn/facts/' },
  { id: 'm2012', year: 2012, domain: 'Medicine',   laureates: 'Yamanaka & Gurdon',                         title: 'Induced Pluripotent Stem Cells (iPSC)',            blurb: 'Reprogramming adult cells back to a stem-cell state without embryo use — revolution in regenerative medicine.',  link: 'https://www.nobelprize.org/prizes/medicine/2012/yamanaka/facts/' },
  { id: 'm2022', year: 2022, domain: 'Medicine',   laureates: 'Svante Pääbo',                              title: 'Discoveries in Extinct Hominin Genetics',         blurb: 'Sequenced Neanderthal and Denisovan DNA, rewriting the history of human evolution.',                             link: 'https://www.nobelprize.org/prizes/medicine/2022/paabo/facts/' },
  { id: 'm2023', year: 2023, domain: 'Medicine',   laureates: 'Karikó & Weissman',                         title: 'mRNA Vaccine Technology',                         blurb: 'Modified mRNA modifications that enabled Pfizer/Moderna COVID-19 vaccines to save millions of lives.',           link: 'https://www.nobelprize.org/prizes/medicine/2023/summary/' },
  { id: 'm1905', year: 1905, domain: 'Medicine',   laureates: 'Robert Koch',                               title: 'Identification of Tuberculosis Bacillus',         blurb: 'Germ theory made concrete: Koch\'s postulates proved bacteria cause specific diseases.',                          link: 'https://www.nobelprize.org/prizes/medicine/1905/koch/facts/' },
  { id: 'm2024', year: 2024, domain: 'Medicine',   laureates: 'Ambros & Ruvkun',                           title: 'Discovery of MicroRNA',                           blurb: 'Tiny RNA molecules that regulate gene expression in all complex organisms, implicated in cancer.',               link: 'https://www.nobelprize.org/prizes/medicine/2024/summary/' },
  { id: 'm1979', year: 1979, domain: 'Medicine',   laureates: 'Cormack & Hounsfield',                      title: 'CT Scan (Computed Tomography)',                   blurb: 'Cross-sectional X-ray imaging transformed diagnosis of cancer, stroke, and trauma.',                            link: 'https://www.nobelprize.org/prizes/medicine/1979/cormack/facts/' },
  { id: 'm2021', year: 2021, domain: 'Medicine',   laureates: 'Julius & Patapoutian',                      title: 'Receptors for Temperature & Touch',               blurb: 'Identified molecular sensors for heat and pressure — insights for pain treatment.',                              link: 'https://www.nobelprize.org/prizes/medicine/2021/julius/facts/' },
  { id: 'm1998', year: 1998, domain: 'Medicine',   laureates: 'Furchgott, Ignarro & Murad',                title: 'Nitric Oxide as a Signalling Molecule',           blurb: 'NO controls blood pressure and led directly to the development of Viagra.',                                      link: 'https://www.nobelprize.org/prizes/medicine/1998/furchgott/facts/' },

  // ECONOMIC SCIENCES
  { id: 'e1969', year: 1969, domain: 'Economics',  laureates: 'Frisch & Tinbergen',                        title: 'Econometrics (First Nobel in Economics)',          blurb: 'Founded quantitative economic analysis and macroeconomic modelling.',                                           link: 'https://www.nobelprize.org/prizes/economic-sciences/1969/frisch/facts/' },
  { id: 'e1974', year: 1974, domain: 'Economics',  laureates: 'Hayek & Myrdal',                            title: 'Theory of Money, Business Cycles & Economic Policy', blurb: 'Opposing views on market coordination vs. planning shaped decades of policy debate.',                          link: 'https://www.nobelprize.org/prizes/economic-sciences/1974/hayek/facts/' },
  { id: 'e1976', year: 1976, domain: 'Economics',  laureates: 'Milton Friedman',                           title: 'Monetarism & Consumption Analysis',               blurb: 'Proved money supply drives inflation, reshaping central-bank thinking worldwide.',                               link: 'https://www.nobelprize.org/prizes/economic-sciences/1976/friedman/facts/' },
  { id: 'e1978', year: 1978, domain: 'Economics',  laureates: 'Herbert Simon',                             title: 'Bounded Rationality & Decision-Making',           blurb: 'Humans satisfice rather than optimise — foundational to behavioural economics and AI.',                         link: 'https://www.nobelprize.org/prizes/economic-sciences/1978/simon/facts/' },
  { id: 'e1994', year: 1994, domain: 'Economics',  laureates: 'Nash, Harsanyi & Selten',                   title: 'Game Theory & Nash Equilibrium',                  blurb: 'Nash equilibrium explains strategic behaviour in markets, negotiations, and biology.',                          link: 'https://www.nobelprize.org/prizes/economic-sciences/1994/nash/facts/' },
  { id: 'e2002', year: 2002, domain: 'Economics',  laureates: 'Daniel Kahneman',                           title: 'Behavioural Economics & Prospect Theory',         blurb: 'People make irrational decisions predictably — reshaped finance, policy, and product design.',                  link: 'https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/' },
  { id: 'e2013', year: 2013, domain: 'Economics',  laureates: 'Fama, Hansen & Shiller',                    title: 'Empirical Analysis of Asset Prices',              blurb: 'Markets are mostly efficient but predictable deviations exist — foundations of modern finance.',                 link: 'https://www.nobelprize.org/prizes/economic-sciences/2013/fama/facts/' },
  { id: 'e2014', year: 2014, domain: 'Economics',  laureates: 'Jean Tirole',                               title: 'Market Power & Regulation',                       blurb: 'Framework for regulating monopolies and oligopolies — applied to Big Tech and banking.',                        link: 'https://www.nobelprize.org/prizes/economic-sciences/2014/tirole/facts/' },
  { id: 'e2019', year: 2019, domain: 'Economics',  laureates: 'Banerjee, Duflo & Kremer',                  title: 'Randomised Trials to Alleviate Poverty',          blurb: 'Field experiments measuring what actually reduces poverty — changed development policy globally.',               link: 'https://www.nobelprize.org/prizes/economic-sciences/2019/banerjee/facts/' },
  { id: 'e2021', year: 2021, domain: 'Economics',  laureates: 'Card, Angrist & Imbens',                    title: 'Causal Inference & Natural Experiments',          blurb: 'Rigorous methods to isolate cause and effect from real-world data, transforming empirical economics.',           link: 'https://www.nobelprize.org/prizes/economic-sciences/2021/card/facts/' },
  { id: 'e2023', year: 2023, domain: 'Economics',  laureates: 'Claudia Goldin',                            title: 'Women\'s Labour Market Outcomes',                 blurb: 'Century-long history of the gender pay gap, revealing its causes and what policies close it.',                  link: 'https://www.nobelprize.org/prizes/economic-sciences/2023/goldin/facts/' },
  { id: 'e1987', year: 1987, domain: 'Economics',  laureates: 'Robert Solow',                              title: 'Theory of Economic Growth',                       blurb: 'Proved that technological progress, not capital alone, drives long-run GDP growth.',                            link: 'https://www.nobelprize.org/prizes/economic-sciences/1987/solow/facts/' },

  // LITERATURE
  { id: 'l1913', year: 1913, domain: 'Literature', laureates: 'Rabindranath Tagore',                       title: 'Gitanjali — Song Offerings',                      blurb: 'First non-European Nobel laureate; bridged Eastern spirituality and Western literary tradition.',               link: 'https://www.nobelprize.org/prizes/literature/1913/tagore/facts/' },
  { id: 'l1949', year: 1949, domain: 'Literature', laureates: 'William Faulkner',                          title: 'The Sound and the Fury / As I Lay Dying',         blurb: 'Stream-of-consciousness innovator who transformed the American novel.',                                         link: 'https://www.nobelprize.org/prizes/literature/1949/faulkner/facts/' },
  { id: 'l1954', year: 1954, domain: 'Literature', laureates: 'Ernest Hemingway',                          title: 'The Old Man and the Sea',                         blurb: 'Spare prose style and existential themes made Hemingway a defining 20th-century voice.',                       link: 'https://www.nobelprize.org/prizes/literature/1954/hemingway/facts/' },
  { id: 'l1958', year: 1958, domain: 'Literature', laureates: 'Boris Pasternak',                           title: 'Doctor Zhivago',                                  blurb: 'Forced to decline by Soviet authorities; the prize itself became a protest against censorship.',                link: 'https://www.nobelprize.org/prizes/literature/1958/pasternak/facts/' },
  { id: 'l1962', year: 1962, domain: 'Literature', laureates: 'John Steinbeck',                            title: 'The Grapes of Wrath / East of Eden',              blurb: 'Gave voice to the dispossessed — enduring chronicles of the American working class.',                           link: 'https://www.nobelprize.org/prizes/literature/1962/steinbeck/facts/' },
  { id: 'l1982', year: 1982, domain: 'Literature', laureates: 'Gabriel García Márquez',                    title: 'One Hundred Years of Solitude',                   blurb: 'Magical realism masterpiece; made Latin American literature a world force.',                                    link: 'https://www.nobelprize.org/prizes/literature/1982/garcia_marquez/facts/' },
  { id: 'l1993', year: 1993, domain: 'Literature', laureates: 'Toni Morrison',                             title: 'Beloved / Song of Solomon',                       blurb: 'Unflinching portrayal of slavery\'s psychological legacy; first Black American woman to win.',                 link: 'https://www.nobelprize.org/prizes/literature/1993/morrison/facts/' },
  { id: 'l2005', year: 2005, domain: 'Literature', laureates: 'Harold Pinter',                             title: 'The Birthday Party / Betrayal',                   blurb: 'Theatre of menace and political dissent; reshaped modern drama and public speech.',                            link: 'https://www.nobelprize.org/prizes/literature/2005/pinter/facts/' },
  { id: 'l2016', year: 2016, domain: 'Literature', laureates: 'Bob Dylan',                                 title: 'Like a Rolling Stone / Blowin\' in the Wind',     blurb: 'First musician awarded the Prize; recognised poetry in popular song as literature.',                           link: 'https://www.nobelprize.org/prizes/literature/2016/dylan/facts/' },
  { id: 'l2021', year: 2021, domain: 'Literature', laureates: 'Abdulrazak Gurnah',                         title: 'By the Sea / Paradise',                           blurb: 'Unflinching depictions of colonialism and refugee experience in East Africa.',                                  link: 'https://www.nobelprize.org/prizes/literature/2021/gurnah/facts/' },
  { id: 'l2024', year: 2024, domain: 'Literature', laureates: 'Han Kang',                                  title: 'The Vegetarian / The White Book',                 blurb: 'First South Korean laureate; hauntingly poetic prose confronting historical trauma and bodily fragility.',     link: 'https://www.nobelprize.org/prizes/literature/2024/han/facts/' },

  // PEACE
  { id: 'pe1906', year: 1906, domain: 'Peace',     laureates: 'Theodore Roosevelt',                        title: 'Portsmouth Treaty — End of Russo-Japanese War',  blurb: 'First US president to win; mediated a major war and established American diplomacy.',                           link: 'https://www.nobelprize.org/prizes/peace/1906/roosevelt/facts/' },
  { id: 'pe1964', year: 1964, domain: 'Peace',     laureates: 'Martin Luther King Jr.',                    title: 'Civil Rights Movement',                           blurb: 'Nonviolent resistance transformed racial equality in the US and inspired global movements.',                    link: 'https://www.nobelprize.org/prizes/peace/1964/king/facts/' },
  { id: 'pe1979', year: 1979, domain: 'Peace',     laureates: 'Mother Teresa',                             title: 'Humanitarian Work Among the Poor',                blurb: 'Decades of care for the destitute and dying in Calcutta became a global symbol of compassion.',               link: 'https://www.nobelprize.org/prizes/peace/1979/teresa/facts/' },
  { id: 'pe1993', year: 1993, domain: 'Peace',     laureates: 'Mandela & de Klerk',                        title: 'End of Apartheid in South Africa',                blurb: 'Peaceful transition from apartheid to democracy — one of the 20th century\'s greatest reconciliations.',       link: 'https://www.nobelprize.org/prizes/peace/1993/mandela/facts/' },
  { id: 'pe2005', year: 2005, domain: 'Peace',     laureates: 'IAEA & Mohamed ElBaradei',                  title: 'Nuclear Non-Proliferation Efforts',               blurb: 'Preventing the spread of nuclear weapons through inspection and diplomacy.',                                    link: 'https://www.nobelprize.org/prizes/peace/2005/iaea/facts/' },
  { id: 'pe2014', year: 2014, domain: 'Peace',     laureates: 'Malala Yousafzai & Kailash Satyarthi',      title: 'Children\'s Rights to Education',                blurb: 'Youngest-ever laureate; advocated girls\' education after surviving a Taliban assassination attempt.',          link: 'https://www.nobelprize.org/prizes/peace/2014/yousafzai/facts/' },
  { id: 'pe2022', year: 2022, domain: 'Peace',     laureates: 'Bialiatski, Memorial & CCRL',               title: 'Human Rights in Russia, Belarus & Ukraine',      blurb: 'Civil society organisations documenting state violence at enormous personal risk.',                             link: 'https://www.nobelprize.org/prizes/peace/2022/bialiatski/facts/' },
  { id: 'pe2023', year: 2023, domain: 'Peace',     laureates: 'Narges Mohammadi',                          title: 'Fight Against Oppression of Women in Iran',       blurb: 'Imprisoned activist whose award amplified global attention on Iran\'s women-led uprising.',                     link: 'https://www.nobelprize.org/prizes/peace/2023/mohammadi/facts/' },
  { id: 'pe1952', year: 1952, domain: 'Peace',     laureates: 'Albert Schweitzer',                         title: 'Humanitarian Work in Africa',                     blurb: 'Physician-theologian who built a hospital in Gabon and championed reverence for life.',                        link: 'https://www.nobelprize.org/prizes/peace/1952/schweitzer/facts/' },
  { id: 'pe1989', year: 1989, domain: 'Peace',     laureates: 'Dalai Lama',                                title: 'Nonviolent Struggle for Tibet',                   blurb: 'Decades of nonviolent advocacy for Tibetan autonomy and global promotion of compassion.',                       link: 'https://www.nobelprize.org/prizes/peace/1989/dalai-lama/facts/' },
  { id: 'pe2024', year: 2024, domain: 'Peace',     laureates: 'Nihon Hidankyo',                            title: 'Hiroshima & Nagasaki Survivors\' Testimony',      blurb: 'Grassroots movement of atomic bomb survivors working for a nuclear-free world.',                               link: 'https://www.nobelprize.org/prizes/peace/2024/nihon-hidankyo/facts/' },

  // Extra entries to reach 100
  { id: 'p1914', year: 1914, domain: 'Physics',    laureates: 'Max von Laue',                              title: 'X-Ray Diffraction in Crystals',                   blurb: 'Proved X-rays are electromagnetic waves and opened a new window on atomic structure.',                         link: 'https://www.nobelprize.org/prizes/physics/1914/laue/facts/' },
  { id: 'p1929', year: 1929, domain: 'Physics',    laureates: 'Louis de Broglie',                          title: 'Wave Nature of Electrons',                        blurb: 'Matter has wave properties — the de Broglie relation is central to quantum mechanics.',                         link: 'https://www.nobelprize.org/prizes/physics/1929/de-broglie/facts/' },
  { id: 'p1932', year: 1932, domain: 'Physics',    laureates: 'Werner Heisenberg',                         title: 'Uncertainty Principle & Matrix Mechanics',        blurb: 'Fundamental limit on simultaneously knowing position and momentum — reshaping physical reality.',               link: 'https://www.nobelprize.org/prizes/physics/1932/heisenberg/facts/' },
  { id: 'p2014', year: 2014, domain: 'Physics',    laureates: 'Akasaki, Amano & Nakamura',                 title: 'Blue LED',                                        blurb: 'The missing colour enabling white LEDs — today 25 % of global electricity is saved by LED lighting.',           link: 'https://www.nobelprize.org/prizes/physics/2014/akasaki/facts/' },
  { id: 'c1944', year: 1944, domain: 'Chemistry',  laureates: 'Otto Hahn',                                 title: 'Discovery of Nuclear Fission',                    blurb: 'Splitting the uranium atom released atomic energy and triggered both nuclear power and weapons.',                link: 'https://www.nobelprize.org/prizes/chemistry/1944/hahn/facts/' },
  { id: 'c1963', year: 1963, domain: 'Chemistry',  laureates: 'Ziegler & Natta',                           title: 'Polymerisation of Plastics',                      blurb: 'Catalysts for producing polypropylene and polyethylene — foundations of the plastics industry.',               link: 'https://www.nobelprize.org/prizes/chemistry/1963/ziegler/facts/' },
  { id: 'c1996', year: 1996, domain: 'Chemistry',  laureates: 'Curl, Kroto & Smalley',                     title: 'Discovery of Buckminsterfullerene (C₆₀)',         blurb: 'Carbon cages opened nanotechnology and led to carbon nanotubes and graphene research.',                         link: 'https://www.nobelprize.org/prizes/chemistry/1996/curl/facts/' },
  { id: 'c2004', year: 2004, domain: 'Chemistry',  laureates: 'Aaron Ciechanover, Avram Hershko & Irwin Rose', title: 'Ubiquitin-Mediated Protein Degradation',      blurb: 'The cell\'s internal waste-disposal system is central to cancer, neurodegenerative and immune diseases.',    link: 'https://www.nobelprize.org/prizes/chemistry/2004/ciechanover/facts/' },
  { id: 'c2016', year: 2016, domain: 'Chemistry',  laureates: 'Sauvage, Stoddart & Feringa',               title: 'Design and Synthesis of Molecular Machines',     blurb: 'Mechanical devices at the nanoscale — the world\'s smallest motors and switches.',                            link: 'https://www.nobelprize.org/prizes/chemistry/2016/sauvage/facts/' },
  { id: 'm1953', year: 1953, domain: 'Medicine',   laureates: 'Hans Krebs',                                title: 'Citric Acid Cycle (Krebs Cycle)',                 blurb: 'The metabolic engine powering virtually every aerobic organism on Earth.',                                     link: 'https://www.nobelprize.org/prizes/medicine/1953/krebs/facts/' },
  { id: 'm1958', year: 1958, domain: 'Medicine',   laureates: 'George Beadle & Edward Tatum',              title: 'One Gene — One Enzyme Hypothesis',                blurb: 'Established that genes control metabolic chemistry — the dawn of molecular biology.',                          link: 'https://www.nobelprize.org/prizes/medicine/1958/beadle/facts/' },
  { id: 'm1973', year: 1973, domain: 'Medicine',   laureates: 'Lorenz, Tinbergen & von Frisch',            title: 'Animal Behaviour (Ethology)',                     blurb: 'Imprinting, honeybee dance, and stimulus-response patterns established modern behavioural biology.',            link: 'https://www.nobelprize.org/prizes/medicine/1973/lorenz/facts/' },
  { id: 'm2015', year: 2015, domain: 'Medicine',   laureates: 'Campbell, Ōmura & Tu Youyou',               title: 'Therapies Against Parasitic Diseases',            blurb: 'Ivermectin and artemisinin save millions of lives annually from river blindness and malaria.',                 link: 'https://www.nobelprize.org/prizes/medicine/2015/campbell/facts/' },
  { id: 'm2017', year: 2017, domain: 'Medicine',   laureates: 'Hall, Rosbash & Young',                     title: 'Molecular Mechanisms of Circadian Rhythms',      blurb: 'Identified the clock genes governing sleep, metabolism, and disease risk in nearly all life forms.',             link: 'https://www.nobelprize.org/prizes/medicine/2017/hall/facts/' },
  { id: 'm2020', year: 2020, domain: 'Medicine',   laureates: 'Alter, Houghton & Rice',                    title: 'Discovery of Hepatitis C Virus',                  blurb: 'Led to curative therapies that eliminate HCV from 95% of patients within 8 weeks.',                           link: 'https://www.nobelprize.org/prizes/medicine/2020/alter/facts/' },
  { id: 'e1998', year: 1998, domain: 'Economics',  laureates: 'Amartya Sen',                               title: 'Welfare Economics & Social Choice Theory',        blurb: 'Human capabilities, not just income, define development — reshaped the UN Human Development Index.',           link: 'https://www.nobelprize.org/prizes/economic-sciences/1998/sen/facts/' },
  { id: 'e2001', year: 2001, domain: 'Economics',  laureates: 'Akerlof, Spence & Stiglitz',                title: 'Markets with Asymmetric Information',             blurb: 'The "market for lemons" and signalling theory explain insurance, credit, and job markets.',                    link: 'https://www.nobelprize.org/prizes/economic-sciences/2001/akerlof/facts/' },
  { id: 'e2003', year: 2003, domain: 'Economics',  laureates: 'Engle & Granger',                           title: 'Time-Series Analysis & ARCH Models',             blurb: 'ARCH models capture volatility clustering — standard tools in every financial risk model today.',              link: 'https://www.nobelprize.org/prizes/economic-sciences/2003/engle/facts/' },
  { id: 'e2010', year: 2010, domain: 'Economics',  laureates: 'Diamond, Mortensen & Pissarides',           title: 'Search-and-Matching Theory of Labour Markets',   blurb: 'Why unemployment persists even when vacancies are open — foundations of labour-market policy.',               link: 'https://www.nobelprize.org/prizes/economic-sciences/2010/diamond/facts/' },
  { id: 'l1925', year: 1925, domain: 'Literature', laureates: 'George Bernard Shaw',                       title: 'Saint Joan / Pygmalion / Major Barbara',          blurb: 'Witty social criticism via theatre; Pygmalion became My Fair Lady.',                                           link: 'https://www.nobelprize.org/prizes/literature/1925/shaw/facts/' },
  { id: 'l1953', year: 1953, domain: 'Literature', laureates: 'Winston Churchill',                         title: 'Historical Writing & Speeches',                   blurb: 'Awarded for his mastery of historical description and brilliant oratory — unique in Prize history.',            link: 'https://www.nobelprize.org/prizes/literature/1953/churchill/facts/' },
  { id: 'l1969', year: 1969, domain: 'Literature', laureates: 'Samuel Beckett',                            title: 'Waiting for Godot / Endgame',                     blurb: 'Theatre of the absurd; spare language exploring existential meaninglessness.',                                  link: 'https://www.nobelprize.org/prizes/literature/1969/beckett/facts/' },
  { id: 'l2000', year: 2000, domain: 'Literature', laureates: 'Gao Xingjian',                              title: 'Soul Mountain',                                   blurb: 'First Chinese-language laureate; blended prose, poetry, and drama into a new literary form.',                  link: 'https://www.nobelprize.org/prizes/literature/2000/gao/facts/' },
  { id: 'pe1919', year: 1919, domain: 'Peace',     laureates: 'Woodrow Wilson',                            title: 'League of Nations',                               blurb: 'Founded the world\'s first international peacekeeping body — forerunner of the United Nations.',              link: 'https://www.nobelprize.org/prizes/peace/1919/wilson/facts/' },
  { id: 'pe1935', year: 1935, domain: 'Peace',     laureates: 'Carl von Ossietzky',                        title: 'Pacifism Against Nazi Rearmament',                blurb: 'Awarded while imprisoned by the Nazis; the prize provoked Hitler to ban Germans from future prizes.',          link: 'https://www.nobelprize.org/prizes/peace/1935/ossietzky/facts/' },
  { id: 'pe2003', year: 2003, domain: 'Peace',     laureates: 'Shirin Ebadi',                              title: 'Human Rights & Democracy in Iran',                blurb: 'First Muslim woman to win the Peace Prize; continued advocacy from exile.',                                    link: 'https://www.nobelprize.org/prizes/peace/2003/ebadi/facts/' },
  { id: 'pe2015', year: 2015, domain: 'Peace',     laureates: 'Tunisian National Dialogue Quartet',        title: 'Tunisian Democratic Transition',                  blurb: 'Civil society groups guided Tunisia through the Arab Spring to a functioning democracy.',                      link: 'https://www.nobelprize.org/prizes/peace/2015/national-dialogue-quartet/facts/' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Domain meta — colour, emoji, description
// ─────────────────────────────────────────────────────────────────────────────
const DOMAIN_META = {
  Physics:    { emoji: '⚛️',  color: '#531DAB', bg: 'rgba(83,29,171,0.08)',  desc: 'Fundamental laws governing matter, energy, space, and time.' },
  Chemistry:  { emoji: '🧪',  color: '#7C4300', bg: 'rgba(124,67,0,0.08)',   desc: 'Molecular structure, reactions, and materials at the atomic scale.' },
  Medicine:   { emoji: '🩺',  color: '#B00E52', bg: 'rgba(176,14,82,0.08)',   desc: 'Discoveries that transformed our understanding of life and disease.' },
  Economics:  { emoji: '📊',  color: '#804A00', bg: 'rgba(128,74,0,0.08)',   desc: 'Models of human behaviour, markets, and resource allocation.' },
  Literature: { emoji: '📖',  color: '#5821B6', bg: 'rgba(88,33,182,0.08)',   desc: 'Works of outstanding literary merit that enriched human culture.' },
  Peace:      { emoji: '🕊️', color: '#9D174D', bg: 'rgba(157,23,77,0.08)',   desc: 'Efforts to reduce conflict and advance human rights worldwide.' },
};

const ALL_DOMAINS = Object.keys(DOMAIN_META);
const YEAR_MIN = 1900;
const YEAR_MAX = new Date().getFullYear();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function sortPrizes(prizes, sort) {
  return [...prizes].sort((a, b) => {
    if (sort === 'year-asc') return a.year - b.year;
    if (sort === 'year-desc') return b.year - a.year;
    if (sort === 'domain') return a.domain.localeCompare(b.domain) || b.year - a.year;
    return b.year - a.year;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function DomainPill({ domain, active, onClick, count }) {
  const meta = DOMAIN_META[domain] || {
    emoji: '🏆',
    color: '#8E8E93',
    bg: 'rgba(142,142,147,0.08)'
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`np-domain-pill ${active ? 'np-domain-pill--active' : ''}`}
      style={active ? { '--pill-color': meta.color, '--pill-bg': meta.bg } : {}}
    >
      <span className="np-domain-pill-emoji">{meta.emoji}</span>
      <span className="np-domain-pill-label">{domain}</span>
      <span className="np-domain-pill-count">{count}</span>
    </button>
  );
}

function PrizeCard({ prize, onAskAi }) {
  const meta = DOMAIN_META[prize.domain] || DOMAIN_META.Physics;
  return (
    <article className="np-card">
      {/* Colour accent line */}
      <div className="np-card-accent" style={{ background: meta.color }} />

      <div className="np-card-body">
        {/* Header row */}
        <div className="np-card-header">
          <div className="np-card-domain-badge" style={{ color: meta.color, background: meta.bg }}>
            <span>{meta.emoji}</span>
            <span>{prize.domain}</span>
          </div>
          <span className="np-card-year">{prize.year}</span>
        </div>

        {/* Title */}
        <h3 className="np-card-title">{prize.title}</h3>

        {/* Laureates */}
        <p className="np-card-laureates">{prize.laureates}</p>

        {/* Significance blurb */}
        <p className="np-card-blurb">{prize.blurb}</p>

        {/* Actions */}
        <div className="np-card-actions">
          <a
            href={prize.link}
            target="_blank"
            rel="noopener noreferrer"
            className="np-card-link-btn"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLinkIcon size={14} />
            Nobel Prize page
          </a>
          {typeof onAskAi === 'function' && (
            <button
              type="button"
              className="np-card-ai-btn"
              onClick={() => onAskAi({
                title: `Nobel Prize in ${prize.domain} ${prize.year}: ${prize.title}`,
                summary: `${prize.laureates} — ${prize.blurb}`,
                source: 'NobelPrize.org',
                url: prize.link,
              })}
            >
              ✦ Ask AI
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function NobelPrizesScreen({ onBack, onAskAi }) {
  const [activeDomain, setActiveDomain] = useState('All');
  const [sort, setSort] = useState('year-desc');
  const [search, setSearch] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo]   = useState('');

  const filtered = useMemo(() => {
    let list = NOBEL_DATA;

    // Domain filter
    if (activeDomain !== 'All') {
      list = list.filter((p) => p.domain === activeDomain);
    }

    // Year range
    const from = Number(yearFrom) || YEAR_MIN;
    const to   = Number(yearTo)   || YEAR_MAX;
    list = list.filter((p) => p.year >= from && p.year <= to);

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.laureates.toLowerCase().includes(q) ||
        p.blurb.toLowerCase().includes(q) ||
        String(p.year).includes(q)
      );
    }

    return sortPrizes(list, sort);
  }, [activeDomain, sort, search, yearFrom, yearTo]);

  const domainCounts = useMemo(() => {
    const map = { All: NOBEL_DATA.length };
    for (const domain of ALL_DOMAINS) {
      map[domain] = NOBEL_DATA.filter((p) => p.domain === domain).length;
    }
    return map;
  }, []);

  return (
    <div className="page-enter np-screen">
      {/* ── Page header ── */}
      <div className="np-hero">
        <div className="container">
          <div className="np-hero-inner">
            <button
              type="button"
              className="btn-icon btn-ghost"
              onClick={onBack}
              aria-label="Back"
              style={{ flexShrink: 0, marginTop: '6px' }}
            >
              <ArrowLeftIcon size={22} />
            </button>
            <div className="np-hero-copy">
              <span className="page-kicker">Nobel Prize Archive</span>
              <h1 className="np-hero-title">Top 100 Nobel Prizes</h1>
              <p className="page-subtitle">
                The most impactful discoveries and contributions across Physics, Chemistry, Medicine, Economics, Literature, and Peace — from 1901 to today.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container np-content">

        {/* ── Domain filter pills ── */}
        <div className="np-domain-row">
          <DomainPill
            domain="All"
            active={activeDomain === 'All'}
            count={domainCounts['All']}
            onClick={() => setActiveDomain('All')}
          />
          {ALL_DOMAINS.map((d) => (
            <DomainPill
              key={d}
              domain={d}
              active={activeDomain === d}
              count={domainCounts[d]}
              onClick={() => setActiveDomain(d)}
            />
          ))}
        </div>

        {/* ── Domain info banner ── */}
        {activeDomain !== 'All' && (
          <div className="np-domain-banner" style={{
            borderColor: DOMAIN_META[activeDomain]?.color,
            background: DOMAIN_META[activeDomain]?.bg,
          }}>
            <span className="np-domain-banner-emoji">{DOMAIN_META[activeDomain]?.emoji}</span>
            <div>
              <strong style={{ color: DOMAIN_META[activeDomain]?.color }}>{activeDomain}</strong>
              <p className="np-domain-banner-desc">{DOMAIN_META[activeDomain]?.desc}</p>
            </div>
          </div>
        )}

        {/* ── Search + sort + year row ── */}
        <div className="np-toolbar">
          <div className="search-bar np-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="search-icon">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Search laureates, title, keyword…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search prizes"
            />
          </div>

          <div className="np-toolbar-controls">
            <div className="np-year-range">
              <input
                type="number"
                className="np-year-input"
                placeholder="From"
                min={YEAR_MIN}
                max={YEAR_MAX}
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value)}
                aria-label="Year from"
              />
              <span className="np-year-sep">–</span>
              <input
                type="number"
                className="np-year-input"
                placeholder="To"
                min={YEAR_MIN}
                max={YEAR_MAX}
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value)}
                aria-label="Year to"
              />
            </div>

            <select
              className="np-sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort order"
            >
              <option value="year-desc">Newest first</option>
              <option value="year-asc">Oldest first</option>
              <option value="domain">By domain</option>
            </select>
          </div>
        </div>

        {/* ── Results count ── */}
        <div className="np-results-bar">
          <span className="np-results-count">
            {filtered.length} prize{filtered.length !== 1 ? 's' : ''} shown
            {search ? ` for "${search}"` : ''}
          </span>
          {(search || yearFrom || yearTo || activeDomain !== 'All') && (
            <button
              type="button"
              className="np-clear-btn"
              onClick={() => { setSearch(''); setYearFrom(''); setYearTo(''); setActiveDomain('All'); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ── Card grid ── */}
        {filtered.length ? (
          <div className="np-grid">
            {filtered.map((prize) => (
              <PrizeCard key={prize.id} prize={prize} onAskAi={onAskAi} />
            ))}
          </div>
        ) : (
          <div className="premium-empty-card">
            <span className="premium-empty-card-icon">🔍</span>
            <h3 className="premium-empty-card-title">No prizes match your filters.</h3>
            <p className="premium-empty-card-desc">Try a different domain, year range, or search term.</p>
          </div>
        )}

      </div>
    </div>
  );
}
