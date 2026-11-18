// Places named on the map. Coordinates are WGS84.
//
// Universities and single buildings stand on the address of their main
// building, looked up in the address register (BAG) through PDOK.
//
// Blurbs stick to things that do not change from year to year. Population
// figures are not written here on purpose: the map counts residents from
// the CBS grid instead.

export type PlaceKind = "city" | "university" | "landmark" | "water";

export interface Place {
  id: string;
  name: string;
  /** English name, where it differs from the Dutch one. */
  english?: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** 1 shows from far away, 3 only when zoomed in. */
  rank: 1 | 2 | 3;
  /** A single spot, such as a building: the map goes down to its street. */
  streets?: boolean;
  blurb: string;
}

export const places: Place[] = [
  // ------------------------------------------------------------- cities --
  {
    id: "amsterdam",
    name: "Amsterdam",
    kind: "city",
    lat: 52.3728,
    lon: 4.8936,
    rank: 1,
    blurb:
      "The capital and the largest city, though the government sits in The Hague.",
  },
  {
    id: "rotterdam",
    name: "Rotterdam",
    kind: "city",
    lat: 51.9225,
    lon: 4.4792,
    rank: 1,
    blurb:
      "The second city, and Europe's largest seaport. The centre was rebuilt after the bombing of May 1940, which is why it looks like no other Dutch city.",
  },
  {
    id: "den-haag",
    name: "Den Haag",
    english: "The Hague",
    kind: "city",
    lat: 52.0705,
    lon: 4.3007,
    rank: 1,
    blurb:
      "Seat of the government and parliament, and home to the International Court of Justice.",
  },
  {
    id: "utrecht",
    name: "Utrecht",
    kind: "city",
    lat: 52.0907,
    lon: 5.1214,
    rank: 1,
    blurb:
      "The middle of the country and of its rail network. Utrecht Centraal is the busiest station in the Netherlands.",
  },
  {
    id: "eindhoven",
    name: "Eindhoven",
    kind: "city",
    lat: 51.4416,
    lon: 5.4697,
    rank: 2,
    blurb:
      "The technology and design city of the south, where Philips began. ASML is next door in Veldhoven.",
  },
  {
    id: "groningen",
    name: "Groningen",
    kind: "city",
    lat: 53.2194,
    lon: 6.5665,
    rank: 2,
    blurb:
      "The main city of the north and capital of the province of the same name, with a large student population.",
  },
  {
    id: "maastricht",
    name: "Maastricht",
    kind: "city",
    lat: 50.8514,
    lon: 5.691,
    rank: 2,
    blurb:
      "Capital of Limburg, in the one hilly corner of the country. The treaty that founded the European Union was signed here in 1992.",
  },
  {
    id: "arnhem",
    name: "Arnhem",
    kind: "city",
    lat: 51.9851,
    lon: 5.8987,
    rank: 2,
    blurb: "Capital of Gelderland, on the Rhine at the edge of the Veluwe.",
  },
  {
    id: "nijmegen",
    name: "Nijmegen",
    kind: "city",
    lat: 51.8126,
    lon: 5.8372,
    rank: 3,
    blurb:
      "One of the oldest cities in the country, on the river Waal. Radboud University is here.",
  },
  {
    id: "tilburg",
    name: "Tilburg",
    kind: "city",
    lat: 51.5555,
    lon: 5.0913,
    rank: 3,
    blurb: "A university city in Noord-Brabant, between Breda and Eindhoven.",
  },
  {
    id: "breda",
    name: "Breda",
    kind: "city",
    lat: 51.5719,
    lon: 4.7683,
    rank: 3,
    blurb: "A city in the west of Noord-Brabant, on the line to Antwerp.",
  },
  {
    id: "den-bosch",
    name: "’s-Hertogenbosch",
    english: "Den Bosch",
    kind: "city",
    lat: 51.6978,
    lon: 5.3037,
    rank: 3,
    blurb: "Capital of Noord-Brabant. Everyone calls it Den Bosch.",
  },
  {
    id: "haarlem",
    name: "Haarlem",
    kind: "city",
    lat: 52.3874,
    lon: 4.6462,
    rank: 3,
    blurb:
      "Capital of Noord-Holland, a short train ride west of Amsterdam and close to the dunes.",
  },
  {
    id: "leiden",
    name: "Leiden",
    kind: "city",
    lat: 52.1601,
    lon: 4.497,
    rank: 3,
    blurb: "Home to the oldest university in the country, founded in 1575.",
  },
  {
    id: "delft",
    name: "Delft",
    kind: "city",
    lat: 52.0116,
    lon: 4.3571,
    rank: 3,
    blurb:
      "Known for its University of Technology and for Delft Blue pottery. It sits between The Hague and Rotterdam.",
  },
  {
    id: "almere",
    name: "Almere",
    kind: "city",
    lat: 52.3508,
    lon: 5.2647,
    rank: 3,
    blurb:
      "Built from the 1970s on land reclaimed from the sea, and now one of the ten largest cities.",
  },
  {
    id: "lelystad",
    name: "Lelystad",
    kind: "city",
    lat: 52.5185,
    lon: 5.4714,
    rank: 3,
    blurb:
      "Capital of Flevoland, the province made in the 20th century from the bed of the Zuiderzee. The city lies several metres below sea level.",
  },
  {
    id: "amersfoort",
    name: "Amersfoort",
    kind: "city",
    lat: 52.1561,
    lon: 5.3878,
    rank: 3,
    blurb:
      "The zero point of the national map grid. Dutch map coordinates are measured from the tower of Our Lady in the old centre.",
  },
  {
    id: "zwolle",
    name: "Zwolle",
    kind: "city",
    lat: 52.5168,
    lon: 6.083,
    rank: 2,
    blurb: "Capital of Overijssel and the rail junction for the north-east.",
  },
  {
    id: "enschede",
    name: "Enschede",
    kind: "city",
    lat: 52.2215,
    lon: 6.8937,
    rank: 3,
    blurb:
      "The largest city of the Twente region, next to the German border. The University of Twente is here.",
  },
  {
    id: "leeuwarden",
    name: "Leeuwarden",
    kind: "city",
    lat: 53.2012,
    lon: 5.7999,
    rank: 2,
    blurb:
      "Capital of Fryslân, where Frisian is an official language alongside Dutch.",
  },
  {
    id: "assen",
    name: "Assen",
    kind: "city",
    lat: 52.9925,
    lon: 6.5649,
    rank: 3,
    blurb: "Capital of Drenthe, known for the TT motorcycle races.",
  },
  {
    id: "middelburg",
    name: "Middelburg",
    kind: "city",
    lat: 51.4988,
    lon: 3.611,
    rank: 2,
    blurb: "Capital of Zeeland, the province of islands and sea arms.",
  },
  {
    id: "wageningen",
    name: "Wageningen",
    kind: "city",
    lat: 51.9692,
    lon: 5.6654,
    rank: 3,
    blurb:
      "A small town with a university known around the world for agriculture and food science.",
  },

  // ------------------------------------------------------- universities --
  // The fourteen public universities.
  {
    id: "uva",
    name: "Universiteit van Amsterdam",
    english: "University of Amsterdam",
    kind: "university",
    lat: 52.36385,
    lon: 4.91128,
    rank: 1,
    streets: true,
    blurb:
      "Began in 1632 as the Athenaeum Illustre. Its buildings are spread over the city; the pin is on the Roeterseiland campus.",
  },
  {
    id: "vu",
    name: "Vrije Universiteit",
    english: "VU Amsterdam",
    kind: "university",
    lat: 52.33459,
    lon: 4.86648,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1880. The campus is on De Boelelaan, next to the Zuidas business district.",
  },
  {
    id: "leiden-university",
    name: "Universiteit Leiden",
    english: "Leiden University",
    kind: "university",
    lat: 52.15693,
    lon: 4.48559,
    rank: 1,
    streets: true,
    blurb:
      "The oldest university in the country, founded in 1575. The pin is on the Academiegebouw on the Rapenburg canal.",
  },
  {
    id: "utrecht-university",
    name: "Universiteit Utrecht",
    english: "Utrecht University",
    kind: "university",
    lat: 52.08518,
    lon: 5.17545,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1636. Most of it is at Utrecht Science Park, on the east side of the city.",
  },
  {
    id: "rug",
    name: "Rijksuniversiteit Groningen",
    english: "University of Groningen",
    kind: "university",
    lat: 53.21925,
    lon: 6.5631,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1614, the second oldest in the country. The pin is on the Academiegebouw in the city centre.",
  },
  {
    id: "erasmus-university",
    name: "Erasmus Universiteit",
    english: "Erasmus University Rotterdam",
    kind: "university",
    lat: 51.91906,
    lon: 4.52516,
    rank: 1,
    streets: true,
    blurb:
      "Named after the scholar Erasmus of Rotterdam. It became a university in 1973 and has its campus at Woudestein.",
  },
  {
    id: "tu-delft",
    name: "TU Delft",
    english: "Delft University of Technology",
    kind: "university",
    lat: 52.00211,
    lon: 4.37322,
    rank: 1,
    streets: true,
    blurb:
      "The oldest and largest university of technology in the country. It began in 1842 as an academy for civil engineers.",
  },
  {
    id: "tu-eindhoven",
    name: "TU Eindhoven",
    english: "Eindhoven University of Technology",
    kind: "university",
    lat: 51.44789,
    lon: 5.48595,
    rank: 1,
    streets: true,
    blurb:
      "A university of technology founded in 1956, on a campus beside the city centre.",
  },
  {
    id: "university-of-twente",
    name: "Universiteit Twente",
    english: "University of Twente",
    kind: "university",
    lat: 52.23984,
    lon: 6.84991,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1961 on the Drienerlo estate between Enschede and Hengelo, where students also live on campus.",
  },
  {
    id: "wur",
    name: "Wageningen University",
    english: "Wageningen University & Research",
    kind: "university",
    lat: 51.98521,
    lon: 5.66346,
    rank: 1,
    streets: true,
    blurb:
      "Known around the world for agriculture, food and the environment. It became a university in 1918.",
  },
  {
    id: "radboud-university",
    name: "Radboud Universiteit",
    english: "Radboud University",
    kind: "university",
    lat: 51.81689,
    lon: 5.86549,
    rank: 1,
    streets: true,
    blurb:
      "Founded in Nijmegen in 1923 as the Catholic University.",
  },
  {
    id: "maastricht-university",
    name: "Universiteit Maastricht",
    english: "Maastricht University",
    kind: "university",
    lat: 50.84713,
    lon: 5.68642,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1976. It teaches in small groups, and a large share of its students come from abroad.",
  },
  {
    id: "tilburg-university",
    name: "Tilburg University",
    kind: "university",
    lat: 51.56289,
    lon: 5.04176,
    rank: 1,
    streets: true,
    blurb:
      "Founded in 1927, with a campus on the west side of Tilburg. Its strengths are economics, law and the social sciences.",
  },
  {
    id: "open-universiteit",
    name: "Open Universiteit",
    english: "Open University",
    kind: "university",
    lat: 50.8787,
    lon: 5.95765,
    rank: 1,
    streets: true,
    blurb:
      "A university for studying at a distance, founded in 1984. Its head office is in Heerlen.",
  },

  // ---------------------------------------------------------- landmarks --
  {
    id: "rijksmuseum",
    name: "Rijksmuseum",
    kind: "landmark",
    lat: 52.35994,
    lon: 4.88539,
    rank: 2,
    streets: true,
    blurb:
      "The national museum of art and history, home of Rembrandt's Night Watch. The building opened in 1885.",
  },
  {
    id: "anne-frank-huis",
    name: "Anne Frank Huis",
    english: "Anne Frank House",
    kind: "landmark",
    lat: 52.37494,
    lon: 4.88432,
    rank: 3,
    streets: true,
    blurb:
      "The canal house where Anne Frank hid from 1942 to 1944 and wrote her diary. It is a museum now.",
  },
  {
    id: "koninklijk-paleis",
    name: "Koninklijk Paleis",
    english: "Royal Palace Amsterdam",
    kind: "landmark",
    lat: 52.37316,
    lon: 4.8909,
    rank: 3,
    streets: true,
    blurb:
      "Built in the 17th century as the town hall of Amsterdam, and a royal palace since 1808. It stands on Dam square.",
  },
  {
    id: "van-gogh-museum",
    name: "Van Gogh Museum",
    kind: "landmark",
    lat: 52.35792,
    lon: 4.88132,
    rank: 3,
    streets: true,
    blurb:
      "The largest collection of Vincent van Gogh's paintings in the world, on Museumplein.",
  },
  {
    id: "johan-cruijff-arena",
    name: "Johan Cruijff ArenA",
    kind: "landmark",
    lat: 52.31375,
    lon: 4.94053,
    rank: 3,
    streets: true,
    blurb:
      "The largest stadium in the country and the home of Ajax. It opened in 1996.",
  },
  {
    id: "binnenhof",
    name: "Binnenhof",
    kind: "landmark",
    lat: 52.0795,
    lon: 4.31301,
    rank: 2,
    streets: true,
    blurb:
      "The centre of Dutch politics for centuries, built around the 13th-century Ridderzaal. A long renovation began in 2021.",
  },
  {
    id: "vredespaleis",
    name: "Vredespaleis",
    english: "Peace Palace",
    kind: "landmark",
    lat: 52.08665,
    lon: 4.29582,
    rank: 3,
    streets: true,
    blurb:
      "Seat of the International Court of Justice and the Permanent Court of Arbitration. It opened in 1913.",
  },
  {
    id: "mauritshuis",
    name: "Mauritshuis",
    kind: "landmark",
    lat: 52.08034,
    lon: 4.31439,
    rank: 3,
    streets: true,
    blurb:
      "A small museum of Dutch Golden Age painting, home of Vermeer's Girl with a Pearl Earring.",
  },
  {
    id: "madurodam",
    name: "Madurodam",
    kind: "landmark",
    lat: 52.0991,
    lon: 4.29904,
    rank: 3,
    streets: true,
    blurb:
      "The Netherlands in miniature, at a scale of 1 to 25. It opened in 1952.",
  },
  {
    id: "scheveningen-pier",
    name: "De Pier",
    english: "Scheveningen Pier",
    kind: "landmark",
    lat: 52.11717,
    lon: 4.27941,
    rank: 3,
    streets: true,
    blurb:
      "The pier of Scheveningen, the beach resort of The Hague.",
  },
  {
    id: "euromast",
    name: "Euromast",
    kind: "landmark",
    lat: 51.9054,
    lon: 4.46651,
    rank: 3,
    streets: true,
    blurb:
      "An observation tower built in 1960. With the mast added in 1970 it is 185 metres tall.",
  },
  {
    id: "erasmusbrug",
    name: "Erasmusbrug",
    english: "Erasmus Bridge",
    kind: "landmark",
    lat: 51.90963,
    lon: 4.48559,
    rank: 2,
    streets: true,
    blurb:
      "The bridge over the Nieuwe Maas that joins the north and south of Rotterdam. It opened in 1996 and is nicknamed the Swan.",
  },
  {
    id: "markthal",
    name: "Markthal",
    english: "Market Hall",
    kind: "landmark",
    lat: 51.91977,
    lon: 4.48626,
    rank: 3,
    streets: true,
    blurb:
      "A covered market under an arch of apartments, opened in 2014.",
  },
  {
    id: "kubuswoningen",
    name: "Kubuswoningen",
    english: "Cube Houses",
    kind: "landmark",
    lat: 51.92019,
    lon: 4.49057,
    rank: 3,
    streets: true,
    blurb:
      "Houses shaped like cubes standing on one corner, designed by Piet Blom.",
  },
  {
    id: "van-nellefabriek",
    name: "Van Nellefabriek",
    english: "Van Nelle Factory",
    kind: "landmark",
    lat: 51.92285,
    lon: 4.43469,
    rank: 3,
    streets: true,
    blurb:
      "A factory of steel and glass from around 1930, and a UNESCO World Heritage site.",
  },
  {
    id: "domtoren",
    name: "Domtoren",
    english: "Dom Tower",
    kind: "landmark",
    lat: 52.09062,
    lon: 5.12143,
    rank: 2,
    streets: true,
    blurb:
      "The tallest church tower in the country, 112 metres. The nave that joined it to the church fell in a storm in 1674.",
  },
  {
    id: "kasteel-de-haar",
    name: "Kasteel de Haar",
    english: "De Haar Castle",
    kind: "landmark",
    lat: 52.12008,
    lon: 4.98414,
    rank: 3,
    streets: true,
    blurb:
      "The largest castle in the country, rebuilt from 1892 on medieval ruins.",
  },
  {
    id: "rietveld-schroderhuis",
    name: "Rietveld Schröderhuis",
    english: "Rietveld Schröder House",
    kind: "landmark",
    lat: 52.08532,
    lon: 5.14752,
    rank: 3,
    streets: true,
    blurb:
      "A house from 1924 by Gerrit Rietveld, the best-known building of De Stijl. A UNESCO World Heritage site.",
  },
  {
    id: "martinitoren",
    name: "Martinitoren",
    english: "Martini Tower",
    kind: "landmark",
    lat: 53.21938,
    lon: 6.56821,
    rank: 2,
    streets: true,
    blurb:
      "The tower on the Grote Markt of Groningen, close to 100 metres tall. Locals call it d'Olle Grieze, the old grey one.",
  },
  {
    id: "groninger-museum",
    name: "Groninger Museum",
    kind: "landmark",
    lat: 53.21259,
    lon: 6.56579,
    rank: 3,
    streets: true,
    blurb:
      "A museum of art in a brightly coloured building of 1994, on an island in the canal opposite the station.",
  },
  {
    id: "sint-jan",
    name: "Sint-Janskathedraal",
    english: "St John's Cathedral",
    kind: "landmark",
    lat: 51.68839,
    lon: 5.30815,
    rank: 3,
    streets: true,
    blurb:
      "The Gothic cathedral of 's-Hertogenbosch.",
  },
  {
    id: "sint-servaas",
    name: "Sint-Servaasbasiliek",
    english: "Basilica of Saint Servatius",
    kind: "landmark",
    lat: 50.84945,
    lon: 5.68715,
    rank: 3,
    streets: true,
    blurb:
      "A Romanesque church on the Vrijthof in Maastricht, one of the oldest in the country, built over the grave of Saint Servatius.",
  },
  {
    id: "efteling",
    name: "Efteling",
    kind: "landmark",
    lat: 51.65249,
    lon: 5.0509,
    rank: 2,
    streets: true,
    blurb:
      "The largest theme park in the country, grown from a fairy-tale forest that opened in 1952.",
  },
  {
    id: "paleis-het-loo",
    name: "Paleis Het Loo",
    english: "Het Loo Palace",
    kind: "landmark",
    lat: 52.2341,
    lon: 5.94601,
    rank: 2,
    streets: true,
    blurb:
      "A palace built in the 1680s for stadtholder William III, with formal gardens. It is a museum.",
  },
  {
    id: "kroller-muller",
    name: "Kröller-Müller Museum",
    kind: "landmark",
    lat: 52.09622,
    lon: 5.81766,
    rank: 3,
    streets: true,
    blurb:
      "A museum in the middle of De Hoge Veluwe park, with a large Van Gogh collection and a sculpture garden.",
  },
  {
    id: "openluchtmuseum",
    name: "Openluchtmuseum",
    english: "Netherlands Open Air Museum",
    kind: "landmark",
    lat: 52.00809,
    lon: 5.90722,
    rank: 3,
    streets: true,
    blurb:
      "Farms, houses and mills from all over the country, moved here and rebuilt.",
  },
  {
    id: "airborne-museum",
    name: "Airborne Museum",
    kind: "landmark",
    lat: 51.98768,
    lon: 5.83275,
    rank: 3,
    streets: true,
    blurb:
      "A museum of the Battle of Arnhem, in the villa that was the British headquarters in September 1944.",
  },
  {
    id: "zaanse-schans",
    name: "Zaanse Schans",
    kind: "landmark",
    lat: 52.47363,
    lon: 4.82232,
    rank: 2,
    streets: true,
    blurb:
      "Windmills and green wooden houses on the river Zaan, north of Amsterdam.",
  },
  {
    id: "muiderslot",
    name: "Muiderslot",
    english: "Muiden Castle",
    kind: "landmark",
    lat: 52.3334,
    lon: 5.07127,
    rank: 3,
    streets: true,
    blurb:
      "A moated castle from the 13th century, at the mouth of the river Vecht.",
  },
  {
    id: "naarden-vesting",
    name: "Naarden-Vesting",
    kind: "landmark",
    lat: 52.29573,
    lon: 5.16368,
    rank: 3,
    streets: true,
    blurb:
      "A fortified town in the shape of a star, with its walls and moats intact.",
  },
  {
    id: "giethoorn",
    name: "Giethoorn",
    kind: "landmark",
    lat: 52.72398,
    lon: 6.0902,
    rank: 2,
    streets: true,
    blurb:
      "A village where the old part has canals instead of streets, and the houses are reached by footbridge and by boat.",
  },
  {
    id: "bourtange",
    name: "Bourtange",
    kind: "landmark",
    lat: 53.00859,
    lon: 7.18964,
    rank: 3,
    streets: true,
    blurb:
      "A star fort from 1593 near the German border, rebuilt as it was in the 18th century.",
  },
  {
    id: "schokland",
    name: "Schokland",
    kind: "landmark",
    lat: 52.63457,
    lon: 5.77763,
    rank: 3,
    streets: true,
    blurb:
      "An island in the Zuiderzee until the sea around it was drained. It is now a low rise in the fields, and a UNESCO World Heritage site.",
  },
  {
    id: "woudagemaal",
    name: "Woudagemaal",
    english: "Wouda Pumping Station",
    kind: "landmark",
    lat: 52.84641,
    lon: 5.67835,
    rank: 3,
    streets: true,
    blurb:
      "The largest steam pumping station still in working order, opened in 1920. A UNESCO World Heritage site.",
  },
  {
    id: "planetarium-franeker",
    name: "Eise Eisinga Planetarium",
    kind: "landmark",
    lat: 53.18737,
    lon: 5.54377,
    rank: 3,
    streets: true,
    blurb:
      "A working model of the solar system on a living-room ceiling, built by a wool comber between 1774 and 1781. A UNESCO World Heritage site.",
  },
  {
    id: "waag-alkmaar",
    name: "Waag",
    english: "Alkmaar cheese market",
    kind: "landmark",
    lat: 52.63139,
    lon: 4.74991,
    rank: 3,
    streets: true,
    blurb:
      "The weigh house of Alkmaar. The cheese market is held on the square in front of it.",
  },
  {
    id: "stadhuis-gouda",
    name: "Stadhuis Gouda",
    english: "Gouda old town hall",
    kind: "landmark",
    lat: 52.01153,
    lon: 4.71047,
    rank: 3,
    streets: true,
    blurb:
      "A Gothic town hall from the 15th century, standing free in the middle of the market square.",
  },
  {
    id: "nieuwe-kerk-delft",
    name: "Nieuwe Kerk",
    english: "New Church, Delft",
    kind: "landmark",
    lat: 52.01208,
    lon: 4.36019,
    rank: 3,
    streets: true,
    blurb:
      "The church on the market square of Delft where William of Orange and members of the royal house are buried.",
  },
  {
    id: "grote-kerk-haarlem",
    name: "Grote Kerk",
    english: "St Bavo's Church, Haarlem",
    kind: "landmark",
    lat: 52.38131,
    lon: 4.63695,
    rank: 3,
    streets: true,
    blurb:
      "The church on the Grote Markt of Haarlem. Its organ of 1738 was played by the young Mozart.",
  },
  {
    id: "evoluon",
    name: "Evoluon",
    kind: "landmark",
    lat: 51.44361,
    lon: 5.44681,
    rank: 3,
    streets: true,
    blurb:
      "A building shaped like a flying saucer, opened by Philips in 1966.",
  },
  {
    id: "hunebedcentrum",
    name: "Hunebedcentrum",
    kind: "landmark",
    lat: 52.93068,
    lon: 6.79867,
    rank: 3,
    streets: true,
    blurb:
      "A museum next to the largest hunebed in the country. Hunebedden are graves of great boulders, about 5,000 years old.",
  },
  {
    id: "vuurtoren-texel",
    name: "Vuurtoren Texel",
    english: "Texel lighthouse",
    kind: "landmark",
    lat: 53.18212,
    lon: 4.85524,
    rank: 3,
    streets: true,
    blurb:
      "The red lighthouse at the northern tip of Texel, lit in 1864.",
  },
  {
    id: "oldehove",
    name: "Oldehove",
    kind: "landmark",
    lat: 53.20298,
    lon: 5.78971,
    rank: 3,
    streets: true,
    blurb:
      "A church tower in Leeuwarden that began to lean while it was being built in 1529, and was never finished.",
  },
  {
    id: "lange-jan",
    name: "Lange Jan",
    kind: "landmark",
    lat: 51.49956,
    lon: 3.61478,
    rank: 3,
    streets: true,
    blurb:
      "The abbey tower of Middelburg, about 90 metres tall.",
  },
  {
    id: "sassenpoort",
    name: "Sassenpoort",
    kind: "landmark",
    lat: 52.51005,
    lon: 6.09555,
    rank: 3,
    streets: true,
    blurb:
      "A city gate of Zwolle from 1409.",
  },
  {
    id: "olv-toren",
    name: "Onze Lieve Vrouwetoren",
    english: "Tower of Our Lady",
    kind: "landmark",
    lat: 52.1551744,
    lon: 5.38720621,
    rank: 3,
    streets: true,
    blurb:
      "The church tower of Amersfoort, close to 100 metres tall. The Dutch national grid is measured from this tower, and so is this map.",
  },
  {
    id: "schiphol",
    name: "Schiphol",
    english: "Amsterdam Airport Schiphol",
    kind: "landmark",
    lat: 52.3105,
    lon: 4.7683,
    rank: 2,
    blurb:
      "The main airport. It stands on the bed of a lake that was pumped dry in 1852, a few metres below sea level.",
  },
  {
    id: "afsluitdijk",
    name: "Afsluitdijk",
    kind: "landmark",
    lat: 53.02,
    lon: 5.2,
    rank: 3,
    blurb:
      "A 32 km dam finished in 1932. It closed off the Zuiderzee and turned it into a freshwater lake, the IJsselmeer.",
  },
  {
    id: "maasvlakte",
    name: "Maasvlakte",
    english: "Port of Rotterdam",
    kind: "landmark",
    lat: 51.955,
    lon: 4.03,
    rank: 3,
    blurb:
      "The port of Rotterdam runs about 40 km from the city to the sea. Maasvlakte, at the far end, is land made from dredged sand.",
  },
  {
    id: "zuidplaspolder",
    name: "Zuidplaspolder",
    english: "Lowest point",
    kind: "landmark",
    lat: 51.9843,
    lon: 4.6412,
    rank: 3,
    blurb:
      "The lowest point of the country is in this polder near Nieuwerkerk aan den IJssel: 6.76 metres below NAP.",
  },
  {
    id: "vaalserberg",
    name: "Vaalserberg",
    english: "Highest point",
    kind: "landmark",
    lat: 50.7546,
    lon: 6.0208,
    rank: 3,
    blurb:
      "The highest point of the European Netherlands, 322 metres, where the Dutch, Belgian and German borders meet.",
  },
  {
    id: "keukenhof",
    name: "Keukenhof",
    kind: "landmark",
    lat: 52.2697,
    lon: 4.5464,
    rank: 3,
    blurb:
      "Tulip gardens in the bulb-growing region, open for about eight weeks each spring.",
  },
  {
    id: "kinderdijk",
    name: "Kinderdijk",
    kind: "landmark",
    lat: 51.8839,
    lon: 4.6364,
    rank: 3,
    blurb:
      "Nineteen windmills built around 1740 to keep a polder dry. A UNESCO World Heritage site.",
  },
  {
    id: "hoge-veluwe",
    name: "De Hoge Veluwe",
    kind: "landmark",
    lat: 52.08,
    lon: 5.83,
    rank: 3,
    blurb:
      "A national park of forest, heath and drifting sand on the Veluwe, the high sandy middle of the country.",
  },
  {
    id: "texel",
    name: "Texel",
    kind: "landmark",
    lat: 53.06,
    lon: 4.8,
    rank: 3,
    blurb:
      "The largest of the Wadden Islands, reached by ferry from Den Helder.",
  },
  {
    id: "oosterscheldekering",
    name: "Oosterscheldekering",
    kind: "landmark",
    lat: 51.63,
    lon: 3.7,
    rank: 3,
    blurb:
      "The largest of the Delta Works: a storm surge barrier 9 km long that closes when the sea rises too high.",
  },
  {
    id: "maeslantkering",
    name: "Maeslantkering",
    kind: "landmark",
    lat: 51.9553,
    lon: 4.1639,
    rank: 3,
    blurb:
      "Two floating gates, each about as long as the Eiffel Tower is tall, that swing shut to protect Rotterdam in a storm.",
  },

  // -------------------------------------------------------------- water --
  {
    id: "noordzee",
    name: "Noordzee",
    english: "North Sea",
    kind: "water",
    lat: 52.75,
    lon: 3.75,
    rank: 1,
    blurb: "The sea the dunes and dikes hold back.",
  },
  {
    id: "ijsselmeer",
    name: "IJsselmeer",
    kind: "water",
    lat: 52.82,
    lon: 5.3,
    rank: 2,
    blurb:
      "The largest lake in the country, and its main store of fresh water. It was a sea inlet until the Afsluitdijk closed it in 1932.",
  },
  {
    id: "markermeer",
    name: "Markermeer",
    kind: "water",
    lat: 52.54,
    lon: 5.22,
    rank: 3,
    blurb:
      "The lake between Amsterdam and Flevoland, separated from the IJsselmeer by a dike in the 1970s.",
  },
  {
    id: "waddenzee",
    name: "Waddenzee",
    english: "Wadden Sea",
    kind: "water",
    lat: 53.28,
    lon: 5.35,
    rank: 2,
    blurb:
      "A shallow tidal sea of mudflats between the mainland and the islands. A UNESCO World Heritage site.",
  },
];

export function findPlace(id: string): Place | undefined {
  return places.find((place) => place.id === id);
}
