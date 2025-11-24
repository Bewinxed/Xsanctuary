// Country name to ISO 3166-1 alpha-2 code mapping
const countryToCode: Record<string, string> = {
  'Afghanistan': 'AF',
  'Albania': 'AL',
  'Algeria': 'DZ',
  'Andorra': 'AD',
  'Angola': 'AO',
  'Argentina': 'AR',
  'Armenia': 'AM',
  'Australia': 'AU',
  'Austria': 'AT',
  'Azerbaijan': 'AZ',
  'Bahamas': 'BS',
  'Bahrain': 'BH',
  'Bangladesh': 'BD',
  'Barbados': 'BB',
  'Belarus': 'BY',
  'Belgium': 'BE',
  'Belize': 'BZ',
  'Benin': 'BJ',
  'Bhutan': 'BT',
  'Bolivia': 'BO',
  'Bosnia and Herzegovina': 'BA',
  'Botswana': 'BW',
  'Brazil': 'BR',
  'Brunei': 'BN',
  'Bulgaria': 'BG',
  'Burkina Faso': 'BF',
  'Burundi': 'BI',
  'Cambodia': 'KH',
  'Cameroon': 'CM',
  'Canada': 'CA',
  'Cape Verde': 'CV',
  'Central African Republic': 'CF',
  'Chad': 'TD',
  'Chile': 'CL',
  'China': 'CN',
  'Colombia': 'CO',
  'Comoros': 'KM',
  'Congo': 'CG',
  'Costa Rica': 'CR',
  'Croatia': 'HR',
  'Cuba': 'CU',
  'Cyprus': 'CY',
  'Czech Republic': 'CZ',
  'Czechia': 'CZ',
  'Denmark': 'DK',
  'Djibouti': 'DJ',
  'Dominica': 'DM',
  'Dominican Republic': 'DO',
  'Ecuador': 'EC',
  'Egypt': 'EG',
  'El Salvador': 'SV',
  'Equatorial Guinea': 'GQ',
  'Eritrea': 'ER',
  'Estonia': 'EE',
  'Eswatini': 'SZ',
  'Ethiopia': 'ET',
  'Fiji': 'FJ',
  'Finland': 'FI',
  'France': 'FR',
  'Gabon': 'GA',
  'Gambia': 'GM',
  'Georgia': 'GE',
  'Germany': 'DE',
  'Ghana': 'GH',
  'Greece': 'GR',
  'Grenada': 'GD',
  'Guatemala': 'GT',
  'Guinea': 'GN',
  'Guinea-Bissau': 'GW',
  'Guyana': 'GY',
  'Haiti': 'HT',
  'Honduras': 'HN',
  'Hong Kong': 'HK',
  'Hungary': 'HU',
  'Iceland': 'IS',
  'India': 'IN',
  'Indonesia': 'ID',
  'Iran': 'IR',
  'Iraq': 'IQ',
  'Ireland': 'IE',
  'Israel': 'IL',
  'Italy': 'IT',
  'Ivory Coast': 'CI',
  'Jamaica': 'JM',
  'Japan': 'JP',
  'Jordan': 'JO',
  'Kazakhstan': 'KZ',
  'Kenya': 'KE',
  'Kiribati': 'KI',
  'Kosovo': 'XK',
  'Kuwait': 'KW',
  'Kyrgyzstan': 'KG',
  'Laos': 'LA',
  'Latvia': 'LV',
  'Lebanon': 'LB',
  'Lesotho': 'LS',
  'Liberia': 'LR',
  'Libya': 'LY',
  'Liechtenstein': 'LI',
  'Lithuania': 'LT',
  'Luxembourg': 'LU',
  'Macau': 'MO',
  'Madagascar': 'MG',
  'Malawi': 'MW',
  'Malaysia': 'MY',
  'Maldives': 'MV',
  'Mali': 'ML',
  'Malta': 'MT',
  'Marshall Islands': 'MH',
  'Mauritania': 'MR',
  'Mauritius': 'MU',
  'Mexico': 'MX',
  'Micronesia': 'FM',
  'Moldova': 'MD',
  'Monaco': 'MC',
  'Mongolia': 'MN',
  'Montenegro': 'ME',
  'Morocco': 'MA',
  'Mozambique': 'MZ',
  'Myanmar': 'MM',
  'Namibia': 'NA',
  'Nauru': 'NR',
  'Nepal': 'NP',
  'Netherlands': 'NL',
  'New Zealand': 'NZ',
  'Nicaragua': 'NI',
  'Niger': 'NE',
  'Nigeria': 'NG',
  'North Korea': 'KP',
  'North Macedonia': 'MK',
  'Norway': 'NO',
  'Oman': 'OM',
  'Pakistan': 'PK',
  'Palau': 'PW',
  'Palestine': 'PS',
  'Panama': 'PA',
  'Papua New Guinea': 'PG',
  'Paraguay': 'PY',
  'Peru': 'PE',
  'Philippines': 'PH',
  'Poland': 'PL',
  'Portugal': 'PT',
  'Puerto Rico': 'PR',
  'Qatar': 'QA',
  'Romania': 'RO',
  'Russia': 'RU',
  'Rwanda': 'RW',
  'Saint Kitts and Nevis': 'KN',
  'Saint Lucia': 'LC',
  'Saint Vincent and the Grenadines': 'VC',
  'Samoa': 'WS',
  'San Marino': 'SM',
  'Sao Tome and Principe': 'ST',
  'Saudi Arabia': 'SA',
  'Senegal': 'SN',
  'Serbia': 'RS',
  'Seychelles': 'SC',
  'Sierra Leone': 'SL',
  'Singapore': 'SG',
  'Slovakia': 'SK',
  'Slovenia': 'SI',
  'Solomon Islands': 'SB',
  'Somalia': 'SO',
  'South Africa': 'ZA',
  'South Korea': 'KR',
  'South Sudan': 'SS',
  'Spain': 'ES',
  'Sri Lanka': 'LK',
  'Sudan': 'SD',
  'Suriname': 'SR',
  'Sweden': 'SE',
  'Switzerland': 'CH',
  'Syria': 'SY',
  'Taiwan': 'TW',
  'Tajikistan': 'TJ',
  'Tanzania': 'TZ',
  'Thailand': 'TH',
  'Timor-Leste': 'TL',
  'Togo': 'TG',
  'Tonga': 'TO',
  'Trinidad and Tobago': 'TT',
  'Tunisia': 'TN',
  'Turkey': 'TR',
  'Turkmenistan': 'TM',
  'Tuvalu': 'TV',
  'Uganda': 'UG',
  'Ukraine': 'UA',
  'United Arab Emirates': 'AE',
  'United Kingdom': 'GB',
  'United States': 'US',
  'Uruguay': 'UY',
  'Uzbekistan': 'UZ',
  'Vanuatu': 'VU',
  'Vatican City': 'VA',
  'Venezuela': 'VE',
  'Vietnam': 'VN',
  'Yemen': 'YE',
  'Zambia': 'ZM',
  'Zimbabwe': 'ZW',
  // Common variations
  'USA': 'US',
  'UK': 'GB',
  'UAE': 'AE',
  'Korea': 'KR',
  'The Netherlands': 'NL',
  'Czech': 'CZ',
  'Russia Federation': 'RU',
  'Russian Federation': 'RU',
  // App Store location variations (from Twitter API)
  'Jordan App Store': 'JO',
  'United States App Store': 'US',
  'United Kingdom App Store': 'GB',
  'Canada App Store': 'CA',
  'Australia App Store': 'AU',
  'Germany App Store': 'DE',
  'France App Store': 'FR',
  'Japan App Store': 'JP',
  'China App Store': 'CN',
  'India App Store': 'IN',
  'Brazil App Store': 'BR',
  'Mexico App Store': 'MX',
  'Spain App Store': 'ES',
  'Italy App Store': 'IT',
  'Netherlands App Store': 'NL',
  'Sweden App Store': 'SE',
  'Norway App Store': 'NO',
  'Denmark App Store': 'DK',
  'Finland App Store': 'FI',
  'Poland App Store': 'PL',
  'Turkey App Store': 'TR',
  'Saudi Arabia App Store': 'SA',
  'UAE App Store': 'AE',
  'Egypt App Store': 'EG',
  'South Africa App Store': 'ZA',
  'Nigeria App Store': 'NG',
  'Kenya App Store': 'KE',
  'Singapore App Store': 'SG',
  'Malaysia App Store': 'MY',
  'Indonesia App Store': 'ID',
  'Thailand App Store': 'TH',
  'Philippines App Store': 'PH',
  'Vietnam App Store': 'VN',
  'South Korea App Store': 'KR',
  'Taiwan App Store': 'TW',
  'Hong Kong App Store': 'HK',
  'Russia App Store': 'RU',
  'Ukraine App Store': 'UA',
  'Argentina App Store': 'AR',
  'Colombia App Store': 'CO',
  'Chile App Store': 'CL',
  'Peru App Store': 'PE',
  'Venezuela App Store': 'VE',
  'Pakistan App Store': 'PK',
  'Bangladesh App Store': 'BD',
  'Israel App Store': 'IL',
  'Ireland App Store': 'IE',
  'Portugal App Store': 'PT',
  'Greece App Store': 'GR',
  'Austria App Store': 'AT',
  'Switzerland App Store': 'CH',
  'Belgium App Store': 'BE',
  'Czech Republic App Store': 'CZ',
  'Romania App Store': 'RO',
  'Hungary App Store': 'HU',
  'New Zealand App Store': 'NZ',
  // Regions (Twitter sometimes returns these instead of countries)
  'East Asia & Pacific': 'APAC',
  'Europe & Central Asia': 'EU',
  'Latin America & Caribbean': 'LATAM',
  'Middle East & North Africa': 'MENA',
  'North America': 'NA',
  'South Asia': 'SA',
  'Sub-Saharan Africa': 'SSA',
  // App Store regions
  'North America App Store': 'NA',
  'Europe App Store': 'EU',
  'Asia Pacific App Store': 'APAC',
};

// Region codes to display text and icon
const regionToDisplay: Record<string, { name: string; icon: string }> = {
  'APAC': { name: 'APAC', icon: '🌏' },
  'EU': { name: 'EU', icon: '🇪🇺' },
  'LATAM': { name: 'LATAM', icon: '🌎' },
  'MENA': { name: 'MENA', icon: '🌍' },
  'NA': { name: 'NA', icon: '🌎' },
  'SA': { name: 'S.Asia', icon: '🌏' },
  'SSA': { name: 'Africa', icon: '🌍' },
};

// Get SVG flag URL from country code (using CDN for cross-platform compatibility)
export function countryCodeToFlagUrl(code: string): string {
  return `https://purecatamphetamine.github.io/country-flag-icons/3x2/${code.toUpperCase()}.svg`;
}

// Convert ISO country code to flag emoji (kept for backwards compatibility, but prefer countryCodeToFlagUrl)
export function countryCodeToFlag(code: string): string {
  // Return URL instead for better cross-platform support
  return countryCodeToFlagUrl(code);
}

// Get country code from country name
export function getCountryCode(countryName: string): string | null {
  // Direct match
  if (countryToCode[countryName]) {
    return countryToCode[countryName];
  }

  // Try to extract country from "X App Store" format
  const appStoreMatch = countryName.match(/^(.+?)\s*App Store$/i);
  if (appStoreMatch) {
    const country = appStoreMatch[1].trim();
    if (countryToCode[country]) {
      return countryToCode[country];
    }
  }

  // Case-insensitive search
  const lowerName = countryName.toLowerCase();
  for (const [name, code] of Object.entries(countryToCode)) {
    if (name.toLowerCase() === lowerName) {
      return code;
    }
  }

  // Partial match (country name contains the search term)
  for (const [name, code] of Object.entries(countryToCode)) {
    if (name.toLowerCase().includes(lowerName) || lowerName.includes(name.toLowerCase())) {
      return code;
    }
  }

  return null;
}

// Extract all flag emojis from text and return their country codes
export function extractFlagEmojis(text: string): string[] {
  const flagCodes: string[] = [];

  // Flag emojis are made of two regional indicator symbols (U+1F1E6 to U+1F1FF)
  // Each letter A-Z maps to U+1F1E6 to U+1F1FF (regional indicator symbols)
  const regionalIndicatorStart = 0x1F1E6; // 🇦
  const regionalIndicatorEnd = 0x1F1FF;   // 🇿

  const codePoints = [...text];

  for (let i = 0; i < codePoints.length - 1; i++) {
    const cp1 = codePoints[i].codePointAt(0);
    const cp2 = codePoints[i + 1].codePointAt(0);

    if (cp1 && cp2 &&
        cp1 >= regionalIndicatorStart && cp1 <= regionalIndicatorEnd &&
        cp2 >= regionalIndicatorStart && cp2 <= regionalIndicatorEnd) {
      // Convert regional indicators back to letters
      const letter1 = String.fromCharCode(cp1 - regionalIndicatorStart + 65); // 65 = 'A'
      const letter2 = String.fromCharCode(cp2 - regionalIndicatorStart + 65);
      const code = letter1 + letter2;
      flagCodes.push(code);
      i++; // Skip the next character as we've consumed it
    }
  }

  return flagCodes;
}

// Check if user is being deceptive (has flag emojis but none match their actual country)
export function isDeceptiveProfile(profileText: string, actualCountryCode: string): boolean {
  const flagsInProfile = extractFlagEmojis(profileText);

  // If no flags in profile, not considered deceptive
  if (flagsInProfile.length === 0) {
    return false;
  }

  // Check if any flag matches the actual country
  const hasMatchingFlag = flagsInProfile.some(
    flag => flag.toUpperCase() === actualCountryCode.toUpperCase()
  );

  // Deceptive if they have flags but none match their actual country
  return !hasMatchingFlag;
}

// Get flag (URL for countries, emoji for regions) from country name
export function getFlag(countryName: string): string | null {
  const code = getCountryCode(countryName);
  if (code) {
    // Check if it's a region code - return emoji for regions
    if (regionToDisplay[code]) {
      return regionToDisplay[code].icon;
    }
    // Return SVG URL for countries
    return countryCodeToFlagUrl(code);
  }
  return null;
}

// Get flag display info (used for UI rendering)
export function getFlagInfo(countryCode: string): { type: 'emoji' | 'url'; value: string } | null {
  if (regionToDisplay[countryCode]) {
    return { type: 'emoji', value: regionToDisplay[countryCode].icon };
  }
  return { type: 'url', value: countryCodeToFlagUrl(countryCode) };
}
