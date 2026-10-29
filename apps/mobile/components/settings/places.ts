/**
 * Every country and territory people live in (ISO 3166-1 alpha-2 codes with English short names, plus Kosovo's XK),
 * and the major cities of each, largest first, with the places people most often dream of living added in. Compiled
 * by hand for Dandelist; no outside dataset. A city that isn't listed can always be typed. Uninhabited territories
 * (Antarctica, Bouvet Island and the like) are left out. Pure, so it has tests.
 */

export const COUNTRIES: readonly (readonly [code: string, name: string])[] = [
  ["AF", "Afghanistan"], ["AX", "Åland Islands"], ["AL", "Albania"], ["DZ", "Algeria"], ["AS", "American Samoa"], ["AD", "Andorra"],
  ["AO", "Angola"], ["AI", "Anguilla"], ["AG", "Antigua and Barbuda"], ["AR", "Argentina"], ["AM", "Armenia"], ["AW", "Aruba"],
  ["AU", "Australia"], ["AT", "Austria"], ["AZ", "Azerbaijan"], ["BS", "Bahamas"], ["BH", "Bahrain"], ["BD", "Bangladesh"],
  ["BB", "Barbados"], ["BY", "Belarus"], ["BE", "Belgium"], ["BZ", "Belize"], ["BJ", "Benin"], ["BM", "Bermuda"], ["BT", "Bhutan"],
  ["BO", "Bolivia"], ["BQ", "Caribbean Netherlands"], ["BA", "Bosnia and Herzegovina"], ["BW", "Botswana"], ["BR", "Brazil"],
  ["BN", "Brunei"], ["BG", "Bulgaria"], ["BF", "Burkina Faso"], ["BI", "Burundi"], ["CV", "Cabo Verde"], ["KH", "Cambodia"],
  ["CM", "Cameroon"], ["CA", "Canada"], ["KY", "Cayman Islands"], ["CF", "Central African Republic"], ["TD", "Chad"], ["CL", "Chile"],
  ["CN", "China"], ["CX", "Christmas Island"], ["CC", "Cocos (Keeling) Islands"], ["CO", "Colombia"], ["KM", "Comoros"],
  ["CG", "Congo"], ["CD", "DR Congo"], ["CK", "Cook Islands"], ["CR", "Costa Rica"], ["CI", "Côte d'Ivoire"], ["HR", "Croatia"],
  ["CU", "Cuba"], ["CW", "Curaçao"], ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["DJ", "Djibouti"], ["DM", "Dominica"],
  ["DO", "Dominican Republic"], ["EC", "Ecuador"], ["EG", "Egypt"], ["SV", "El Salvador"], ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"], ["EE", "Estonia"], ["SZ", "Eswatini"], ["ET", "Ethiopia"], ["FK", "Falkland Islands"], ["FO", "Faroe Islands"],
  ["FJ", "Fiji"], ["FI", "Finland"], ["FR", "France"], ["GF", "French Guiana"], ["PF", "French Polynesia"], ["GA", "Gabon"],
  ["GM", "Gambia"], ["GE", "Georgia"], ["DE", "Germany"], ["GH", "Ghana"], ["GI", "Gibraltar"], ["GR", "Greece"], ["GL", "Greenland"],
  ["GD", "Grenada"], ["GP", "Guadeloupe"], ["GU", "Guam"], ["GT", "Guatemala"], ["GG", "Guernsey"], ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"], ["GY", "Guyana"], ["HT", "Haiti"], ["VA", "Vatican City"], ["HN", "Honduras"], ["HK", "Hong Kong"],
  ["HU", "Hungary"], ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"], ["IQ", "Iraq"], ["IE", "Ireland"],
  ["IM", "Isle of Man"], ["IL", "Israel"], ["IT", "Italy"], ["JM", "Jamaica"], ["JP", "Japan"], ["JE", "Jersey"], ["JO", "Jordan"],
  ["KZ", "Kazakhstan"], ["KE", "Kenya"], ["KI", "Kiribati"], ["KP", "North Korea"], ["KR", "South Korea"], ["XK", "Kosovo"],
  ["KW", "Kuwait"], ["KG", "Kyrgyzstan"], ["LA", "Laos"], ["LV", "Latvia"], ["LB", "Lebanon"], ["LS", "Lesotho"], ["LR", "Liberia"],
  ["LY", "Libya"], ["LI", "Liechtenstein"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MO", "Macao"], ["MG", "Madagascar"],
  ["MW", "Malawi"], ["MY", "Malaysia"], ["MV", "Maldives"], ["ML", "Mali"], ["MT", "Malta"], ["MH", "Marshall Islands"],
  ["MQ", "Martinique"], ["MR", "Mauritania"], ["MU", "Mauritius"], ["YT", "Mayotte"], ["MX", "Mexico"], ["FM", "Micronesia"],
  ["MD", "Moldova"], ["MC", "Monaco"], ["MN", "Mongolia"], ["ME", "Montenegro"], ["MS", "Montserrat"], ["MA", "Morocco"],
  ["MZ", "Mozambique"], ["MM", "Myanmar"], ["NA", "Namibia"], ["NR", "Nauru"], ["NP", "Nepal"], ["NL", "Netherlands"],
  ["NC", "New Caledonia"], ["NZ", "New Zealand"], ["NI", "Nicaragua"], ["NE", "Niger"], ["NG", "Nigeria"], ["NU", "Niue"],
  ["NF", "Norfolk Island"], ["MK", "North Macedonia"], ["MP", "Northern Mariana Islands"], ["NO", "Norway"], ["OM", "Oman"],
  ["PK", "Pakistan"], ["PW", "Palau"], ["PS", "Palestine"], ["PA", "Panama"], ["PG", "Papua New Guinea"], ["PY", "Paraguay"],
  ["PE", "Peru"], ["PH", "Philippines"], ["PN", "Pitcairn Islands"], ["PL", "Poland"], ["PT", "Portugal"], ["PR", "Puerto Rico"],
  ["QA", "Qatar"], ["RE", "Réunion"], ["RO", "Romania"], ["RU", "Russia"], ["RW", "Rwanda"], ["BL", "Saint Barthélemy"],
  ["SH", "Saint Helena"], ["KN", "Saint Kitts and Nevis"], ["LC", "Saint Lucia"], ["MF", "Saint Martin"],
  ["PM", "Saint Pierre and Miquelon"], ["VC", "Saint Vincent and the Grenadines"], ["WS", "Samoa"], ["SM", "San Marino"],
  ["ST", "São Tomé and Príncipe"], ["SA", "Saudi Arabia"], ["SN", "Senegal"], ["RS", "Serbia"], ["SC", "Seychelles"],
  ["SL", "Sierra Leone"], ["SG", "Singapore"], ["SX", "Sint Maarten"], ["SK", "Slovakia"], ["SI", "Slovenia"],
  ["SB", "Solomon Islands"], ["SO", "Somalia"], ["ZA", "South Africa"], ["SS", "South Sudan"], ["ES", "Spain"], ["LK", "Sri Lanka"],
  ["SD", "Sudan"], ["SR", "Suriname"], ["SJ", "Svalbard and Jan Mayen"], ["SE", "Sweden"], ["CH", "Switzerland"], ["SY", "Syria"],
  ["TW", "Taiwan"], ["TJ", "Tajikistan"], ["TZ", "Tanzania"], ["TH", "Thailand"], ["TL", "Timor-Leste"], ["TG", "Togo"],
  ["TK", "Tokelau"], ["TO", "Tonga"], ["TT", "Trinidad and Tobago"], ["TN", "Tunisia"], ["TR", "Türkiye"], ["TM", "Turkmenistan"],
  ["TC", "Turks and Caicos Islands"], ["TV", "Tuvalu"], ["UG", "Uganda"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"], ["US", "United States"], ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VU", "Vanuatu"], ["VE", "Venezuela"],
  ["VN", "Vietnam"], ["VG", "British Virgin Islands"], ["VI", "U.S. Virgin Islands"], ["WF", "Wallis and Futuna"],
  ["EH", "Western Sahara"], ["YE", "Yemen"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"],
];

/** Other names people type for a country. */
const ALIASES: Record<string, string> = {
  US: "USA America United States of America", GB: "UK Britain Great Britain England Scotland Wales Northern Ireland",
  AE: "UAE Emirates", KR: "Korea", KP: "Korea", CZ: "Czech Republic", TR: "Turkey", CI: "Ivory Coast", CV: "Cape Verde",
  SZ: "Swaziland", MK: "Macedonia", MM: "Burma", CD: "Democratic Republic of the Congo DRC Zaire", CG: "Republic of the Congo",
  TL: "East Timor", VA: "Holy See Vatican", NL: "Holland", RU: "Russian Federation", VN: "Viet Nam", LA: "Lao", IR: "Persia",
  MO: "Macau", FK: "Malvinas", BQ: "Bonaire Saba Sint Eustatius", BL: "St Barts St Barths", MF: "St Martin", KN: "St Kitts Nevis",
  LC: "St Lucia", VC: "St Vincent Grenadines Mustique", SH: "St Helena", SX: "St Maarten", VI: "USVI", VG: "BVI", PS: "Palestinian",
  FM: "Federated States", BA: "Bosnia", TT: "Trinidad Tobago", AG: "Antigua Barbuda", ST: "Sao Tome", PM: "St Pierre Miquelon",
};

/** Major cities per country, largest first, then the places people most often want to live. Pipe-separated. */
const CITIES: Record<string, string> = {
  // The Americas
  US: "New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|Austin|Jacksonville|San Jose|Fort Worth|Columbus|Charlotte|Indianapolis|San Francisco|Seattle|Denver|Washington|Nashville|Boston|Las Vegas|Portland|Miami|Atlanta|New Orleans|Honolulu|Salt Lake City|Minneapolis|Detroit|Baltimore|Pittsburgh|St. Louis|Tampa|Orlando|Scottsdale|Palm Beach|Malibu|Beverly Hills|Aspen|The Hamptons|Napa|Santa Barbara",
  CA: "Toronto|Montreal|Vancouver|Calgary|Edmonton|Ottawa|Winnipeg|Quebec City|Hamilton|Victoria|Halifax|Whistler",
  MX: "Mexico City|Guadalajara|Monterrey|Puebla|Tijuana|León|Mérida|Cancún|Querétaro|Playa del Carmen|Tulum|Puerto Vallarta|Los Cabos|Oaxaca|San Miguel de Allende",
  BR: "São Paulo|Rio de Janeiro|Brasília|Salvador|Fortaleza|Belo Horizonte|Manaus|Curitiba|Recife|Porto Alegre|Florianópolis|Búzios",
  AR: "Buenos Aires|Córdoba|Rosario|Mendoza|La Plata|Mar del Plata|Salta|Bariloche|Ushuaia",
  CL: "Santiago|Valparaíso|Viña del Mar|Concepción|Antofagasta|La Serena|Puerto Varas",
  CO: "Bogotá|Medellín|Cali|Barranquilla|Cartagena|Bucaramanga|Santa Marta",
  PE: "Lima|Arequipa|Trujillo|Cusco|Chiclayo|Piura",
  VE: "Caracas|Maracaibo|Valencia|Barquisimeto|Maracay",
  EC: "Quito|Guayaquil|Cuenca|Manta",
  BO: "La Paz|Santa Cruz de la Sierra|Cochabamba|Sucre",
  PY: "Asunción|Ciudad del Este|Encarnación",
  UY: "Montevideo|Punta del Este|Colonia del Sacramento|Salto",
  GY: "Georgetown|Linden",
  SR: "Paramaribo",
  GF: "Cayenne|Kourou",
  FK: "Stanley",
  CR: "San José|Liberia|Tamarindo|Nosara|Puerto Viejo",
  PA: "Panama City|Colón|David|Boquete|Bocas del Toro",
  GT: "Guatemala City|Antigua Guatemala|Quetzaltenango",
  SV: "San Salvador|Santa Ana|San Miguel",
  HN: "Tegucigalpa|San Pedro Sula|Roatán",
  NI: "Managua|León|Granada|San Juan del Sur",
  BZ: "Belize City|Belmopan|San Pedro|Placencia",
  CU: "Havana|Santiago de Cuba|Varadero|Trinidad",
  DO: "Santo Domingo|Santiago de los Caballeros|Punta Cana|Puerto Plata|La Romana",
  HT: "Port-au-Prince|Cap-Haïtien",
  JM: "Kingston|Montego Bay|Ocho Rios|Negril",
  PR: "San Juan|Bayamón|Ponce|Dorado|Rincón",
  BS: "Nassau|Freeport|Harbour Island|Exuma",
  BB: "Bridgetown|Holetown|Speightstown",
  TT: "Port of Spain|San Fernando|Chaguanas|Scarborough",
  KY: "George Town|West Bay",
  BM: "Hamilton|St. George's",
  AW: "Oranjestad|Palm Beach",
  CW: "Willemstad",
  SX: "Philipsburg",
  BQ: "Kralendijk|Oranjestad",
  AG: "St. John's|English Harbour",
  KN: "Basseterre|Charlestown",
  LC: "Castries|Soufrière|Rodney Bay",
  VC: "Kingstown|Mustique|Bequia",
  GD: "St. George's|Grand Anse",
  DM: "Roseau|Portsmouth",
  TC: "Providenciales|Cockburn Town",
  VG: "Road Town|Virgin Gorda",
  VI: "Charlotte Amalie|Christiansted|Cruz Bay",
  AI: "The Valley",
  MS: "Brades",
  GP: "Pointe-à-Pitre|Basse-Terre|Saint-François",
  MQ: "Fort-de-France|Le Lamentin",
  BL: "Gustavia",
  MF: "Marigot",
  PM: "Saint-Pierre",
  GL: "Nuuk|Ilulissat",
  // Europe
  GB: "London|Birmingham|Manchester|Glasgow|Liverpool|Leeds|Edinburgh|Bristol|Sheffield|Newcastle|Cardiff|Belfast|Nottingham|Brighton|Oxford|Cambridge|Bath|York",
  IE: "Dublin|Cork|Limerick|Galway|Waterford|Kilkenny|Killarney",
  FR: "Paris|Marseille|Lyon|Toulouse|Nice|Nantes|Strasbourg|Montpellier|Bordeaux|Lille|Rennes|Cannes|Saint-Tropez|Antibes|Biarritz|Aix-en-Provence|Annecy|Chamonix|Courchevel|Avignon",
  DE: "Berlin|Hamburg|Munich|Cologne|Frankfurt|Stuttgart|Düsseldorf|Leipzig|Dortmund|Essen|Bremen|Dresden|Hanover|Nuremberg|Heidelberg|Baden-Baden|Sylt",
  IT: "Rome|Milan|Naples|Turin|Palermo|Genoa|Bologna|Florence|Bari|Catania|Venice|Verona|Como|Positano|Amalfi|Capri|Portofino|Sorrento|Lucca|Siena|Taormina|Cortina d'Ampezzo",
  ES: "Madrid|Barcelona|Valencia|Seville|Zaragoza|Málaga|Palma|Las Palmas|Bilbao|Alicante|Córdoba|Granada|San Sebastián|Marbella|Ibiza|Santa Cruz de Tenerife|Sotogrande",
  PT: "Lisbon|Porto|Braga|Coimbra|Funchal|Faro|Cascais|Sintra|Lagos|Comporta|Ponta Delgada",
  NL: "Amsterdam|Rotterdam|The Hague|Utrecht|Eindhoven|Groningen|Haarlem|Maastricht",
  BE: "Brussels|Antwerp|Ghent|Charleroi|Liège|Bruges|Leuven|Knokke-Heist",
  LU: "Luxembourg City|Esch-sur-Alzette",
  CH: "Zurich|Geneva|Basel|Lausanne|Bern|Lucerne|Lugano|St. Moritz|Gstaad|Zermatt|Verbier|Montreux",
  AT: "Vienna|Graz|Linz|Salzburg|Innsbruck|Kitzbühel|Lech|Hallstatt",
  LI: "Vaduz|Schaan",
  MC: "Monaco|Monte Carlo",
  AD: "Andorra la Vella|Escaldes-Engordany",
  SM: "San Marino|Serravalle",
  VA: "Vatican City",
  MT: "Valletta|Sliema|St. Julian's|Mdina|Birgu|Mellieħa|Victoria",
  GR: "Athens|Thessaloniki|Patras|Heraklion|Larissa|Rhodes|Mykonos|Santorini|Corfu|Chania|Paros",
  CY: "Nicosia|Limassol|Larnaca|Paphos|Ayia Napa",
  DK: "Copenhagen|Aarhus|Odense|Aalborg|Esbjerg|Skagen",
  SE: "Stockholm|Gothenburg|Malmö|Uppsala|Västerås|Örebro|Båstad",
  NO: "Oslo|Bergen|Trondheim|Stavanger|Tromsø|Ålesund",
  FI: "Helsinki|Espoo|Tampere|Vantaa|Turku|Oulu|Rovaniemi",
  IS: "Reykjavík|Kópavogur|Akureyri",
  EE: "Tallinn|Tartu|Pärnu",
  LV: "Riga|Daugavpils|Jūrmala",
  LT: "Vilnius|Kaunas|Klaipėda|Palanga",
  PL: "Warsaw|Kraków|Łódź|Wrocław|Poznań|Gdańsk|Szczecin|Sopot|Zakopane",
  CZ: "Prague|Brno|Ostrava|Plzeň|Karlovy Vary|Český Krumlov",
  SK: "Bratislava|Košice|Prešov|Žilina",
  HU: "Budapest|Debrecen|Szeged|Miskolc|Pécs|Győr",
  SI: "Ljubljana|Maribor|Bled|Piran",
  HR: "Zagreb|Split|Rijeka|Osijek|Dubrovnik|Zadar|Hvar|Rovinj",
  BA: "Sarajevo|Banja Luka|Mostar|Tuzla",
  RS: "Belgrade|Novi Sad|Niš|Kragujevac",
  ME: "Podgorica|Budva|Kotor|Herceg Novi|Tivat",
  MK: "Skopje|Bitola|Ohrid",
  AL: "Tirana|Durrës|Vlorë|Shkodër|Sarandë",
  XK: "Pristina|Prizren",
  BG: "Sofia|Plovdiv|Varna|Burgas|Bansko",
  RO: "Bucharest|Cluj-Napoca|Timișoara|Iași|Constanța|Brașov|Sibiu",
  MD: "Chișinău|Bălți|Tiraspol",
  UA: "Kyiv|Kharkiv|Odesa|Dnipro|Lviv|Zaporizhzhia",
  BY: "Minsk|Gomel|Mogilev|Vitebsk|Grodno|Brest",
  RU: "Moscow|Saint Petersburg|Novosibirsk|Yekaterinburg|Kazan|Nizhny Novgorod|Chelyabinsk|Samara|Omsk|Rostov-on-Don|Sochi|Vladivostok|Kaliningrad",
  TR: "Istanbul|Ankara|İzmir|Bursa|Antalya|Adana|Konya|Gaziantep|Bodrum|Fethiye|Çeşme|Kaş",
  GE: "Tbilisi|Batumi|Kutaisi|Rustavi",
  AM: "Yerevan|Gyumri|Vanadzor",
  AZ: "Baku|Ganja|Sumgait",
  GI: "Gibraltar",
  GG: "St Peter Port",
  JE: "St Helier",
  IM: "Douglas",
  FO: "Tórshavn",
  AX: "Mariehamn",
  SJ: "Longyearbyen",
  // The Middle East
  AE: "Dubai|Abu Dhabi|Sharjah|Al Ain|Ajman|Ras Al Khaimah|Fujairah",
  SA: "Riyadh|Jeddah|Mecca|Medina|Dammam|Khobar|Taif|AlUla",
  QA: "Doha|Al Wakrah|Lusail",
  BH: "Manama|Muharraq|Riffa",
  KW: "Kuwait City|Hawalli|Salmiya",
  OM: "Muscat|Salalah|Sohar|Nizwa",
  YE: "Sanaa|Aden|Taiz",
  JO: "Amman|Zarqa|Irbid|Aqaba",
  IL: "Jerusalem|Tel Aviv|Haifa|Rishon LeZion|Petah Tikva|Netanya|Herzliya|Eilat",
  PS: "Gaza|Hebron|Nablus|Ramallah|Bethlehem",
  LB: "Beirut|Tripoli|Sidon|Byblos",
  SY: "Damascus|Aleppo|Homs|Latakia",
  IQ: "Baghdad|Basra|Mosul|Erbil|Najaf",
  IR: "Tehran|Mashhad|Isfahan|Karaj|Shiraz|Tabriz",
  AF: "Kabul|Kandahar|Herat|Mazar-i-Sharif",
  // Asia
  CN: "Shanghai|Beijing|Chongqing|Tianjin|Guangzhou|Shenzhen|Chengdu|Wuhan|Hangzhou|Xi'an|Nanjing|Suzhou|Qingdao|Xiamen|Dalian|Kunming|Sanya",
  HK: "Hong Kong|Kowloon|Sai Kung|Repulse Bay|Lantau",
  MO: "Macau|Taipa|Coloane",
  TW: "Taipei|New Taipei|Kaohsiung|Taichung|Tainan|Hsinchu",
  JP: "Tokyo|Yokohama|Osaka|Nagoya|Sapporo|Fukuoka|Kobe|Kyoto|Kawasaki|Hiroshima|Sendai|Naha|Kanazawa|Hakone|Karuizawa|Niseko",
  KR: "Seoul|Busan|Incheon|Daegu|Daejeon|Gwangju|Ulsan|Suwon|Jeju",
  KP: "Pyongyang|Hamhung|Chongjin",
  MN: "Ulaanbaatar|Erdenet|Darkhan",
  IN: "Mumbai|Delhi|Bengaluru|Hyderabad|Ahmedabad|Chennai|Kolkata|Pune|Jaipur|Surat|Lucknow|Chandigarh|Gurugram|Kochi|Agra|Udaipur|Goa",
  PK: "Karachi|Lahore|Faisalabad|Rawalpindi|Islamabad|Multan|Peshawar|Quetta",
  BD: "Dhaka|Chittagong|Khulna|Rajshahi|Sylhet|Cox's Bazar",
  LK: "Colombo|Kandy|Galle|Negombo|Jaffna|Bentota",
  MV: "Malé|Addu City|Maafushi",
  NP: "Kathmandu|Pokhara|Lalitpur|Bharatpur",
  BT: "Thimphu|Paro|Punakha",
  MM: "Yangon|Mandalay|Naypyidaw|Bagan",
  TH: "Bangkok|Chiang Mai|Phuket|Pattaya|Koh Samui|Hua Hin|Krabi|Nonthaburi|Khon Kaen|Udon Thani",
  LA: "Vientiane|Luang Prabang|Pakse|Savannakhet",
  KH: "Phnom Penh|Siem Reap|Sihanoukville|Battambang|Kampot",
  VN: "Ho Chi Minh City|Hanoi|Da Nang|Hai Phong|Can Tho|Nha Trang|Hoi An|Hue|Da Lat|Phu Quoc",
  MY: "Kuala Lumpur|George Town|Johor Bahru|Ipoh|Kota Kinabalu|Kuching|Malacca|Shah Alam|Petaling Jaya|Langkawi",
  SG: "Singapore",
  BN: "Bandar Seri Begawan|Kuala Belait",
  ID: "Jakarta|Surabaya|Bandung|Medan|Semarang|Makassar|Palembang|Denpasar|Yogyakarta|Ubud|Canggu|Seminyak|Uluwatu|Mataram",
  PH: "Manila|Quezon City|Davao City|Cebu City|Makati|Taguig|Baguio|Iloilo City|Boracay|El Nido|Siargao",
  TL: "Dili|Baucau",
  KZ: "Almaty|Astana|Shymkent|Karaganda|Aktobe",
  UZ: "Tashkent|Samarkand|Bukhara|Namangan|Andijan",
  TM: "Ashgabat|Türkmenabat|Daşoguz",
  KG: "Bishkek|Osh|Karakol",
  TJ: "Dushanbe|Khujand|Kulob",
  // Oceania
  AU: "Sydney|Melbourne|Brisbane|Perth|Adelaide|Gold Coast|Canberra|Newcastle|Hobart|Darwin|Cairns|Sunshine Coast|Byron Bay|Noosa",
  NZ: "Auckland|Wellington|Christchurch|Hamilton|Tauranga|Dunedin|Napier|Nelson|Queenstown|Wanaka",
  FJ: "Suva|Nadi|Lautoka|Denarau",
  PG: "Port Moresby|Lae|Mount Hagen",
  NC: "Nouméa",
  PF: "Papeete|Bora Bora|Moorea",
  WS: "Apia",
  TO: "Nuku'alofa",
  VU: "Port Vila|Luganville",
  SB: "Honiara",
  KI: "South Tarawa",
  MH: "Majuro",
  FM: "Palikir|Weno",
  PW: "Koror|Ngerulmud",
  NR: "Yaren",
  TV: "Funafuti",
  CK: "Avarua|Aitutaki",
  NU: "Alofi",
  TK: "Atafu|Nukunonu|Fakaofo",
  WF: "Mata-Utu",
  GU: "Hagåtña|Tamuning|Dededo",
  MP: "Saipan",
  AS: "Pago Pago",
  NF: "Kingston",
  PN: "Adamstown",
  CX: "Flying Fish Cove",
  CC: "West Island",
  // Africa
  EG: "Cairo|Alexandria|Giza|Luxor|Aswan|Sharm El Sheikh|Hurghada|El Gouna",
  MA: "Casablanca|Rabat|Marrakesh|Fes|Tangier|Agadir|Meknes|Essaouira",
  DZ: "Algiers|Oran|Constantine|Annaba",
  TN: "Tunis|Sfax|Sousse|Hammamet|Djerba",
  LY: "Tripoli|Benghazi|Misrata",
  SD: "Khartoum|Omdurman|Port Sudan",
  SS: "Juba|Wau",
  ET: "Addis Ababa|Dire Dawa|Mekelle|Bahir Dar|Gondar",
  ER: "Asmara|Massawa",
  DJ: "Djibouti",
  SO: "Mogadishu|Hargeisa|Kismayo",
  KE: "Nairobi|Mombasa|Kisumu|Nakuru|Malindi|Lamu|Diani Beach",
  TZ: "Dar es Salaam|Dodoma|Arusha|Mwanza|Zanzibar City",
  UG: "Kampala|Entebbe|Gulu|Jinja|Mbarara",
  RW: "Kigali|Musanze|Huye|Gisenyi",
  BI: "Bujumbura|Gitega",
  NG: "Lagos|Abuja|Kano|Ibadan|Port Harcourt|Benin City|Kaduna|Enugu|Calabar",
  GH: "Accra|Kumasi|Tamale|Takoradi|Cape Coast",
  CI: "Abidjan|Yamoussoukro|Bouaké|San-Pédro|Assinie",
  SN: "Dakar|Touba|Thiès|Saint-Louis|Saly",
  ML: "Bamako|Sikasso|Timbuktu",
  BF: "Ouagadougou|Bobo-Dioulasso",
  NE: "Niamey|Zinder|Maradi",
  TD: "N'Djamena|Moundou",
  MR: "Nouakchott|Nouadhibou",
  GM: "Banjul|Serekunda",
  GN: "Conakry|Nzérékoré|Kankan",
  GW: "Bissau",
  SL: "Freetown|Bo|Kenema",
  LR: "Monrovia|Gbarnga",
  TG: "Lomé|Sokodé|Kara",
  BJ: "Cotonou|Porto-Novo|Parakou",
  CM: "Douala|Yaoundé|Bamenda|Kribi|Limbe",
  CF: "Bangui",
  GA: "Libreville|Port-Gentil",
  GQ: "Malabo|Bata",
  CG: "Brazzaville|Pointe-Noire",
  CD: "Kinshasa|Lubumbashi|Mbuji-Mayi|Kisangani|Goma",
  AO: "Luanda|Huambo|Lobito|Benguela",
  ZM: "Lusaka|Kitwe|Ndola|Livingstone",
  ZW: "Harare|Bulawayo|Mutare|Victoria Falls",
  MW: "Lilongwe|Blantyre|Mzuzu|Zomba",
  MZ: "Maputo|Matola|Beira|Nampula|Pemba|Vilankulo",
  BW: "Gaborone|Francistown|Maun|Kasane",
  NA: "Windhoek|Walvis Bay|Swakopmund|Rundu",
  ZA: "Johannesburg|Cape Town|Durban|Pretoria|Gqeberha|Bloemfontein|Sandton|Stellenbosch|Franschhoek|Umhlanga|Hermanus|Plettenberg Bay",
  LS: "Maseru|Teyateyaneng",
  SZ: "Mbabane|Manzini|Lobamba",
  MG: "Antananarivo|Toamasina|Antsirabe|Mahajanga|Nosy Be",
  MU: "Port Louis|Curepipe|Grand Baie|Flic en Flac|Tamarin|Belle Mare",
  SC: "Victoria|Praslin|La Digue",
  KM: "Moroni|Mutsamudu",
  RE: "Saint-Denis|Saint-Paul|Saint-Pierre|Saint-Gilles-les-Bains",
  YT: "Mamoudzou",
  CV: "Praia|Mindelo|Santa Maria|Sal Rei",
  ST: "São Tomé|Santo António",
  SH: "Jamestown",
  EH: "Laayoune|Dakhla",
};

const NAMES = new Map(COUNTRIES.map(([code, name]) => [code, name]));

/** The English name for a code, or the code itself when it isn't on the list. */
export const countryName = (code: string) => NAMES.get(code.toUpperCase()) ?? code.toUpperCase();

/** The listed cities of a country, largest first. */
export const citiesOf = (code: string): string[] => (CITIES[code.toUpperCase()] ?? "").split("|").filter(Boolean);

/** Text folded for matching: no accents, lower case, letters and digits only, single spaces. "Łódź" matches "lodz". */
export function fold(s: string): string {
  let t = s.toLowerCase().replace(/ł/g, "l").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ß/g, "ss").replace(/đ/g, "d").replace(/ı/g, "i").replace(/ħ/g, "h");
  try {
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    // An engine without normalize keeps the accents; matching still works on unaccented names.
  }
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/** 0 when `text` starts with the query, 1 when one of its words does, 2 when it contains it, -1 otherwise. */
function rank(text: string, q: string): number {
  const f = fold(text);
  if (f.startsWith(q)) return 0;
  if (f.split(" ").some((w) => w.startsWith(q))) return 1;
  return f.includes(q) ? 2 : -1;
}

export interface CountryHit {
  code: string;
  name: string;
  /** A listed city that matched the query, for "Paris, France" when someone types a city first. */
  city?: string;
}

const BY_NAME = [...COUNTRIES].sort((a, b) => a[1].localeCompare(b[1], "en"));

/** Countries for a search: by name or another name, then by a city in them. Everything, alphabetically, for no query. */
export function searchCountries(query: string, limit = 400): CountryHit[] {
  const q = fold(query);
  if (!q) return BY_NAME.map(([code, name]) => ({ code, name })).slice(0, limit);
  const hits: { hit: CountryHit; score: number }[] = [];
  for (const [code, name] of BY_NAME) {
    // An exact name ("Mali") or another name typed in full ("UK", "USA") goes first.
    if (fold(name) === q || (ALIASES[code] && fold(ALIASES[code]!).split(" ").includes(q))) {
      hits.push({ hit: { code, name }, score: -1 });
      continue;
    }
    const byName = rank(name, q);
    const byAlias = ALIASES[code] ? rank(ALIASES[code]!, q) : -1;
    const by = [byName, byAlias >= 0 ? byAlias + 1 : -1].filter((r) => r >= 0);
    if (by.length) {
      hits.push({ hit: { code, name }, score: Math.min(...by) });
      continue;
    }
    if (q.length < 3) continue;
    const city = citiesOf(code).find((c) => rank(c, q) === 0 || rank(c, q) === 1);
    if (city) hits.push({ hit: { code, name, city }, score: 10 + citiesOf(code).indexOf(city) / 100 });
  }
  return hits.sort((a, b) => a.score - b.score).map((h) => h.hit).slice(0, limit);
}

/** A country's cities for a search, starts-with matches first, each group largest first. */
export function searchCities(code: string, query: string): string[] {
  const all = citiesOf(code);
  const q = fold(query);
  if (!q) return all;
  return all
    .map((c, i) => ({ c, i, r: rank(c, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

/** A typed city tidied for saving: one line, single spaces, at most 80 characters. Empty means none. */
export function cleanCity(raw: string): string | null {
  const c = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return c || null;
}

/** What the place is called on the account: "Lisbon, Portugal", or the country alone. Fits the API's 80 characters. */
export function placeLabel(code: string, city?: string | null): string {
  const country = countryName(code);
  if (!city) return country.slice(0, 80);
  const full = `${city}, ${country}`;
  return full.length <= 80 ? full : city.slice(0, 80);
}
