const crypto = require('crypto');
const https  = require('https');
const zlib   = require('zlib');

const API_BASE      = 'https://api.resultsvault.co.uk/rv';
const SHARED_SECRET = process.env.RV_SHARED_SECRET || '5BD4A72CE1934BA5A629CD98';
const ENTITY_ID     = process.env.RV_ENTITY_ID     || '130000';
const API_ID        = process.env.RV_API_ID        || '1003';
const MAP_INSTANCE  = '4';
const MAP_OBJ_TYPE  = '12';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

// Replicates the IAS widget ce() function: 3DES-ECB of timestamp, base64-encoded.
function iasToken() {
  const t      = Math.round(Date.now() / 1000 - 60).toString();
  const padLen = 8 - (t.length % 8);
  const padded = t + String.fromCharCode(padLen).repeat(padLen);
  const cipher = crypto.createCipheriv('des-ede3', Buffer.from(SHARED_SECRET, 'ascii'), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.from(padded, 'binary')), cipher.final()]).toString('base64');
}

// Decompress a response stream based on Content-Encoding, return a promise of the full body string.
function readBody(res) {
  return new Promise((resolve, reject) => {
    const enc = (res.headers['content-encoding'] || '').toLowerCase();
    let stream = res;
    if      (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
    else if (enc === 'br')      stream = res.pipe(zlib.createBrotliDecompress());
    const chunks = [];
    stream.on('data', d => chunks.push(d));
    stream.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent':        UA,
        'Accept':            'application/json, text/plain, */*',
        'Accept-Language':   'en-GB,en;q=0.9',
        'Accept-Encoding':   'gzip, deflate, br',
        'Origin':            'https://whcc.play-cricket.com',
        'Referer':           'https://whcc.play-cricket.com/',
        'Cache-Control':     'no-cache',
        'Pragma':            'no-cache',
        'X-IAS-API-REQUEST': iasToken(),
        ...extraHeaders,
      },
    }, async res => {
      try {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        const text = await readBody(res);
        resolve(JSON.parse(text));
      } catch (e) { reject(e); }
    }).on('error', reject);
  });
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control':   'no-cache',
      },
    }, async res => {
      try {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchHtml(res.headers.location).then(resolve).catch(reject);
        }
        resolve(await readBody(res));
      } catch (e) { reject(e); }
    }).on('error', reject);
  });
}

// Fetch the scoring rules page for a match and extract Overs Per Innings.
// Returns the integer overs value, or null if not found.
async function fetchMaxOvers(playCricketFixtureId) {
  try {
    const mainHtml = await fetchHtml(`https://whcc.play-cricket.com/website/results/${playCricketFixtureId}`);
    const linkMatch = mainHtml.match(/href="(https?:\/\/[^"]+\/scoring_rules\/\d+)"/i);
    if (!linkMatch) return null;
    const rulesHtml = await fetchHtml(linkMatch[1]);
    const ovMatch = rulesHtml.match(/id="Overs_Per_Innings"[^>]*value="(\d+)"/i);
    return ovMatch ? parseInt(ovMatch[1], 10) : null;
  } catch (_) {
    return null;
  }
}

// Fetch all data needed to ingest a match given its play-cricket fixture URL or ID.
// Returns { fixtureId, rvMatchId, innings: [{ resultId, inningsOrder, json }], printHtml, maxOvers }
async function fetchMatchData(playCricketFixtureId) {
  const fid = String(playCricketFixtureId).trim();

  // 1. Map play-cricket fixture_id → resultsvault match_id
  const mapping = await fetchJson(
    `${API_BASE}/mappings/${MAP_INSTANCE}/${MAP_OBJ_TYPE}/${fid}/?sportid=1&apiid=${API_ID}`
  );
  const rvMatchId = mapping.object_id1;
  if (!rvMatchId) throw new Error(`No resultsvault match found for fixture ${fid}`);

  // 2. Get match details — teams carry result_id and innings order
  const detail = await fetchJson(
    `${API_BASE}/${ENTITY_ID}/matches/${rvMatchId}/?sportid=1&apiid=${API_ID}`
  );

  const teams = (detail.MatchTeams || [])
    .map(t => ({ resultId: t.result_id, inningsOrder: t.Innings?.[0]?.innings_order }))
    .filter(t => t.resultId && t.inningsOrder != null)
    .sort((a, b) => a.inningsOrder - b.inningsOrder);

  if (!teams.length) throw new Error('No innings data in match details');

  // 3. Ball-by-ball JSON for each innings, print HTML, and scoring rules — all in parallel
  const [balls, printHtml, maxOvers] = await Promise.all([
    Promise.all(teams.map(({ resultId }) =>
      fetchJson(
        `${API_BASE}/${ENTITY_ID}/matches/${rvMatchId}/?apiid=${API_ID}&action=getballs&sportid=1&resultid=${resultId}&inningsnumber=1`
      )
    )),
    fetchHtml(`https://whcc.play-cricket.com/website/results/${fid}/print`),
    fetchMaxOvers(fid),
  ]);

  // Use min result_id as DB fixture_id — matches the existing file-upload convention
  const dbFixtureId = String(Math.min(...teams.map(t => t.resultId)));

  return {
    dbFixtureId,
    rvMatchId,
    innings: teams.map((t, i) => ({ resultId: String(t.resultId), inningsOrder: t.inningsOrder, json: balls[i] })),
    printHtml,
    maxOvers,
  };
}

// "25 May 2026" + "10:00" → "2026-05-25T10:00:00"
function fixtureToIso(rawDate, startTime) {
  const monthMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
  const [day, mon, year] = rawDate.trim().split(/\s+/)
  const mm = String(monthMap[mon.toLowerCase().slice(0, 3)]).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}T${startTime}:00`
}

function stripTeamHtml(raw) {
  return raw.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

// Scrape fixture months for a team/season.
// For current/future seasons: current month + next 5 months.
// For past seasons (year < current year): all 12 months of that year.
// Returns deduplicated [{ playCricketId, matchDateIso, homeTeam, awayTeam, ground }].
async function fetchFixtureList(teamId, seasonId, seasonYear) {
  const seen = new Set()
  const results = []
  const now = new Date()
  const dayPat = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
  const monPat = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

  // Determine which months to scan. Past seasons are fully complete so we scan all 12 months;
  // the live season only needs the current + next 5 months.
  //
  // IMPORTANT: the Fixture tab IGNORES season_id and always returns the live season's fixtures.
  // For a past season we must use the Result tab with selected_season_id + seasonchange=f, whose
  // match links use the /website/results/<id> format instead of match_details?id=<id>.
  const isPast = seasonYear && parseInt(seasonYear) < now.getFullYear()
  const months = isPast
    ? Array.from({ length: 12 }, (_, i) => i + 1)  // Jan–Dec for past year
    : Array.from({ length: 6 },  (_, i) => {         // current + 5 months for live season
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
        return d.getMonth() + 1
      })

  for (const month of months) {
    const url = isPast
      ? `https://whcc.play-cricket.com/Matches?tab=Result&selected_season_id=${seasonId}&seasonchange=f&view_by=month&fixture_month=${month}&season_id=${seasonId}&team_id=${teamId}`
      : `https://whcc.play-cricket.com/Matches?tab=Fixture&view_by=month&fixture_month=${month}&team_id=${teamId}&season_id=${seasonId}`
    const rawHtml = await fetchHtml(url)
    // Strip HTML comments so the duplicate mobile/desktop blocks don't confuse the parser
    const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '')

    const tokens = []
    const dateRe = new RegExp(`(?:${dayPat})\\s+(\\d{1,2}\\s+(?:${monPat})\\s+\\d{4})`, 'gi')
    const timeRe = /class='time'>(\d{2}:\d{2})/g
    const locRe  = /class='location'>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g
    // Fixture tab: href="/match_details?id=123"  |  Result tab: href='/website/results/123'
    const idRe   = isPast ? /\/website\/results\/(\d+)/g : /href="\/match_details\?id=(\d+)"/g
    const teamRe = /class='txt1'>([\s\S]*?)<\/p>/g

    let m
    while ((m = dateRe.exec(html)) !== null) tokens.push({ type: 'date',     val: m[1],                    pos: m.index })
    while ((m = timeRe.exec(html)) !== null) tokens.push({ type: 'time',     val: m[1],                    pos: m.index })
    while ((m = locRe.exec(html))  !== null) tokens.push({ type: 'location', val: m[1].trim(),             pos: m.index })
    while ((m = idRe.exec(html))   !== null) tokens.push({ type: 'id',       val: m[1],                    pos: m.index })
    while ((m = teamRe.exec(html)) !== null) tokens.push({ type: 'team',     val: stripTeamHtml(m[1]),     pos: m.index })
    tokens.sort((a, b) => a.pos - b.pos)

    let curDate = null, curTime = '12:00', curLocation = null
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if      (t.type === 'date')     { curDate = t.val; curTime = '12:00'; curLocation = null }
      else if (t.type === 'time')     { curTime = t.val }
      else if (t.type === 'location') { curLocation = t.val }
      else if (t.type === 'id' && curDate && !seen.has(t.val)) {
        seen.add(t.val)
        // Collect the next two 'team' tokens before the next 'id'
        const teams = []
        for (let j = i + 1; j < tokens.length && teams.length < 2; j++) {
          if (tokens[j].type === 'id') break
          if (tokens[j].type === 'team') teams.push(tokens[j].val)
        }
        results.push({
          playCricketId: parseInt(t.val),
          matchDateIso:  fixtureToIso(curDate.trim(), curTime),
          ground:        curLocation || null,
          homeTeam:      teams[0] || null,
          awayTeam:      teams[1] || null,
        })
      }
    }
  }
  return results
}

// Fetch the team name label and season year from the fixtures page.
// Returns { label, year } — year may be null if not parseable.
async function fetchTeamLabel(teamId, seasonId) {
  const url = `https://whcc.play-cricket.com/Matches?tab=Fixture&view_by=month&fixture_month=5&team_id=${teamId}&season_id=${seasonId}`
  const html = await fetchHtml(url)

  const teamM = html.match(new RegExp(`<option[^>]+selected[^>]*value="${teamId}"[^>]*>([^<]+)<`))
  const label = teamM ? teamM[1].trim() : `Team ${teamId}`

  // Try to find the year from the selected season option (value="${seasonId}")
  const seasonM = html.match(new RegExp(`<option[^>]*value="${seasonId}"[^>]*>([^<]+)<`))
  const seasonText = seasonM ? seasonM[1].trim() : ''
  const yearM = seasonText.match(/\b(20\d\d)\b/)
  const year = yearM ? yearM[1] : null

  return { label, year }
}

module.exports = { fetchMatchData, fetchFixtureList, fetchTeamLabel };
