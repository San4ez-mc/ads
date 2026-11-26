// Налаштування групи оголошень простими словами: кому показуємо й де.
const PLATFORM = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', threads: 'Threads', audience_network: 'Audience Network', whatsapp: 'WhatsApp' };
const COUNTRY = { UA: 'Україна', PL: 'Польща', DE: 'Німеччина', CZ: 'Чехія', GB: 'Велика Британія', US: 'США' };
const GENDER = { 1: 'чоловіки', 2: 'жінки' };

/** { text, parts } — хто бачить рекламу. Нема даних про групу — null. */
function audience(targeting) {
  const t = targeting || {};
  if (!Object.keys(t).length) return null;
  const geo = t.geo_locations || {};
  const where = [...(geo.countries || []).map((c) => COUNTRY[c] || c), ...(geo.regions || []).map((r) => r.name), ...(geo.cities || []).map((c) => c.name)].filter(Boolean);
  const wide = t.targeting_automation?.advantage_audience === 1;
  // Коли Meta може розширювати, справжні вікові межі лежать в age_range, а age_max завжди 65.
  const range = wide && Array.isArray(t.age_range) ? t.age_range : [t.age_min, t.age_max];
  const age = range[0] ? `${range[0]}–${range[1] >= 65 ? '65+' : range[1]} років` : null;
  const gender = Array.isArray(t.genders) && t.genders.length === 1 ? GENDER[t.genders[0]] : null;
  const interests = [...(t.flexible_spec || []), t].flatMap((s) => ['interests', 'behaviors', 'work_positions', 'industries'].flatMap((k) => (s[k] || []).map((x) => x.name))).filter(Boolean);
  const custom = (t.custom_audiences || []).map((a) => a.name || a.id);
  const parts = [where.join(', ') || null, age, gender || 'усі статі', interests.length ? `інтереси: ${[...new Set(interests)].slice(0, 6).join(', ')}` : 'без інтересів', custom.length ? `свої аудиторії: ${custom.join(', ')}` : null, wide ? 'Meta може розширювати' : null].filter(Boolean);
  return { text: parts.join(' · '), wide, ageMin: range[0] || null, ageMax: range[1] || null };
}

/** { list, auto, text } — площадки. Без publisher_platforms Meta показує всюди, разом із Audience Network. */
function placements(targeting) {
  const t = targeting || {};
  if (!Object.keys(t).length) return null;
  const list = Array.isArray(t.publisher_platforms) ? t.publisher_platforms : [];
  if (!list.length) return { list: [], auto: true, text: 'усі площадки автоматично (разом з Audience Network)' };
  return { list, auto: false, text: list.map((p) => PLATFORM[p] || p).join(', ') };
}

module.exports = { audience, placements, PLATFORM };
