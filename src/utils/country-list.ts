// Full list of countries with codes and flag emojis
export interface Country {
  name: string;
  code: string;
  flag: string;
  isRegion?: boolean;
}

function codeToFlag(code: string): string {
  const codePoints = code
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Regions that Twitter may return instead of specific countries
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
  { name: 'Afghanistan', code: 'AF', flag: codeToFlag('AF') },
  { name: 'Albania', code: 'AL', flag: codeToFlag('AL') },
  { name: 'Algeria', code: 'DZ', flag: codeToFlag('DZ') },
  { name: 'Argentina', code: 'AR', flag: codeToFlag('AR') },
  { name: 'Australia', code: 'AU', flag: codeToFlag('AU') },
  { name: 'Austria', code: 'AT', flag: codeToFlag('AT') },
  { name: 'Bangladesh', code: 'BD', flag: codeToFlag('BD') },
  { name: 'Belgium', code: 'BE', flag: codeToFlag('BE') },
  { name: 'Brazil', code: 'BR', flag: codeToFlag('BR') },
  { name: 'Canada', code: 'CA', flag: codeToFlag('CA') },
  { name: 'Chile', code: 'CL', flag: codeToFlag('CL') },
  { name: 'China', code: 'CN', flag: codeToFlag('CN') },
  { name: 'Colombia', code: 'CO', flag: codeToFlag('CO') },
  { name: 'Czech Republic', code: 'CZ', flag: codeToFlag('CZ') },
  { name: 'Denmark', code: 'DK', flag: codeToFlag('DK') },
  { name: 'Egypt', code: 'EG', flag: codeToFlag('EG') },
  { name: 'Finland', code: 'FI', flag: codeToFlag('FI') },
  { name: 'France', code: 'FR', flag: codeToFlag('FR') },
  { name: 'Germany', code: 'DE', flag: codeToFlag('DE') },
  { name: 'Greece', code: 'GR', flag: codeToFlag('GR') },
  { name: 'Hong Kong', code: 'HK', flag: codeToFlag('HK') },
  { name: 'Hungary', code: 'HU', flag: codeToFlag('HU') },
  { name: 'India', code: 'IN', flag: codeToFlag('IN') },
  { name: 'Indonesia', code: 'ID', flag: codeToFlag('ID') },
  { name: 'Iran', code: 'IR', flag: codeToFlag('IR') },
  { name: 'Iraq', code: 'IQ', flag: codeToFlag('IQ') },
  { name: 'Ireland', code: 'IE', flag: codeToFlag('IE') },
  { name: 'Israel', code: 'IL', flag: codeToFlag('IL') },
  { name: 'Italy', code: 'IT', flag: codeToFlag('IT') },
  { name: 'Japan', code: 'JP', flag: codeToFlag('JP') },
  { name: 'Jordan', code: 'JO', flag: codeToFlag('JO') },
  { name: 'Kenya', code: 'KE', flag: codeToFlag('KE') },
  { name: 'Kuwait', code: 'KW', flag: codeToFlag('KW') },
  { name: 'Lebanon', code: 'LB', flag: codeToFlag('LB') },
  { name: 'Malaysia', code: 'MY', flag: codeToFlag('MY') },
  { name: 'Mexico', code: 'MX', flag: codeToFlag('MX') },
  { name: 'Morocco', code: 'MA', flag: codeToFlag('MA') },
  { name: 'Netherlands', code: 'NL', flag: codeToFlag('NL') },
  { name: 'New Zealand', code: 'NZ', flag: codeToFlag('NZ') },
  { name: 'Nigeria', code: 'NG', flag: codeToFlag('NG') },
  { name: 'Norway', code: 'NO', flag: codeToFlag('NO') },
  { name: 'Pakistan', code: 'PK', flag: codeToFlag('PK') },
  { name: 'Palestine', code: 'PS', flag: codeToFlag('PS') },
  { name: 'Peru', code: 'PE', flag: codeToFlag('PE') },
  { name: 'Philippines', code: 'PH', flag: codeToFlag('PH') },
  { name: 'Poland', code: 'PL', flag: codeToFlag('PL') },
  { name: 'Portugal', code: 'PT', flag: codeToFlag('PT') },
  { name: 'Qatar', code: 'QA', flag: codeToFlag('QA') },
  { name: 'Romania', code: 'RO', flag: codeToFlag('RO') },
  { name: 'Russia', code: 'RU', flag: codeToFlag('RU') },
  { name: 'Saudi Arabia', code: 'SA', flag: codeToFlag('SA') },
  { name: 'Singapore', code: 'SG', flag: codeToFlag('SG') },
  { name: 'South Africa', code: 'ZA', flag: codeToFlag('ZA') },
  { name: 'South Korea', code: 'KR', flag: codeToFlag('KR') },
  { name: 'Spain', code: 'ES', flag: codeToFlag('ES') },
  { name: 'Sweden', code: 'SE', flag: codeToFlag('SE') },
  { name: 'Switzerland', code: 'CH', flag: codeToFlag('CH') },
  { name: 'Syria', code: 'SY', flag: codeToFlag('SY') },
  { name: 'Taiwan', code: 'TW', flag: codeToFlag('TW') },
  { name: 'Thailand', code: 'TH', flag: codeToFlag('TH') },
  { name: 'Turkey', code: 'TR', flag: codeToFlag('TR') },
  { name: 'Ukraine', code: 'UA', flag: codeToFlag('UA') },
  { name: 'United Arab Emirates', code: 'AE', flag: codeToFlag('AE') },
  { name: 'United Kingdom', code: 'GB', flag: codeToFlag('GB') },
  { name: 'United States', code: 'US', flag: codeToFlag('US') },
  { name: 'Venezuela', code: 'VE', flag: codeToFlag('VE') },
  { name: 'Vietnam', code: 'VN', flag: codeToFlag('VN') },
  { name: 'Yemen', code: 'YE', flag: codeToFlag('YE') },
].sort((a, b) => a.name.localeCompare(b.name));

// Combined list with regions first, then countries
export const allLocations: Country[] = [...regions, ...countries];

export function getCountryByCode(code: string): Country | undefined {
  return allLocations.find(c => c.code === code);
}
