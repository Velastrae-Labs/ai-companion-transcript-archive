export async function getStats(db: any) {
  const total = await db.prepare('SELECT COUNT(*) as n FROM messages').first();
  const byPlatform = await db.prepare('SELECT llm_platform, COUNT(*) as n FROM messages GROUP BY llm_platform').all();
  const byRole = await db.prepare('SELECT role, COUNT(*) as n FROM messages GROUP BY role').all();
  const dates = await db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM messages').first();
  return {
    total_messages: (total as any).n,
    date_range: dates,
    by_platform: Object.fromEntries((byPlatform.results || []).map((r: any) => [r.llm_platform, r.n])),
    by_role: Object.fromEntries((byRole.results || []).map((r: any) => [r.role, r.n])),
  };
}
