// Full list of countries with codes and flag display info
export interface Country {
  name: string;
  code: string;
  flag: string; // SVG URL for countries, emoji for regions
  isRegion?: boolean;
}

// Get SVG flag URL for a country code (cross-platform compatible)
function getFlagUrl(code: string): string {
  return `https://purecatamphetamine.github.io/country-flag-icons/3x2/${code.toUpperCase()}.svg`;
}

// Regions that Twitter may return instead of specific countries (use emojis for regions as they're universal)
export const regions: Country[] = [
  { name: 'Asia Pacific', code: 'APAC', flag: '🌏', isRegion: true },
  { name: 'Europe', code: 'EU', flag: '🇪🇺', isRegion: true },
  { name: 'Latin America', code: 'LATAM', flag: '🌎', isRegion: true },
  { name: 'Middle East & North Africa', code: 'MENA', flag: '🌍', isRegion: true },
  { name: 'North America', code: 'NA', flag: '🌎', isRegion: true },
  { name: 'South Asia', code: 'SA', flag: '🌏', isRegion: true },
  { name: 'Sub-Saharan Africa', code: 'SSA', flag: '🌍', isRegion: true },
];

export const countries: Country[] = [
  { name: 'Afghanistan', code: 'AF', flag: getFlagUrl('AF') },
  { name: 'Albania', code: 'AL', flag: getFlagUrl('AL') },
  { name: 'Algeria', code: 'DZ', flag: getFlagUrl('DZ') },
  { name: 'Argentina', code: 'AR', flag: getFlagUrl('AR') },
  { name: 'Australia', code: 'AU', flag: getFlagUrl('AU') },
  { name: 'Austria', code: 'AT', flag: getFlagUrl('AT') },
  { name: 'Bangladesh', code: 'BD', flag: getFlagUrl('BD') },
  { name: 'Belgium', code: 'BE', flag: getFlagUrl('BE') },
  { name: 'Brazil', code: 'BR', flag: getFlagUrl('BR') },
  { name: 'Canada', code: 'CA', flag: getFlagUrl('CA') },
  { name: 'Chile', code: 'CL', flag: getFlagUrl('CL') },
  { name: 'China', code: 'CN', flag: getFlagUrl('CN') },
  { name: 'Colombia', code: 'CO', flag: getFlagUrl('CO') },
  { name: 'Czech Republic', code: 'CZ', flag: getFlagUrl('CZ') },
  { name: 'Denmark', code: 'DK', flag: getFlagUrl('DK') },
  { name: 'Egypt', code: 'EG', flag: getFlagUrl('EG') },
  { name: 'Finland', code: 'FI', flag: getFlagUrl('FI') },
  { name: 'France', code: 'FR', flag: getFlagUrl('FR') },
  { name: 'Germany', code: 'DE', flag: getFlagUrl('DE') },
  { name: 'Greece', code: 'GR', flag: getFlagUrl('GR') },
  { name: 'Hong Kong', code: 'HK', flag: getFlagUrl('HK') },
  { name: 'Hungary', code: 'HU', flag: getFlagUrl('HU') },
  { name: 'India', code: 'IN', flag: getFlagUrl('IN') },
  { name: 'Indonesia', code: 'ID', flag: getFlagUrl('ID') },
  { name: 'Iran', code: 'IR', flag: getFlagUrl('IR') },
  { name: 'Iraq', code: 'IQ', flag: getFlagUrl('IQ') },
  { name: 'Ireland', code: 'IE', flag: getFlagUrl('IE') },
  { name: 'Israel', code: 'IL', flag: getFlagUrl('IL') },
  { name: 'Italy', code: 'IT', flag: getFlagUrl('IT') },
  { name: 'Japan', code: 'JP', flag: getFlagUrl('JP') },
  { name: 'Jordan', code: 'JO', flag: getFlagUrl('JO') },
  { name: 'Kenya', code: 'KE', flag: getFlagUrl('KE') },
  { name: 'Kuwait', code: 'KW', flag: getFlagUrl('KW') },
  { name: 'Lebanon', code: 'LB', flag: getFlagUrl('LB') },
  { name: 'Malaysia', code: 'MY', flag: getFlagUrl('MY') },
  { name: 'Mexico', code: 'MX', flag: getFlagUrl('MX') },
  { name: 'Morocco', code: 'MA', flag: getFlagUrl('MA') },
  { name: 'Netherlands', code: 'NL', flag: getFlagUrl('NL') },
  { name: 'New Zealand', code: 'NZ', flag: getFlagUrl('NZ') },
  { name: 'Nigeria', code: 'NG', flag: getFlagUrl('NG') },
  { name: 'Norway', code: 'NO', flag: getFlagUrl('NO') },
  { name: 'Pakistan', code: 'PK', flag: getFlagUrl('PK') },
  { name: 'Palestine', code: 'PS', flag: getFlagUrl('PS') },
  { name: 'Peru', code: 'PE', flag: getFlagUrl('PE') },
  { name: 'Philippines', code: 'PH', flag: getFlagUrl('PH') },
  { name: 'Poland', code: 'PL', flag: getFlagUrl('PL') },
  { name: 'Portugal', code: 'PT', flag: getFlagUrl('PT') },
  { name: 'Qatar', code: 'QA', flag: getFlagUrl('QA') },
  { name: 'Romania', code: 'RO', flag: getFlagUrl('RO') },
  { name: 'Russia', code: 'RU', flag: getFlagUrl('RU') },
  { name: 'Saudi Arabia', code: 'SA', flag: getFlagUrl('SA') },
  { name: 'Singapore', code: 'SG', flag: getFlagUrl('SG') },
  { name: 'South Africa', code: 'ZA', flag: getFlagUrl('ZA') },
  { name: 'South Korea', code: 'KR', flag: getFlagUrl('KR') },
  { name: 'Spain', code: 'ES', flag: getFlagUrl('ES') },
  { name: 'Sweden', code: 'SE', flag: getFlagUrl('SE') },
  { name: 'Switzerland', code: 'CH', flag: getFlagUrl('CH') },
  { name: 'Syria', code: 'SY', flag: getFlagUrl('SY') },
  { name: 'Taiwan', code: 'TW', flag: getFlagUrl('TW') },
  { name: 'Thailand', code: 'TH', flag: getFlagUrl('TH') },
  { name: 'Turkey', code: 'TR', flag: getFlagUrl('TR') },
  { name: 'Ukraine', code: 'UA', flag: getFlagUrl('UA') },
  { name: 'United Arab Emirates', code: 'AE', flag: getFlagUrl('AE') },
  { name: 'United Kingdom', code: 'GB', flag: getFlagUrl('GB') },
  { name: 'United States', code: 'US', flag: getFlagUrl('US') },
  { name: 'Venezuela', code: 'VE', flag: getFlagUrl('VE') },
  { name: 'Vietnam', code: 'VN', flag: getFlagUrl('VN') },
  { name: 'Yemen', code: 'YE', flag: getFlagUrl('YE') },
].sort((a, b) => a.name.localeCompare(b.name));

// Combined list with regions first, then countries
export const allLocations: Country[] = [...regions, ...countries];

export function getCountryByCode(code: string): Country | undefined {
  return allLocations.find(c => c.code === code);
}
