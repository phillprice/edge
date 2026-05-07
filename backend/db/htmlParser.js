// Parses a play-cricket print.html scorecard and returns structured match data + player map

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&dagger;/g, '†')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTdCells(row) {
  const cells = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(row)) !== null) cells.push(decode(m[1]));
  return cells;
}

function extractThCells(row) {
  const cells = [];
  const re = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let m;
  while ((m = re.exec(row)) !== null) cells.push(decode(m[1]));
  return cells;
}

function storePlayer(players, name, team) {
  if (!name || name.length < 2) return;
  const key = name.toLowerCase().replace(/\s+/g, '_');
  if (!players[key]) players[key] = { name, team, nameKey: key };
  else if (team && !players[key].team) players[key].team = team;
}

function parseScoreStr(s) {
  const m = s.match(/(\d+)(?:-(\d+)|\s+all\s+out)?\s*\(([0-9.]+)\s+overs?\)/i);
  if (!m) return null;
  // If "all out" was matched, wickets = 10 conceptually but we leave null (all out = full wickets)
  return { runs: m[1], wickets: m[2] ?? null, overs: m[3] };
}

function parseHtmlScorecard(html) {
  const result = {
    homeTeam: null, awayTeam: null,
    ground: null, matchDate: null, competition: null,
    tossWinner: null, tossDecision: null, matchResult: null,
    homeScore: null, awayScore: null, homeOvers: null, awayOvers: null,
    homeWickets: null, awayWickets: null,
    players: {}, innings: []
  };

  // Team names from h3 "Team A Vs Team B"
  const vsMatch = html.match(/<h[23][^>]*>([\s\S]*?Vs[\s\S]*?)<\/h[23]>/i);
  if (vsMatch) {
    const vsText = decode(vsMatch[1]);
    const parts = vsText.split(/\s+Vs\s+/i);
    if (parts.length === 2) {
      result.homeTeam = parts[0].trim();
      result.awayTeam = parts[1].trim();
    }
  }

  // Ground and Date
  const groundMatch = html.match(/<b>Ground\s*<\/b><\/td><td>([^<]+)<\/td>/i);
  if (groundMatch) result.ground = decode(groundMatch[1]);

  const dateMatch = html.match(/<b>Date\s*<\/b><\/td><td>([^<]+)<\/td>/i);
  if (dateMatch) result.matchDate = decode(dateMatch[1]);

  // Toss
  const tossMatch = html.match(/<b>Toss\s*<\/b><\/td><td>([\s\S]*?)<\/td>/i);
  if (tossMatch) {
    const toss = decode(tossMatch[1]);
    const m = toss.match(/^(.+?)\s+(?:won the toss and elected to|elected to)\s+(bat|field|bowl)/i);
    if (m) {
      result.tossWinner = m[1].trim();
      result.tossDecision = m[2].trim();
    }
  }

  // Competition
  const typeMatch = html.match(/<b>Type\s*<\/b><\/td><td>([\s\S]*?)<\/td>/i);
  if (typeMatch) {
    result.competition = decode(typeMatch[1]).replace(/^(Cup:|League:)\s*/i, '').trim();
  }

  // Result
  const resultMatch = html.match(/<b>Result\s*:<\/b>([\s\S]*?)(?:<table|<\/div|<br)/i);
  if (resultMatch) result.matchResult = decode(resultMatch[1]).replace(/^[\s&;]+/, '').trim();

  // Scores from points_details table
  const pdMatch = html.match(/<table class="points_details">([\s\S]+?)<\/table>/i);
  if (pdMatch) {
    const pdHtml = pdMatch[1];
    // Team names from th cells
    const thCells = extractThCells(pdHtml);
    const teamHeaders = thCells.filter(c => c.length > 1);
    if (teamHeaders.length >= 2) {
      result.homeTeam = result.homeTeam || teamHeaders[0];
      result.awayTeam = result.awayTeam || teamHeaders[1];
    }

    // Score rows
    const trRe = /<tr>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = trRe.exec(pdHtml)) !== null) {
      const cells = extractTdCells(m[1]);
      if (cells[0] === 'Score' && cells.length >= 3) {
        const home = parseScoreStr(cells[1]);
        const away = parseScoreStr(cells[2]);
        if (home) {
          result.homeScore = home.runs;
          result.homeWickets = home.wickets;
          result.homeOvers = home.overs;
        }
        if (away) {
          result.awayScore = away.runs;
          result.awayWickets = away.wickets;
          result.awayOvers = away.overs;
        }
      }
    }
  }

  // Parse innings sections by splitting on <div id="innings
  const parts = html.split(/<div id="innings/i);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const headerMatch = part.match(/<h1 class="printHeader">([^<]+)<\/h1>/i);
    if (!headerMatch) continue;
    const battingTeamShort = decode(headerMatch[1]).trim();

    // Match shortened name to full team name
    const battingTeam = resolveTeamName(battingTeamShort, result.homeTeam, result.awayTeam);
    const bowlingTeam = battingTeam === result.homeTeam ? result.awayTeam : result.homeTeam;

    const batters = parseBattingSection(part, battingTeam, bowlingTeam, result.players);
    parseBowlingSection(part, bowlingTeam, result.players);

    result.innings.push({ battingTeam, batters });
  }

  return result;
}

// Match a shortened section name (e.g. "Weybridge") to a full team name
function resolveTeamName(short, homeTeam, awayTeam) {
  const s = short.toLowerCase();
  if (homeTeam && homeTeam.toLowerCase().startsWith(s)) return homeTeam;
  if (awayTeam && awayTeam.toLowerCase().startsWith(s)) return awayTeam;
  if (homeTeam && s.startsWith(homeTeam.toLowerCase().slice(0, 8))) return homeTeam;
  if (awayTeam && s.startsWith(awayTeam.toLowerCase().slice(0, 8))) return awayTeam;
  return short;
}

function parseBattingSection(sectionHtml, battingTeam, bowlingTeam, players) {
  const batters = [];

  const tableMatch = sectionHtml.match(/<table class="batting">([\s\S]*?)<\/table>/i);
  if (!tableMatch) return batters;

  const trRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableMatch[1])) !== null) {
    const cells = extractTdCells(m[1]);
    if (cells.length < 3) continue;

    const rawName = cells[0];
    const howOut  = cells[1];
    const bowlerCell = cells[2];

    // Skip header/footer rows
    if (!rawName || rawName.length < 2) continue;
    if (/^(Extras|Total|Wickets|Overs|Fall|Name|\*\s*=|\d)/i.test(rawName)) continue;
    if (rawName.includes('=')) continue; // legend row like "* = Captain"

    const isCapt = rawName.includes('*');
    const isWK   = rawName.includes('†');
    const name   = rawName.replace(/[*†]/g, '').trim();
    if (!name || name.split(/\s+/).length < 2) continue;

    // Parse bowler name from the bowler cell ("b Name" or "ct & b Name")
    const bc = (bowlerCell || '').trim();
    const ctbInBowlerCell = /^ct\s*&\s*b\s+/i.test(bc);
    const bowler = ctbInBowlerCell
      ? bc.replace(/^ct\s*&\s*b\s+/i, '').trim() || null
      : bc ? bc.replace(/^b\s+/i, '').trim() || null : null;

    // Determine dismissal method and fielder
    let method, fielder = null;
    const ho  = (howOut || '').trim();
    const hoL = ho.toLowerCase();

    if (ctbInBowlerCell || /^ct\s*&\s*b/i.test(ho)) {
      method = 'CaughtAndBowled';
    } else if (hoL === 'not out') {
      method = 'NotOut';
    } else if (hoL === 'did not bat') {
      method = 'DidNotBat';
    } else if (/^retired/i.test(ho)) {
      method = 'Retired';
    } else if (/^ct\s+/i.test(ho)) {
      method = 'Caught';
      fielder = ho.replace(/^ct\s+/i, '').trim();
    } else if (/^lbw/i.test(hoL)) {
      method = 'LBW';
    } else if (/^run\s+out/i.test(hoL)) {
      method = 'RunOut';
      const roM = ho.match(/\(([^)]+)\)/);
      fielder = roM ? roM[1].trim() : null;
    } else if (/^(?:stumped|st)\s+/i.test(ho)) {
      method = 'Stumped';
      fielder = ho.replace(/^(?:stumped|st)\s+/i, '').trim();
    } else if (bowler) {
      method = 'Bowled';
    } else {
      method = 'DidNotBat';
    }

    const dismissed = !['NotOut', 'Retired', 'DidNotBat'].includes(method);

    storePlayer(players, name, battingTeam);
    if (bowler)  storePlayer(players, bowler, bowlingTeam);
    if (fielder) storePlayer(players, fielder, bowlingTeam);

    batters.push({ name, isCapt, isWK, method, fielder, bowler, dismissed });
  }

  return batters;
}

function parseBowlingSection(sectionHtml, bowlingTeam, players) {
  const tableMatch = sectionHtml.match(/<table class="bowling">([\s\S]*?)<\/table>/i);
  if (!tableMatch) return;

  const trRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableMatch[1])) !== null) {
    const cells = extractTdCells(m[1]);
    if (!cells.length) continue;
    const name = cells[0];
    if (!name || name.length < 3 || /^(Bowler|Total|Fielding|Extras)/i.test(name)) continue;
    if (name.split(/\s+/).length < 2) continue;
    storePlayer(players, name, bowlingTeam);
  }
}

module.exports = { parseHtmlScorecard };
