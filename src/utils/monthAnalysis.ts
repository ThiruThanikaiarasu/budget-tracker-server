// ── Monthly analysis from itemised bills ─────────────────────────────
// Pure computation: a month's expense transactions → what was bought, from
// where, what extras (fees, tax, discounts) were paid on top, by category and
// by day. Kept free of database calls so it can be tested with plain objects.

export type AnalysisTx = {
  _id?: unknown;
  amount: number;
  personalShare?: number | null;
  /** Who the bill was split between: "user" and each friend's id. Absent when it wasn't split. */
  participants?: string[] | null;
  categoryId?: unknown;
  merchant?: string | null;
  date: Date;
  items?: { itemId?: unknown; name: string; quantity?: number; unit?: string; baseQuantity?: number; amount: number; categoryId?: unknown; sharedWith?: string[] }[] | null;
  charges?: { label: string; amount: number; categoryId?: unknown; bill?: boolean }[] | null;
};
export type CatInfo = { name: string; icon?: string };
export type Basis = "bill" | "mine";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const isRoundOff = (label: string) => /round/i.test(label);
const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const idOf = (v: unknown) => (v == null ? "" : String(v));

/** How a unit rolls up: grams and kilos are both weight, shown in kg, and so on. */
const FAMILIES: Record<string, { family: string; div: number; label: string }> = {
  g: { family: "weight", div: 1000, label: "kg" }, kg: { family: "weight", div: 1000, label: "kg" },
  ml: { family: "volume", div: 1000, label: "l" }, l: { family: "volume", div: 1000, label: "l" },
  pcs: { family: "count", div: 1, label: "pcs" }, pc: { family: "count", div: 1, label: "pcs" }, dozen: { family: "count", div: 1, label: "pcs" },
};

export interface Totals {
  spent: number; items: number; fees: number; discounts: number; roundOff: number;
  bills: number; itemLines: number; merchants: number; avgBill: number; activeDays: number;
}
export interface MerchantRow {
  name: string; total: number; bills: number; avgBill: number; items: number; fees: number; discounts: number;
  extrasPct: number; lastDate: string; topCategory: string; lines: number;
  /** false for the "no merchant noted" bucket, which is shown apart from the ranking */
  noted: boolean;
}
export interface ExtraRow { label: string; kind: "fee" | "discount" | "roundoff"; amount: number; count: number; merchants: string[] }
export interface CategoryRow { id: string; name: string; icon: string; total: number; items: number; extras: number; bills: number }
export interface ItemRow {
  key: string; name: string; categoryId: string; categoryName: string; categoryIcon: string;
  spent: number; buys: number;
  /** Quantity bought, in the display unit (kg, l, pcs), or null when no quantities were recorded. */
  qty: number | null; unit: string | null;
  /** Price per display unit: weighted average, cheapest, dearest, latest. */
  avgUnit: number | null; minUnit: number | null; maxUnit: number | null; lastUnit: number | null;
  merchants: { name: string; spent: number }[];
  firstDate: string; lastDate: string;
  prevSpent: number; prevAvgUnit: number | null; changePct: number | null;
}
export interface MonthStats {
  totals: Totals;
  byDay: { date: string; total: number }[];
  merchants: MerchantRow[];
  extras: ExtraRow[];
  categories: CategoryRow[];
  items: ItemRow[];
}

type ItemAcc = {
  key: string; name: string; categoryId: string; spent: number; buys: number;
  family: string | null; div: number; unitLabel: string | null; base: number;
  /** amount and display-unit quantity of every purchase that had a quantity */
  priced: { amount: number; qty: number; date: string; w: number }[];
  merchants: Map<string, number>; first: string; last: string;
};

/**
 * How much of each line is yours. Equal among the people ticked on an item, fees following each
 * person's items; the whole thing is then scaled so it adds up to the share saved on the bill
 * (which covers amounts typed by hand). Bills that weren't split are all yours (factor 1).
 */
function shareFactors(t: AnalysisTx, basis: Basis) {
  const items = t.items ?? [];
  const charges = t.charges ?? [];
  const flat = (f: number) => ({ items: items.map(() => f), charges: charges.map(() => f) });
  if (basis !== "mine" || t.personalShare == null || t.amount <= 0) return flat(1);
  const whole = t.personalShare / t.amount;
  const keys = t.participants ?? [];
  if (keys.length < 2 || items.length === 0) return flat(whole);

  const mainCat = idOf(t.categoryId);
  const mine = items.map((i) => {
    const people = (i.sharedWith ?? keys).filter((k) => keys.includes(k));
    return people.includes("user") ? i.amount / people.length : 0;
  });
  const catTotal = new Map<string, number>();
  const catMine = new Map<string, number>();
  let allTotal = 0, allMine = 0;
  items.forEach((i, n) => {
    const c = idOf(i.categoryId) || mainCat;
    catTotal.set(c, (catTotal.get(c) ?? 0) + i.amount);
    catMine.set(c, (catMine.get(c) ?? 0) + mine[n]);
    allTotal += i.amount; allMine += mine[n];
  });
  const mineCharge = charges.map((ch) => {
    const c = ch.bill ? null : idOf(ch.categoryId) || mainCat;
    const total = c == null ? allTotal : catTotal.get(c) ?? 0;
    const part = c == null ? allMine : catMine.get(c) ?? 0;
    return total > 0 ? ch.amount * (part / total) : 0;
  });
  const raw = sum(mine) + sum(mineCharge);
  if (raw <= 0) return flat(whole);
  const k = t.personalShare / raw;
  return {
    items: items.map((i, n) => (i.amount > 0 ? (mine[n] * k) / i.amount : 0)),
    charges: charges.map((ch, n) => (ch.amount !== 0 ? (mineCharge[n] * k) / ch.amount : 0)),
  };
}

/** Paying a friend back (or waiving what they owe) moves money between people; it isn't something bought. */
const NOT_SPENDING = new Set(["settlement", "waived"]);

export function analyseMonth(allTxs: AnalysisTx[], basis: Basis, cats: Map<string, CatInfo>): MonthStats {
  const txs = allTxs.filter((t) => !NOT_SPENDING.has((cats.get(idOf(t.categoryId))?.name ?? "").trim().toLowerCase()));
  const catName = (id: string) => cats.get(id)?.name ?? "Uncategorized";

  const merchants = new Map<string, MerchantRow & { cats: Map<string, number> }>();
  const extras = new Map<string, ExtraRow>();
  const categories = new Map<string, CategoryRow>();
  const itemAcc = new Map<string, ItemAcc>();
  const days = new Map<string, number>();
  const totals: Totals = { spent: 0, items: 0, fees: 0, discounts: 0, roundOff: 0, bills: 0, itemLines: 0, merchants: 0, avgBill: 0, activeDays: 0 };

  const cat = (id: string) => {
    let c = categories.get(id);
    if (!c) { c = { id, name: catName(id), icon: cats.get(id)?.icon ?? "", total: 0, items: 0, extras: 0, bills: 0 }; categories.set(id, c); }
    return c;
  };

  for (const t of txs) {
    const sf = shareFactors(t, basis);
    const items = t.items ?? [];
    const charges = t.charges ?? [];
    const spent = basis === "mine" && t.personalShare != null ? t.personalShare : t.amount;
    const mainCat = idOf(t.categoryId);
    const day = istDay(t.date);
    const mName = (t.merchant ?? "").trim();
    const mKey = mName.toLowerCase();

    totals.spent += spent;
    totals.bills += 1;
    days.set(day, (days.get(day) ?? 0) + spent);

    // Money by category: lines to their own category, then fees and discounts onto theirs
    // (a whole-bill charge is spread in proportion to the categories' items).
    const itemsByCat = new Map<string, number>();
    items.forEach((i, n) => { const c = idOf(i.categoryId) || mainCat; itemsByCat.set(c, (itemsByCat.get(c) ?? 0) + i.amount * sf.items[n]); });
    const itemsSum = sum([...itemsByCat.values()]);
    let fees = 0, discounts = 0, roundOff = 0;
    const touched = new Set<string>();
    if (items.length === 0 && charges.length === 0) {
      cat(mainCat).items += spent; cat(mainCat).total += spent; touched.add(mainCat);
    } else {
      itemsByCat.forEach((v, c) => { cat(c).items += v; cat(c).total += v; touched.add(c); });
      for (const [ci, ch] of charges.entries()) {
        const amt = ch.amount * sf.charges[ci];
        const roundish = isRoundOff(ch.label);
        if (roundish) roundOff += amt; else if (amt >= 0) fees += amt; else discounts += -amt;
        const key = `${roundish ? "roundoff" : amt >= 0 ? "fee" : "discount"}:${ch.label.trim().toLowerCase()}`;
        let e = extras.get(key);
        if (!e) { e = { label: ch.label.trim(), kind: roundish ? "roundoff" : amt >= 0 ? "fee" : "discount", amount: 0, count: 0, merchants: [] }; extras.set(key, e); }
        e.amount += roundish ? amt : Math.abs(amt); e.count += 1;
        if (mName && !e.merchants.includes(mName)) e.merchants.push(mName);
        // where it lands
        if (ch.bill && itemsSum > 0) itemsByCat.forEach((v, c) => { const part = amt * (v / itemsSum); cat(c).extras += part; cat(c).total += part; touched.add(c); });
        else { const c = idOf(ch.categoryId) || mainCat; cat(c).extras += amt; cat(c).total += amt; touched.add(c); }
      }
    }
    touched.forEach((c) => { cat(c).bills += 1; });

    const itemsTotal = items.length === 0 && charges.length === 0 ? spent : itemsSum;
    totals.items += itemsTotal;
    totals.fees += fees; totals.discounts += discounts; totals.roundOff += roundOff;
    const mineLines = items.filter((_, n) => !(basis === "mine" && sf.items[n] <= 0)).length;
    totals.itemLines += mineLines;

    // From where
    const mk = mKey || "—";
    let m = merchants.get(mk);
    if (!m) { m = { name: mName || "No merchant noted", noted: !!mName, total: 0, bills: 0, avgBill: 0, items: 0, fees: 0, discounts: 0, extrasPct: 0, lastDate: day, topCategory: "", lines: 0, cats: new Map() }; merchants.set(mk, m); }
    m.total += spent; m.bills += 1; m.items += itemsTotal; m.fees += fees; m.discounts += discounts; m.lines += mineLines;
    if (day > m.lastDate) m.lastDate = day;
    m.cats.set(mainCat, (m.cats.get(mainCat) ?? 0) + spent);

    // Item by item
    for (const [n, i] of items.entries()) {
      const fi = sf.items[n];
      if (basis === "mine" && fi <= 0) continue; // a line that's only your friend's isn't yours to count
      const key = i.itemId ? idOf(i.itemId) : `n:${i.name.trim().toLowerCase()}`;
      let a = itemAcc.get(key);
      const fam = i.unit ? FAMILIES[i.unit.toLowerCase()] : undefined;
      if (!a) {
        a = { key, name: i.name, categoryId: idOf(i.categoryId) || mainCat, spent: 0, buys: 0, family: fam?.family ?? null, div: fam?.div ?? 1, unitLabel: fam?.label ?? (i.unit ?? null), base: 0, priced: [], merchants: new Map(), first: day, last: day };
        itemAcc.set(key, a);
      }
      a.spent += i.amount * fi; a.buys += 1;
      if (day < a.first) a.first = day;
      if (day >= a.last) { a.last = day; a.categoryId = idOf(i.categoryId) || mainCat; }
      a.merchants.set(mName || "No merchant noted", (a.merchants.get(mName || "No merchant noted") ?? 0) + i.amount * fi);
      const baseQ = i.baseQuantity && i.baseQuantity > 0 ? i.baseQuantity : i.quantity && i.quantity > 0 && fam ? i.quantity * (i.unit?.toLowerCase() === "kg" || i.unit?.toLowerCase() === "l" ? 1000 : i.unit?.toLowerCase() === "dozen" ? 12 : 1) : 0;
      if (baseQ > 0 && fam && a.family === fam.family) {
        a.base += baseQ;
        a.priced.push({ amount: i.amount, qty: baseQ / a.div, date: day, w: fi });
      }
    }
  }

  merchants.forEach((m) => {
    m.avgBill = round2(m.total / m.bills);
    m.extrasPct = m.items > 0 ? round2((m.fees / m.items) * 100) : 0;
    const top = [...m.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    m.topCategory = top ? catName(top[0]) : "";
  });
  totals.merchants = [...merchants.values()].filter((m) => m.noted).length;
  totals.avgBill = totals.bills ? totals.spent / totals.bills : 0;
  totals.activeDays = days.size;

  const itemRows: ItemRow[] = [...itemAcc.values()].map((a) => {
    const unitPrices = a.priced.map((p) => ({ unit: p.amount / p.qty, date: p.date }));
    // Price per unit uses everything that was bought; the quantity shown is your part of it.
    const fullQty = a.priced.length ? sum(a.priced.map((p) => p.qty)) : null;
    const qty = a.priced.length ? sum(a.priced.map((p) => p.qty * p.w)) : null;
    const amt = sum(a.priced.map((p) => p.amount));
    const sorted = [...unitPrices].sort((x, y) => (x.date < y.date ? -1 : 1));
    return {
      key: a.key, name: a.name, categoryId: a.categoryId, categoryName: catName(a.categoryId), categoryIcon: cats.get(a.categoryId)?.icon ?? "",
      spent: round2(a.spent), buys: a.buys,
      qty: qty != null ? round2(qty) : null, unit: qty != null ? a.unitLabel : null,
      avgUnit: fullQty ? round2(amt / fullQty) : null,
      minUnit: unitPrices.length ? round2(Math.min(...unitPrices.map((u) => u.unit))) : null,
      maxUnit: unitPrices.length ? round2(Math.max(...unitPrices.map((u) => u.unit))) : null,
      lastUnit: sorted.length ? round2(sorted[sorted.length - 1].unit) : null,
      merchants: [...a.merchants.entries()].map(([name, spent]) => ({ name, spent: round2(spent) })).sort((x, y) => y.spent - x.spent),
      firstDate: a.first, lastDate: a.last, prevSpent: 0, prevAvgUnit: null, changePct: null,
    };
  }).sort((x, y) => y.spent - x.spent);

  const fix = (t: Totals): Totals => ({ ...t, spent: round2(t.spent), items: round2(t.items), fees: round2(t.fees), discounts: round2(t.discounts), roundOff: round2(t.roundOff), avgBill: round2(t.avgBill) });
  return {
    totals: fix(totals),
    byDay: [...days.entries()].map(([date, total]) => ({ date, total: round2(total) })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    merchants: [...merchants.values()].map(({ cats: _c, ...m }) => ({ ...m, total: round2(m.total), items: round2(m.items), fees: round2(m.fees), discounts: round2(m.discounts) })).sort((a, b) => b.total - a.total),
    extras: [...extras.values()].map((e) => ({ ...e, amount: round2(e.amount) })).sort((a, b) => b.amount - a.amount),
    categories: [...categories.values()].map((c) => ({ ...c, total: round2(c.total), items: round2(c.items), extras: round2(c.extras) })).filter((c) => c.total !== 0).sort((a, b) => b.total - a.total),
    items: itemRows,
  };
}

/** Fill each item's "last month" numbers (spend and price per unit) from the previous month's analysis. */
export function attachPrevious(cur: MonthStats, prev: MonthStats | null) {
  if (!prev) return;
  const byKey = new Map(prev.items.map((i) => [i.key, i]));
  cur.items.forEach((i) => {
    const p = byKey.get(i.key);
    if (!p) return;
    i.prevSpent = p.spent;
    i.prevAvgUnit = p.avgUnit;
    if (i.avgUnit != null && p.avgUnit != null && p.avgUnit > 0) i.changePct = round2(((i.avgUnit - p.avgUnit) / p.avgUnit) * 100);
  });
}

export interface Insight { kind: "merchant" | "extras" | "saving" | "item" | "price" | "trend" | "day"; text: string }
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** A few plain sentences that say what stands out this month. */
export function buildInsights(cur: MonthStats, prev: MonthStats | null): Insight[] {
  const out: Insight[] = [];
  const t = cur.totals;
  if (t.spent <= 0) return out;

  if (prev && prev.totals.spent > 0) {
    const d = ((t.spent - prev.totals.spent) / prev.totals.spent) * 100;
    if (Math.abs(d) >= 3) out.push({ kind: "trend", text: `You spent ${Math.abs(Math.round(d))}% ${d > 0 ? "more" : "less"} than last month (${inr(t.spent)} against ${inr(prev.totals.spent)}).` });
  }
  const top = cur.merchants.find((m) => m.noted);
  if (top) out.push({ kind: "merchant", text: `${top.name} took the biggest share: ${inr(top.total)} (${Math.round((top.total / t.spent) * 100)}% of the month) over ${top.bills} ${top.bills === 1 ? "bill" : "bills"}.` });
  if (t.fees > 0 && t.items > 0) {
    const worst = [...cur.merchants].filter((m) => m.noted && m.fees > 0).sort((a, b) => b.fees - a.fees)[0];
    out.push({ kind: "extras", text: `Fees and taxes added ${inr(t.fees)} on top of what you bought (${((t.fees / t.items) * 100).toFixed(1)}% extra).${worst ? ` Most of it, ${inr(worst.fees)}, came from ${worst.name}.` : ""}` });
  }
  if (t.discounts > 0) out.push({ kind: "saving", text: `Coupons and discounts saved you ${inr(t.discounts)} this month.` });
  const most = [...cur.items].sort((a, b) => b.buys - a.buys)[0];
  if (most && most.buys >= 2) out.push({ kind: "item", text: `${most.name} was bought ${most.buys} times, ${inr(most.spent)} in all.` });
  const up = cur.items.filter((i) => i.changePct != null && i.changePct >= 8).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0];
  if (up) out.push({ kind: "price", text: `${up.name} is ${Math.round(up.changePct ?? 0)}% dearer per ${up.unit ?? "unit"} than last month (${inr(up.avgUnit ?? 0)} against ${inr(up.prevAvgUnit ?? 0)}).` });
  else {
    const down = cur.items.filter((i) => i.changePct != null && i.changePct <= -8).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))[0];
    if (down) out.push({ kind: "price", text: `${down.name} got ${Math.abs(Math.round(down.changePct ?? 0))}% cheaper per ${down.unit ?? "unit"} than last month.` });
  }
  const bigDay = [...cur.byDay].sort((a, b) => b.total - a.total)[0];
  if (bigDay && cur.byDay.length >= 3) out.push({ kind: "day", text: `Your biggest day was ${new Date(`${bigDay.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}, with ${inr(bigDay.total)}.` });
  return out;
}
