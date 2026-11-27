const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
let CFG = null;
const NL = String.fromCharCode(10);
const $ = id => document.getElementById(id);
const eur = x => x.toLocaleString("de-DE", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " €";
const pad = n => String(n).padStart(2, "0");
const dstr = d => pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const pd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const md = s => { const [t, m] = s.trim().replace(/[.]$/, "").split("."); return [Number(m), Number(t)]; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const nn = n => n === 1 ? "Nacht" : "Nächte";
const webOf = v => v.website == null ? "www.ferienwohnung-rohweder.de" : v.website;
const quellenOf = C => C.buchungsquellen || [{name: "Traumferienwohnung.de", aufschlag_prozent: 5}];
function inRange(d, von, bis) {
const x = [d.getMonth() + 1, d.getDate()], a = md(von), b = md(bis);
return cmp(a, b) <= 0 ? (cmp(x, a) >= 0 && cmp(x, b) < 0) : (cmp(x, a) >= 0 || cmp(x, b) < 0);
}
function seasonFor(d) {
for (const s of CFG.saisons) if (s.zeitraeume.some(z => inRange(d, z.von, z.bis))) return [s.name, s.preis];
return [CFG.standard.name, CFG.standard.preis];
}
// Positionen: [Name, Menge, Einzelpreis, Gesamt, Berechnungstext]
function calc(von, bis, extras, einm, rabNames, rfrei, kurz, rdatum, quelle) {
const n = Math.round((bis - von) / 864e5);
if (!(n >= 1)) throw new Error("Abreise muss nach Anreise liegen.");
const gr = {};
for (let i = 0; i < n; i++) { const [nm, p] = seasonFor(addDays(von, i)); (gr[nm] = gr[nm] || {n: 0, p}).n++; }
const pos = Object.entries(gr).map(([nm, g]) => [CFG.uebernachtung_text.replace("{name}", nm), g.n, g.p, g.n * g.p, g.n + " " + nn(g.n) + " × " + eur(g.p)]);
const nS = pos.length;
for (const [k, a] of Object.entries(extras)) if (a > 0) { const p = CFG.zuschlaege_pro_nacht[k]; pos.push([k, a, p * n, a * p * n, a + " × " + n + " " + nn(n) + " × " + eur(p)]); }
if (kurz && n <= CFG.kurzaufenthalt.max_naechte) pos.push(["Zuschlag Kurzaufenthalt", 1, CFG.kurzaufenthalt.zuschlag, CFG.kurzaufenthalt.zuschlag, "pauschal"]);
const basis = pos.reduce((s, p) => s + p[3], 0);
for (const r of CFG.rabatte || []) {
const gew = rabNames.includes(r.name);
if (!(gew || r.automatisch)) continue;
let ok = n >= (r.min_naechte || 0);
if (ok && r.zeitraum_von && r.zeitraum_bis) ok = inRange(von, r.zeitraum_von, r.zeitraum_bis);
if (!ok) { if (gew) throw new Error("Rabatt " + r.name + " gilt für diesen Aufenthalt nicht."); continue; }
if (r.art === "prozent") { const b = -r2(basis * r.wert / 100); pos.push([r.name, 1, b, b, r.wert + " % auf " + eur(basis)]); }
else if (r.art === "pro_nacht") pos.push([r.name, n, -r.wert, -r.wert * n, n + " " + nn(n) + " × " + eur(-r.wert)]);
else pos.push([r.name, 1, -r.wert, -r.wert, "pauschal"]);
}
if (rfrei > 0) { const b = -r2(basis * rfrei / 100); pos.push([rfrei + " % Rabatt", 1, b, b, rfrei + " % auf " + eur(basis)]); }
const q = quelle ? quellenOf(CFG).find(x => x.name === quelle) : null;
if (q && q.aufschlag_prozent > 0) { const nb = pos.slice(0, nS).reduce((s, p) => s + p[3], 0), a = r2(nb * q.aufschlag_prozent / 100); pos.splice(nS, 0, ["Aufschlag " + q.name, 1, a, a, q.aufschlag_prozent + " % auf " + eur(nb)]); }
const uebern = r2(pos.reduce((s, p) => s + p[3], 0));
const ein = [["Endreinigung", 1, CFG.einmalig.Endreinigung, CFG.einmalig.Endreinigung, "einmalig"]];
for (const [k, a] of Object.entries(einm)) if (a > 0) ein.push([k, a, CFG.einmalig[k], a * CFG.einmalig[k], a + " × " + eur(CFG.einmalig[k])]);
const zusatz = r2(ein.reduce((s, e) => s + e[3], 0)), gesamt = r2(uebern + zusatz), z = CFG.zahlung;
const anz = r2(gesamt * z.anzahlung_prozent / 100);
const vollSofort = !(von > addDays(rdatum, z.anzahlung_ab_tage == null ? 14 : z.anzahlung_ab_tage));
const r1 = addDays(von, -z.rest_vor_anreise_tage), r2d = addDays(rdatum, z.anzahlung_frist_tage);
const restDatum = r1 > r2d ? r1 : r2d;
return {n, pos, uebern, ein, zusatz, gesamt, anz, rest: r2(gesamt - anz), restDatum, vollSofort};
}
async function doLogin() {
$("lerr").textContent = "";
const {error} = await sb.auth.signInWithPassword({email: $("em").value.trim(), password: $("pw").value});
if (error) { $("lerr").textContent = "Anmeldung fehlgeschlagen."; return; }
start();
}
async function logout() { await sb.auth.signOut(); location.reload(); }
async function start() {
const {data: {session}} = await sb.auth.getSession();
if (!session) return;
const {data, error} = await sb.from("settings").select("config").eq("id", 1).single();
if (error) { $("lerr").textContent = "Einstellungen konnten nicht geladen werden: " + error.message; return; }
CFG = data.config; $("login").classList.add("hidden"); $("app").classList.remove("hidden");
buildForm(); buildSettings(); tab("new");
}
function tab(t) {
for (const s of ["new", "list", "set"]) { $(s).classList.toggle("hidden", s !== t); $("t_" + s).classList.toggle("on", s === t); }
if (t === "list") loadList();
}
function buildForm() {
let h = "";
for (const k of Object.keys(CFG.zuschlaege_pro_nacht)) h += '<div><label>' + k + ' (Anzahl)</label><input type="number" min="0" value="0" data-x="' + k + '"></div>';
for (const k of Object.keys(CFG.einmalig)) if (k !== "Endreinigung") h += '<div><label>' + k + ' (Anzahl)</label><input type="number" min="0" value="0" data-e="' + k + '"></div>';
$("extras").innerHTML = h;
$("rabatte").innerHTML = (CFG.rabatte || []).map(r => "<option>" + r.name + "</option>").join("");
$("quelle").innerHTML = '<option value="">Direktbuchung</option>' + quellenOf(CFG).map(q => "<option>" + q.name + "</option>").join("");
if (!$("bdatum").value) $("bdatum").value = iso(new Date());
$("bezahlt").onchange = () => $("bwrap").classList.toggle("hidden", !$("bezahlt").checked);
document.querySelectorAll("#new input,#new select").forEach(e => e.addEventListener("input", preview));
}
function readForm() {
const extras = {}, einm = {};
document.querySelectorAll("[data-x]").forEach(e => extras[e.dataset.x] = Number(e.value) || 0);
document.querySelectorAll("[data-e]").forEach(e => einm[e.dataset.e] = Number(e.value) || 0);
return {extras, einm, rab: [...$("rabatte").selectedOptions].map(o => o.value), rfrei: Number($("rfrei").value) || 0, kurz: $("kurz").checked, quelle: $("quelle").value};
}
const row3 = p => "<tr><td>" + p[0] + '</td><td>' + p[4] + '</td><td class="r">' + eur(p[3]) + "</td></tr>";
function preview() {
const el = $("preview");
if (!$("von").value || !$("bis").value) { el.textContent = "Bitte Zeitraum wählen."; return; }
try {
const f = readForm(), r = calc(pd($("von").value), pd($("bis").value), f.extras, f.einm, f.rab, f.rfrei, f.kurz, new Date(), f.quelle), paid = $("bezahlt").checked;
const zeile = (a, b) => "<tr><td>" + a + '</td><td></td><td class="r">' + eur(b) + "</td></tr>";
el.innerHTML = "<table>" + r.pos.map(row3).join("") + r.ein.map(row3).join("") +
"<tr><th>Gesamt (" + r.n + ' Nächte)</th><th></th><th class="r">' + eur(r.gesamt) + "</th></tr>" +
(paid ? zeile("Bereits bezahlt", r.gesamt) + zeile("Offener Betrag", 0) :
zeile(r.vollSofort ? "Gesamtbetrag, sofort fällig" : "Anzahlung " + CFG.zahlung.anzahlung_prozent + " %, fällig bei Buchung", r.vollSofort ? r.gesamt : r.anz) +
(r.vollSofort ? "" : zeile("Restbetrag, fällig bis " + dstr(r.restDatum), r.rest))) + "</table>";
} catch (e) { el.innerHTML = '<span class="err">' + e.message + "</span>"; }
}
function fmtNr(jahr, lfd) {
return CFG.rechnungsnummer_format.replace("{jahr}", jahr).replace(/[{]lfd(?::0?([0-9]+)d)?[}]/, (m, w) => String(lfd).padStart(Number(w) || 1, "0"));
}
async function createInvoice() {
const msg = $("nmsg"); msg.className = ""; msg.textContent = "";
try {
const von = pd($("von").value), bis = pd($("bis").value), name = $("gname").value.trim();
if (!name) throw new Error("Bitte einen Namen eingeben.");
const link = $("zlink").value.trim();
if (link && !/^https?:[/][/]/i.test(link)) throw new Error("Der Zahlungslink muss mit https:// beginnen.");
const bez = $("bezahlt").checked;
if (bez && !$("bdatum").value) throw new Error("Bitte das Zahlungsdatum angeben.");
const paid = bez ? pd($("bdatum").value) : null;
const f = readForm(), heute = new Date(), r = calc(von, bis, f.extras, f.einm, f.rab, f.rfrei, f.kurz, heute, f.quelle), jahr = heute.getFullYear();
const {data: lfd, error: e1} = await sb.rpc("next_invoice_number", {p_jahr: jahr}); if (e1) throw e1;
const nr = fmtNr(jahr, lfd);
const gast = {anrede: $("anrede").value, name, strasse: $("gstr").value.trim(), ort: $("gort").value.trim()};
const voll = r.vollSofort || bez;
const {error: e2} = await sb.from("invoices").insert({nr, jahr, lfd, rechnungsdatum: iso(heute), gast, von: iso(von), bis: iso(bis), naechte: r.n,
daten: {positionen: r.pos, einmalig: r.ein, uebernachtung: r.uebern, zusatz: r.zusatz, voll_sofort: r.vollSofort, zahlungslink: link || null, bezahlt_am: paid ? iso(paid) : null, quelle: f.quelle || "Direktbuchung"},
gesamt: r.gesamt, anzahlung: voll ? r.gesamt : r.anz, restzahlung: voll ? 0 : r.rest, rest_zahlbar_bis: voll ? null : iso(r.restDatum), status: bez ? "bezahlt" : "offen"});
if (e2) throw e2;
makePdf(gast, von, bis, r, nr, heute, {link: bez ? "" : link, paid});
msg.className = "ok"; msg.textContent = "Rechnung " + nr + " erstellt.";
} catch (e) { msg.className = "err"; msg.textContent = e.message || String(e); }
}
function makePdf(g, von, bis, r, nr, datum, opt) {
const {jsPDF} = window.jspdf, doc = new jsPDF({unit: "mm", format: "a4"}), C = CFG, v = C.vermieter, w = C.wohnung, z = C.zahlung, L = 20, R = 190, BOT = 272;
const paid = opt && opt.paid, link = opt && opt.link, web = webOf(v);
let y = 14;
const room = h => { if (y + h > BOT) { doc.addPage(); y = 20; } };
const lh = 60 * window.LOGO_H / window.LOGO_W;
doc.addImage(window.LOGO, "PNG", L, y, 60, lh); y += lh + 6;
doc.setFontSize(8).setTextColor(120).text(v.name + " | " + v.strasse + " | " + v.ort, L, y); doc.setTextColor(0).setFontSize(10); y += 6;
const emp = [g.anrede, g.name, g.strasse, g.ort].filter(Boolean), ab = [v.name, v.strasse, v.ort, "Tel. " + v.telefon, "Mobil " + v.mobil, v.email, web].filter(Boolean);
emp.forEach((t, i) => doc.text(t, L, y + i * 5)); ab.forEach((t, i) => doc.text(t, 125, y + i * 5)); y += Math.max(emp.length, ab.length) * 5 + 20;
doc.setFont("helvetica", "bold").setFontSize(14).text("Buchungsbestätigung & Rechnung", L, y); y += 9;
doc.setFontSize(10).text("Rechnungsnummer: " + nr, L, y); doc.setFont("helvetica", "normal").text("Datum: " + dstr(datum), 125, y); y += 9;
const gr = g.anrede === "Herr" ? "Sehr geehrter Herr " + g.name : g.anrede === "Frau" ? "Sehr geehrte Frau " + g.name : "Sehr geehrte Damen und Herren";
doc.text(gr + ",", L, y); y += 7;
doc.text(doc.splitTextToSize("gerne bestätigen wir Ihnen die Buchung über den unten genannten Zeitraum. Im Folgenden erhalten Sie die Rechnung für Ihren Aufenthalt bei uns.", R - L), L, y); y += 14;
[["Adresse der Ferienwohnung", w.adresse], ["Anreise", dstr(von) + " ab " + w.anreise_zeit], ["Abreise", dstr(bis) + " bis " + w.abreise_zeit]].forEach(([a, b]) => {
doc.setFont("helvetica", "bold").text(a, L, y); doc.setFont("helvetica", "normal").text(b, L + 60, y); y += 6;
});
y += 8;
const head = (a, b, c) => {
room(16); doc.setFillColor(240, 240, 240).rect(L, y - 4.5, R - L, 6.5, "F"); doc.setFont("helvetica", "bold");
doc.text(a, L + 1, y); if (b) doc.text(b, 108, y); doc.text(c, R - 1, y, {align: "right"});
y += 7; doc.setFont("helvetica", "normal");
};
const line = (a, b, c, bold) => {
const al = doc.splitTextToSize(a, 84); room(al.length * 5 + 3);
if (bold) doc.setFont("helvetica", "bold");
doc.text(al, L + 1, y); if (b) doc.text(b, 108, y); doc.text(c, R - 1, y, {align: "right"});
doc.setFont("helvetica", "normal"); y += al.length * 5 + 1.5;
};
head("Leistung", "Berechnung", "Betrag");
r.pos.forEach(p => line(p[0], p[4], eur(p[3])));
doc.line(L, y - 3.5, R, y - 3.5); line("Übernachtungspreis", "", eur(r.uebern), true); y += 2;
head("Einmalige Kosten", "", "Betrag");
r.ein.forEach(p => line(p[0], p[4], eur(p[3])));
line("Zusatzkosten", "", eur(r.zusatz), true); doc.line(L, y - 3.5, R, y - 3.5);
line("Gesamtrechnungsbetrag", "", eur(r.gesamt), true);
if (paid) { line("Bereits bezahlt am " + dstr(paid), "", eur(r.gesamt)); line("Offener Betrag", "", eur(0), true); }
else if (r.vollSofort) line("Zahlbetrag (sofort fällig)", "", eur(r.gesamt), true);
else { line("Anzahlung " + z.anzahlung_prozent + " % (fällig bei Buchung)", "", eur(r.anz), true); line("Restbetrag (fällig bis " + dstr(r.restDatum) + ")", "", eur(r.rest)); }
y += 7;
if (paid) {
const t = doc.splitTextToSize("Der Rechnungsbetrag wurde bereits vollständig beglichen. Es ist keine weitere Zahlung erforderlich. Vielen Dank!", R - L);
room(t.length * 5 + 4); doc.setFont("helvetica", "bold"); doc.text(t, L, y); doc.setFont("helvetica", "normal"); y += t.length * 5 + 4;
} else {
const pay = r.vollSofort
? "Bitte überweisen Sie den Gesamtbetrag von " + eur(r.gesamt) + " innerhalb von " + z.anzahlung_frist_tage + " Tagen nach Erhalt dieser Rechnung (spätestens vor Anreise) auf folgendes Konto:"
: "Bei Buchung fällig: " + z.anzahlung_prozent + " % Anzahlung = " + eur(r.anz) + ". Bitte überweisen Sie den Anzahlungsbetrag innerhalb von " + z.anzahlung_frist_tage + " Tagen nach Erhalt dieser Rechnung auf folgendes Konto. Der Restbetrag in Höhe von " + eur(r.rest) + " ist bis zum " + dstr(r.restDatum) + " zu zahlen.";
const pl = doc.splitTextToSize(pay, R - L); room(pl.length * 5 + 24); doc.text(pl, L, y); y += pl.length * 5 + 5;
doc.setFillColor(242, 246, 248).rect(L, y - 4, R - L, 14, "F"); doc.setFontSize(9);
const rich = (parts, x, yy) => parts.forEach(([t, b]) => { doc.setFont("helvetica", b ? "bold" : "normal"); doc.text(t, x, yy); x += doc.getTextWidth(t); });
rich([["Bankverbindung: ", 1], [z.kontoinhaber + " · " + z.bank, 0]], L + 3, y + 0.5);
rich([["IBAN ", 1], [z.iban + " · ", 0], ["BIC ", 1], [z.bic, 0]], L + 3, y + 6);
doc.setFont("helvetica", "normal").setFontSize(10); y += 18;
if (link) {
const t = doc.splitTextToSize("Sie können den Betrag auch bequem per Kreditkarte zahlen:", R - L); room(t.length * 5 + 12);
doc.text(t, L, y); y += t.length * 5 + 1;
doc.setFontSize(9).setTextColor(31, 111, 139); doc.textWithLink(link, L, y, {url: link});
doc.line(L, y + 0.8, L + doc.getTextWidth(link), y + 0.8); doc.setTextColor(0).setFontSize(10); y += 10;
}
}
room(30); y += 4;
doc.text("Mit freundlichen Grüßen", L, y); doc.text(v.name, L, y + 5); y += 16;
doc.setFontSize(9);
const sl = doc.splitTextToSize(C.storno_einleitung, R - L), rules = C.storno.map(s => doc.splitTextToSize(s[0] + ": " + s[1], R - L)), hn = C.storno_hinweis ? doc.splitTextToSize(C.storno_hinweis, R - L) : [];
const need = 9 + sl.length * 4.8 + rules.reduce((a, t) => a + t.length * 4.8, 0) + (hn.length ? hn.length * 4.8 + 3 : 0);
room(need);
doc.setFont("helvetica", "bold").setFontSize(10).text("Stornierungsbedingungen", L, y); y += 5.5; doc.setFont("helvetica", "normal").setFontSize(9);
doc.text(sl, L, y); y += sl.length * 4.8 + 1.5;
rules.forEach(t => { doc.text(t, L, y); y += t.length * 4.8; });
if (hn.length) { y += 3; doc.text(hn, L, y); }
const N = doc.getNumberOfPages();
for (let i = 1; i <= N; i++) {
doc.setPage(i); doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(120);
doc.text(doc.splitTextToSize([w.bezeichnung, w.adresse, "Tel. " + v.telefon, v.email, web].filter(Boolean).join(" · "), R - L), 105, 280, {align: "center"});
doc.text(C.hinweis_steuer, 105, 286, {align: "center"});
doc.text("Seite " + i + " von " + N, R, 291, {align: "right"});
}
doc.save(nr + ".pdf");
}
async function loadList() {
const {data, error} = await sb.from("invoices").select("*").order("created_at", {ascending: false});
if (error) { $("ltab").innerHTML = '<tr><td class="err">' + error.message + "</td></tr>"; return; }
window.INV = data;
const opts = s => ["offen", "Anzahlung bezahlt", "bezahlt", "storniert"].map(o => "<option" + (o === s ? " selected" : "") + ">" + o + "</option>").join("");
$("ltab").innerHTML = '<tr><th>Nr.</th><th>Gast</th><th>Zeitraum</th><th class="r">Betrag</th><th>Status</th></tr>' + data.map(i =>
"<tr><td>" + i.nr + "</td><td>" + i.gast.name + "</td><td>" + dstr(pd(i.von)) + " – " + dstr(pd(i.bis)) + '</td><td class="r">' + eur(Number(i.gesamt)) +
'</td><td><select data-id="' + i.id + '">' + opts(i.status) + "</select></td></tr>").join("");
document.querySelectorAll("select[data-id]").forEach(s => s.addEventListener("change", () => setStatus(s.dataset.id, s.value)));
}
async function setStatus(id, s) { await sb.from("invoices").update({status: s}).eq("id", id); }
function exportCsv() {
const rows = [["RE-Nr", "Rechnungsdatum", "Gast", "Von", "Bis", "Nächte", "Endpreis", "Anzahlung", "Restzahlung", "Rest zahlbar bis", "Status", "Buchungsquelle"]];
const c = x => String(x).replace(".", ",");
(window.INV || []).forEach(i => rows.push([i.nr, dstr(pd(i.rechnungsdatum)), i.gast.name, dstr(pd(i.von)), dstr(pd(i.bis)), i.naechte, c(i.gesamt), c(i.anzahlung), c(i.restzahlung), i.rest_zahlbar_bis ? dstr(pd(i.rest_zahlbar_bis)) : "", i.status, (i.daten && i.daten.quelle) || "Direktbuchung"]));
const csv = String.fromCharCode(0xFEFF) + rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(";")).join(NL);
const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type: "text/csv"})); a.download = "rechnungen.csv"; a.click();
}
const lines = t => t.split(NL).map(s => s.trim()).filter(Boolean);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function buildSettings() {
const C = CFG, v = C.vermieter, w = C.wohnung, z = C.zahlung;
const f = (id, l, val) => "<label>" + l + '</label><input id="' + id + '" value="' + esc(val) + '">';
const ta = (id, l, val) => "<label>" + l + '</label><textarea id="' + id + '">' + esc(val) + "</textarea>";
const H = t => '<h2 style="margin-top:18px">' + t + "</h2>";
$("sform").innerHTML = H("Preise") + '<div class="g">' + f("s_std", "Standardpreis pro Nacht (€, 2 Personen)", C.standard.preis) + f("s_ues", "Text Übernachtung ({name} = Saison)", C.uebernachtung_text) + "</div>" +
ta("s_sais", "Saisons (eine pro Zeile: Name | Preis | von-bis; von-bis). Datum ohne Jahr, von inklusive, bis exklusive", C.saisons.map(s => s.name + " | " + s.preis + " | " + s.zeitraeume.map(z => z.von + "-" + z.bis).join("; ")).join(NL)) +
ta("s_zus", "Zuschläge pro Nacht (Name = Preis)", Object.entries(C.zuschlaege_pro_nacht).map(([k, p]) => k + " = " + p).join(NL)) +
ta("s_ein", "Einmalige Kosten (Name = Preis, Endreinigung muss vorhanden sein)", Object.entries(C.einmalig).map(([k, p]) => k + " = " + p).join(NL)) +
'<div class="g">' + f("s_kn", "Kurzaufenthalt: bis max. Nächte", C.kurzaufenthalt.max_naechte) + f("s_kz", "Kurzaufenthalt: Zuschlag (€)", C.kurzaufenthalt.zuschlag) + "</div>" +
H("Buchungsquellen") + ta("s_quel", "Portale mit Aufschlag (eine pro Zeile: Name | Aufschlag in % auf den Übernachtungspreis). Direktbuchung ist immer ohne Aufschlag.", quellenOf(C).map(q => q.name + " | " + q.aufschlag_prozent).join(NL)) +
H("Rabatte") + ta("s_rab", "Eine pro Zeile: Name | art (prozent, pro_nacht, pauschal) | Wert | min. Nächte | automatisch (ja/nein) | Zeitraum von | bis (optional, TT.MM.)",
(C.rabatte || []).map(r => [r.name, r.art, r.wert, r.min_naechte || 0, r.automatisch ? "ja" : "nein", r.zeitraum_von || "", r.zeitraum_bis || ""].join(" | ")).join(NL)) +
H("Zahlung") + '<div class="g">' + f("s_bank", "Bank", z.bank) + f("s_inh", "Kontoinhaber", z.kontoinhaber) + f("s_iban", "IBAN", z.iban) + f("s_bic", "BIC", z.bic) +
f("s_ap", "Anzahlung in %", z.anzahlung_prozent) + f("s_am", "Anzahlung nur, wenn Anreise mehr als X Tage entfernt", z.anzahlung_ab_tage == null ? 14 : z.anzahlung_ab_tage) + f("s_af", "Frist Anzahlung (Tage)", z.anzahlung_frist_tage) + f("s_rv", "Restzahlung X Tage vor Anreise", z.rest_vor_anreise_tage) + "</div>" +
H("Stornierung") + f("s_stei", "Einleitungstext", C.storno_einleitung) + ta("s_sto", "Regeln (eine pro Zeile: Zeitraum | Kosten)", C.storno.map(s => s.join(" | ")).join(NL)) + f("s_sth", "Hinweis unter den Regeln", C.storno_hinweis) +
H("Vermieter und Wohnung") + '<div class="g">' + f("s_vn", "Name", v.name) + f("s_vs", "Straße", v.strasse) + f("s_vo", "PLZ Ort", v.ort) + f("s_vt", "Telefon", v.telefon) + f("s_vm", "Mobil", v.mobil) + f("s_ve", "E-Mail", v.email) + f("s_vw", "Website", webOf(v)) +
f("s_wb", "Name Ferienwohnung", w.bezeichnung) + f("s_wa", "Adresse Ferienwohnung", w.adresse) + f("s_an", "Anreise ab", w.anreise_zeit) + f("s_ab", "Abreise bis", w.abreise_zeit) + "</div>" +
f("s_tax", "Steuerhinweis", C.hinweis_steuer) + f("s_nrf", "Rechnungsnummer-Format ({jahr}, {lfd:03d})", C.rechnungsnummer_format);
}
const num = id => { const x = Number(String($(id).value).replace(",", ".")); if (Number.isNaN(x)) throw new Error("Ungültige Zahl in: " + id); return x; };
const pairs = t => Object.fromEntries(lines(t).map(l => { const [k, p] = l.split("="); const n = Number(p.trim().replace(",", ".")); if (Number.isNaN(n)) throw new Error("Ungültiger Preis: " + l); return [k.trim(), n]; }));
async function saveSettings() {
const m = $("smsg"); m.className = ""; m.textContent = "";
try {
const ein = pairs($("s_ein").value); if (!("Endreinigung" in ein)) throw new Error("Endreinigung fehlt bei den einmaligen Kosten.");
const saisons = lines($("s_sais").value).map(l => {
const [n, p, zr] = l.split("|").map(s => s.trim()), pr = Number(p.replace(",", "."));
if (Number.isNaN(pr)) throw new Error("Ungültiger Preis: " + l);
return {name: n, preis: pr, zeitraeume: zr.split(";").map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split("-").map(x => x.trim()); md(a); md(b); return {von: a, bis: b}; })};
});
const rabatte = lines($("s_rab").value).map(l => {
const [n, a, wt, mn, au, zv, zb] = l.split("|").map(s => s.trim());
if (!["prozent", "pro_nacht", "pauschal"].includes(a)) throw new Error("Unbekannte Rabattart: " + l);
const r = {name: n, art: a, wert: Number(wt.replace(",", ".")), min_naechte: Number(mn || 0), automatisch: (au || "").toLowerCase() === "ja"};
if (zv && zb) { md(zv); md(zb); r.zeitraum_von = zv; r.zeitraum_bis = zb; }
return r;
});
const buchungsquellen = lines($("s_quel").value).map(l => {
const [n, p] = l.split("|").map(s => s.trim()), pr = Number(String(p || "0").replace(",", "."));
if (!n || Number.isNaN(pr)) throw new Error("Ungültige Buchungsquelle: " + l);
return {name: n, aufschlag_prozent: pr};
});
const nc = Object.assign({}, CFG, {
standard: {name: "Standard", preis: num("s_std")}, uebernachtung_text: $("s_ues").value, saisons, buchungsquellen,
zuschlaege_pro_nacht: pairs($("s_zus").value), einmalig: ein, kurzaufenthalt: {max_naechte: num("s_kn"), zuschlag: num("s_kz")}, rabatte,
zahlung: {bank: $("s_bank").value, kontoinhaber: $("s_inh").value, iban: $("s_iban").value, bic: $("s_bic").value,
anzahlung_prozent: num("s_ap"), anzahlung_ab_tage: num("s_am"), anzahlung_frist_tage: num("s_af"), rest_vor_anreise_tage: num("s_rv")},
storno_einleitung: $("s_stei").value, storno: lines($("s_sto").value).map(l => l.split("|").map(s => s.trim())), storno_hinweis: $("s_sth").value,
vermieter: {name: $("s_vn").value, strasse: $("s_vs").value, ort: $("s_vo").value, telefon: $("s_vt").value, mobil: $("s_vm").value, email: $("s_ve").value, website: $("s_vw").value},
wohnung: {bezeichnung: $("s_wb").value, adresse: $("s_wa").value, anreise_zeit: $("s_an").value, abreise_zeit: $("s_ab").value},
hinweis_steuer: $("s_tax").value, rechnungsnummer_format: $("s_nrf").value});
const {error} = await sb.from("settings").update({config: nc, updated_at: new Date().toISOString()}).eq("id", 1); if (error) throw error;
CFG = nc; buildForm(); m.className = "ok"; m.textContent = "Gespeichert.";
} catch (e) { m.className = "err"; m.textContent = e.message || String(e); }
}
sb.auth.getSession().then(({data: {session}}) => { if (session) start(); });
