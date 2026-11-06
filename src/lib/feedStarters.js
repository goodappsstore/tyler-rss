/**
 * A curated shelf of reliable, public RSS/Atom feeds. These are suggestions
 * only — the Add feed dialog still accepts any URL. Kept in one place so the
 * welcome screen and the add-feed dialog always offer the same catalog.
 */
export const FEED_STARTERS = [
  // Technology
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Technology" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Technology" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss", category: "Technology" },
  { name: "404 Media", url: "https://www.404media.co/rss/", category: "Technology" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", category: "Technology" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "Technology" },
  { name: "The Register", url: "https://www.theregister.com/headlines.atom", category: "Technology" },
  { name: "Engadget", url: "https://www.engadget.com/rss.xml", category: "Technology" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", category: "Technology" },
  { name: "IEEE Spectrum", url: "https://spectrum.ieee.org/rss", category: "Technology" },
  { name: "Stratechery", url: "https://stratechery.com/feed/", category: "Technology" },
  { name: "Platformer", url: "https://www.platformer.news/rss/", category: "Technology" },

  // Apple
  { name: "Daring Fireball", url: "https://daringfireball.net/feeds/main", category: "Apple" },
  { name: "MacRumors", url: "https://www.macrumors.com/macrumors.xml", category: "Apple" },
  { name: "9to5Mac", url: "https://9to5mac.com/feed/", category: "Apple" },
  { name: "Six Colors", url: "https://sixcolors.com/feed/", category: "Apple" },

  // Development
  { name: "GitHub Blog", url: "https://github.blog/feed/", category: "Development" },
  { name: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", category: "Development" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", category: "Development" },
  { name: "Julia Evans", url: "https://jvns.ca/atom.xml", category: "Development" },
  { name: "Dan Luu", url: "https://danluu.com/atom.xml", category: "Development" },
  { name: "Jeff Geerling", url: "https://www.jeffgeerling.com/blog.xml", category: "Development" },
  { name: "CSS-Tricks", url: "https://css-tricks.com/feed/", category: "Development" },
  { name: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", category: "Development" },
  { name: "web.dev", url: "https://web.dev/feed.xml", category: "Development" },
  { name: "MDN Blog", url: "https://developer.mozilla.org/en-US/blog/rss.xml", category: "Development" },
  { name: "The Go Blog", url: "https://go.dev/blog/feed.atom", category: "Development" },
  { name: "Rust Blog", url: "https://blog.rust-lang.org/feed.xml", category: "Development" },
  { name: "Python Insider", url: "https://pythoninsider.blogspot.com/feeds/posts/default", category: "Development" },
  { name: "Kotlin Blog", url: "https://blog.jetbrains.com/kotlin/feed/", category: "Development" },
  { name: "Raspberry Pi", url: "https://www.raspberrypi.com/news/feed/", category: "Development" },

  // World news
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", category: "World news" },
  { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", category: "World news" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", category: "World news" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "World news" },
  { name: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml", category: "World news" },
  { name: "DW", url: "https://rss.dw.com/rdf/rss-en-all", category: "World news" },
  { name: "France 24", url: "https://www.france24.com/en/rss", category: "World news" },
  { name: "CBC Top Stories", url: "https://www.cbc.ca/webfeed/rss/rss-topstories", category: "World news" },
  { name: "ABC News (AU)", url: "https://www.abc.net.au/news/feed/51120/rss.xml", category: "World news" },
  { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", category: "World news" },
  { name: "ProPublica", url: "https://www.propublica.org/feeds/propublica/main", category: "World news" },
  { name: "The Atlantic", url: "https://www.theatlantic.com/feed/all/", category: "World news" },
  { name: "The New Yorker", url: "https://www.newyorker.com/feed/everything", category: "World news" },

  // Business
  { name: "Financial Times", url: "https://www.ft.com/rss/home", category: "Business" },
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", category: "Business" },
  { name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", category: "Business" },
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "Business" },

  // Science
  { name: "NASA", url: "https://www.nasa.gov/feed/", category: "Science" },
  { name: "Nature", url: "https://www.nature.com/nature.rss", category: "Science" },
  { name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", category: "Science" },
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", category: "Science" },
  { name: "Phys.org", url: "https://phys.org/rss-feed/", category: "Science" },

  // Design & culture
  { name: "Dezeen", url: "https://www.dezeen.com/feed/", category: "Design & culture" },
  { name: "Design Milk", url: "https://design-milk.com/feed/", category: "Design & culture" },
  { name: "Creative Boom", url: "https://www.creativeboom.com/feed/", category: "Design & culture" },
  { name: "Creative Bloq", url: "https://www.creativebloq.com/feed", category: "Design & culture" },
  { name: "Colossal", url: "https://www.thisiscolossal.com/feed/", category: "Design & culture" },
  { name: "Kottke.org", url: "https://kottke.org/index.xml", category: "Design & culture" },
  { name: "The Marginalian", url: "https://www.themarginalian.org/feed/", category: "Design & culture" },

  // Gaming
  { name: "Polygon", url: "https://www.polygon.com/rss/index.xml", category: "Gaming" },
  { name: "Kotaku", url: "https://kotaku.com/rss", category: "Gaming" },
  { name: "Eurogamer", url: "https://www.eurogamer.net/feed", category: "Gaming" },
  { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", category: "Gaming" },
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/", category: "Gaming" },
  { name: "IGN", url: "https://feeds.ign.com/ign/all", category: "Gaming" },

  // Audio
  { name: "99% Invisible", url: "https://feeds.simplecast.com/54nAGcIl", category: "Audio" },
  { name: "Darknet Diaries", url: "https://feeds.megaphone.fm/darknetdiaries", category: "Audio" },
  { name: "Syntax", url: "https://feed.syntax.fm/rss", category: "Audio" },
  { name: "The Changelog", url: "https://changelog.com/podcast/feed", category: "Audio" },

  // Food & home
  { name: "Smitten Kitchen", url: "https://smittenkitchen.com/feed/", category: "Food & home" },

  // Sport
  { name: "ESPN", url: "https://www.espn.com/espn/rss/news", category: "Sport" },
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", category: "Sport" },

  // Photography
  { name: "PetaPixel", url: "https://petapixel.com/feed/", category: "Photography" },
  { name: "Fstoppers", url: "https://fstoppers.com/feed", category: "Photography" },
  { name: "DPReview", url: "https://www.dpreview.com/feeds/news.xml", category: "Photography" },

  // Arts & books
  { name: "Hyperallergic", url: "https://hyperallergic.com/feed/", category: "Arts & books" },
  { name: "Artnet News", url: "https://news.artnet.com/feed", category: "Arts & books" },
  { name: "Pitchfork", url: "https://pitchfork.com/feed/feed-news/rss", category: "Arts & books" },
  { name: "NME", url: "https://www.nme.com/feed", category: "Arts & books" },
  { name: "Literary Hub", url: "https://lithub.com/feed/", category: "Arts & books" },
  { name: "Public Books", url: "https://www.publicbooks.org/feed/", category: "Arts & books" },
  { name: "London Review of Books", url: "https://www.lrb.co.uk/feeds/rss", category: "Arts & books" },

  // Health
  { name: "STAT News", url: "https://www.statnews.com/feed/", category: "Health" },
  { name: "KFF Health News", url: "https://kffhealthnews.org/feed/", category: "Health" },

  // Security
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", category: "Security" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", category: "Security" },
  { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", category: "Security" },
  { name: "Troy Hunt", url: "https://www.troyhunt.com/rss/", category: "Security" },

  // Productivity
  { name: "Lifehacker", url: "https://lifehacker.com/rss", category: "Productivity" },
  { name: "Zapier Blog", url: "https://zapier.com/blog/feeds/latest/", category: "Productivity" },
];

/** A short, varied selection for the first-run screen. */
export const ONBOARDING_STARTERS = [
  "The Verge",
  "Ars Technica",
  "Hacker News",
  "404 Media",
  "Stratechery",
  "Daring Fireball",
  "BBC News",
  "Quanta Magazine",
]
  .map((name) => FEED_STARTERS.find((feed) => feed.name === name))
  .filter(Boolean);

/** Category names in the order they first appear in the catalog. */
export const STARTER_CATEGORIES = FEED_STARTERS.reduce((categories, feed) => {
  if (!categories.includes(feed.category)) categories.push(feed.category);
  return categories;
}, []);

/** Compare feed URLs loosely: ignore case, whitespace, and a trailing slash. */
export function sameFeedUrl(a, b) {
  const clean = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "");
  return clean(a) !== "" && clean(a) === clean(b);
}
