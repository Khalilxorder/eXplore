'use client';

// Sourced "state of success" indicators for the Middle East leaders' countries.
// Most-recent reputable values (IMF World Economic Outlook, World Bank Open Data,
// UNDP Human Development Report 2025), 2024 unless noted. Ordered by GDP per capita (PPP).
export const MIDDLE_EAST_SUCCESS = [
  {
    country: 'Qatar',
    leaderKey: 'tamim-bin-hamad',
    gdpPerCapitaPppUsd: 126110,
    gdpNominalUsdBillions: 220,
    hdi: 0.886,
    lifeExpectancyYears: 82.4,
    populationMillions: 3.12,
    year: '2024',
    summary: "Among the world's wealthiest per capita; very high human development, with LNG (North Field) expansion driving ~4.75% medium-term growth.",
  },
  {
    country: 'Saudi Arabia',
    leaderKey: 'mohammed-bin-salman',
    gdpPerCapitaPppUsd: 71243,
    gdpNominalUsdBillions: 1100,
    hdi: 0.9,
    lifeExpectancyYears: 78.7,
    populationMillions: 34.57,
    year: '2024',
    summary: 'Very high human development, upper-income; Vision 2030 diversification with the IMF projecting ~4% real growth for 2025-2026.',
  },
  {
    country: 'United Arab Emirates',
    leaderKey: 'mohamed-bin-zayed',
    gdpPerCapitaPppUsd: 69702,
    gdpNominalUsdBillions: 545,
    hdi: 0.94,
    lifeExpectancyYears: 82.9,
    populationMillions: 11,
    year: '2024',
    summary: '15th on the 2025 UNDP HDI (the only Arab country in the top 20); ~4-5% growth as it diversifies into finance, AI, logistics, and tourism.',
  },
  {
    country: 'Iraq',
    leaderKey: 'saddam-hussein',
    gdpPerCapitaPppUsd: 14464,
    gdpNominalUsdBillions: 279.6,
    hdi: 0.695,
    lifeExpectancyYears: 72.4,
    populationMillions: 46.1,
    year: '2024',
    summary: 'Gradual recovery (+4% nominal GDP in 2024) and improving human development, but heavily oil-dependent and exposed to political instability.',
  },
];

// Metrics rendered as comparative bars (each scaled to the row's max).
export const MIDDLE_EAST_SUCCESS_METRICS = [
  { key: 'gdpPerCapitaPppUsd', label: 'GDP per capita (PPP)', format: 'usd' },
  { key: 'hdi', label: 'Human Development Index', format: 'index' },
  { key: 'lifeExpectancyYears', label: 'Life expectancy', format: 'years' },
];

export const MIDDLE_EAST_SUCCESS_SOURCES = 'IMF World Economic Outlook, World Bank Open Data, UNDP Human Development Report 2025 (2024 figures).';

export function findMiddleEastCountryByLeader(leaderKey = '') {
  return MIDDLE_EAST_SUCCESS.find((entry) => entry.leaderKey === leaderKey) || null;
}


