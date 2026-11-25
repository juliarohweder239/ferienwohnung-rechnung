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
function inRange(d, von, bis) {
const x = [d.getMonth() + 1, d.getDate()], a = md(von), b = md(bis);
return cmp(a, b) <= 0 ? (cmp(x, a) >= 0 && cmp(x, b) < 0) : (cmp(x, a) >= 0 || cmp(x, b) < 0);
}
function seasonFor(d) {
for (const s of CFG.saisons) if (s.zeitraeume.some(z => inRange(d, z.von, z.bis))) return [s.name, s.preis];
return [CFG.standard.name, CFG.standard.preis];
}
function calc(von, bis, extras, einm, rabNames, rfrei, kurz, rdatum) {
const n = Math.round((bis - von) / 864e5);
if (!(n >= 1)) throw new Error("Abreise muss nach Anreise liegen.");
const gr = {};
for (let i = 0; i < n; i++) { const [nm, p] = seasonFor(addDays(von, i)); (gr[nm] = gr[nm] || {n: 0, p}).n++; }
const pos = Object.entries(gr).map(([nm, g]) => [CFG.uebernachtung_text.replace("{name}", nm), g.n, g.p, g.n * g.p]);
for (const [k, a] of Object.entries(extras)) if (a > 0) { const p = CFG.zuschlaege_pro_nacht[k]; pos.push([k, a, p * n, a * p * n]); }
if (kurz && n <= CFG.kurzaufenthalt.max_naechte) pos.push(["Zuschlag Kurzaufenthalt", 1, CFG.kurzaufenthalt.zuschlag, CFG.kurzaufenthalt.zuschlag]);
const basis = pos.reduce((s, p) => s + p[3], 0);
for (const r of CFG.rabatte || []) {
const gew = rabNames.includes(r.name);
if (!(gew || r.automatisch)) continue;
let ok = n >= (r.min_naechte || 0);
if (ok && r.zeitraum_von && r.zeitraum_bis) ok = inRange(von, r.zeitraum_von, r.zeitraum_bis);
if (!ok) { if (gew) throw new Error("Rabatt " + r.name + " gilt für diesen Aufenthalt nicht."); continue; }
if (r.art === "prozent") { const b = -r2(basis * r.wert / 100); pos.push([r.name, 1, b, b]); }
else if (r.art === "pro_nacht") pos.push([r.name, n, -r.wert, -r.wert * n]);
else pos.push([r.name, 1, -r.wert, -r.wert]);
}
if (rfrei > 0) { const b = -r2(basis * rfrei / 100); pos.push([rfrei + " % Rabatt", 1, b, b]); }
const uebern = r2(pos.reduce((s, p) => s + p[3], 0));
const ein = [["Endreinigung", 1, CFG.einmalig.Endreinigung, CFG.einmalig.Endreinigung]];
for (const [k, a] of Object.entries(einm)) if (a > 0) ein.push([k, a, CFG.einmalig[k], a * CFG.einmalig[k]]);
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
document.querySelectorAll("#new input,#new select").forEach(e => e.addEventListener("input", preview));
}
function readForm() {
const extras = {}, einm = {};
document.querySelectorAll("[data-x]").forEach(e => extras[e.dataset.x] = Number(e.value) || 0);
document.querySelectorAll("[data-e]").forEach(e => einm[e.dataset.e] = Number(e.value) || 0);
return {extras, einm, rab: [...$("rabatte").selectedOptions].map(o => o.value), rfrei: Number($("rfrei").value) || 0, kurz: $("kurz").checked};
}
const row4 = p => "<tr><td>" + p[0] + '</td><td class="r">' + p[1] + '</td><td class="r">' + eur(p[2]) + '</td><td class="r">' + eur(p[3]) + "</td></tr>";
function preview() {
const el = $("preview");
if (!$("von").value || !$("bis").value) { el.textContent = "Bitte Zeitraum wählen."; return; }
try {
const f = readForm(), r = calc(pd($("von").value), pd($("bis").value), f.extras, f.einm, f.rab, f.rfrei, f.kurz, new Date());
el.innerHTML = "<table>" + r.pos.map(row4).join("") + r.ein.map(row4).join("") +
"<tr><th>Gesamt (" + r.n + ' Nächte)</th><th></th><th></th><th class="r">' + eur(r.gesamt) + "</th></tr>" +
"<tr><td>" + (r.vollSofort ? "Gesamtbetrag, sofort fällig" : "Anzahlung " + CFG.zahlung.anzahlung_prozent + " %, fällig bei Buchung") + '</td><td></td><td></td><td class="r">' + eur(r.vollSofort ? r.gesamt : r.anz) + "</td></tr>" +
(r.vollSofort ? "" : "<tr><td>Restbetrag, fällig bis " + dstr(r.restDatum) + '</td><td></td><td></td><td class="r">' + eur(r.rest) + "</td></tr>") + "</table>";
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
const f = readForm(), heute = new Date(), r = calc(von, bis, f.extras, f.einm, f.rab, f.rfrei, f.kurz, heute), jahr = heute.getFullYear();
const {data: lfd, error: e1} = await sb.rpc("next_invoice_number", {p_jahr: jahr}); if (e1) throw e1;
const nr = fmtNr(jahr, lfd);
const gast = {anrede: $("anrede").value, name, strasse: $("gstr").value.trim(), ort: $("gort").value.trim()};
const {error: e2} = await sb.from("invoices").insert({nr, jahr, lfd, rechnungsdatum: iso(heute), gast, von: iso(von), bis: iso(bis), naechte: r.n,
daten: {positionen: r.pos, einmalig: r.ein, uebernachtung: r.uebern, zusatz: r.zusatz, voll_sofort: r.vollSofort},
gesamt: r.gesamt, anzahlung: r.vollSofort ? r.gesamt : r.anz, restzahlung: r.vollSofort ? 0 : r.rest, rest_zahlbar_bis: r.vollSofort ? null : iso(r.restDatum)});
if (e2) throw e2;
makePdf(gast, von, bis, r, nr, heute);
msg.className = "ok"; msg.textContent = "Rechnung " + nr + " erstellt.";
} catch (e) { msg.className = "err"; msg.textContent = e.message || String(e); }
}
function makePdf(g, von, bis, r, nr, datum) {
const {jsPDF} = window.jspdf, doc = new jsPDF({unit: "mm", format: "a4"}), C = CFG, v = C.vermieter, w = C.wohnung, z = C.zahlung, L = 20, R = 190;
let y = 14;
const lh = 60 * window.LOGO_H / window.LOGO_W;
doc.addImage(window.LOGO, "PNG", L, y, 60, lh); y += lh + 6;
doc.setFontSize(8).setTextColor(120).text(v.name + " | " + v.strasse + " | " + v.ort, L, y); doc.setTextColor(0).setFontSize(10); y += 6;
const emp = [g.anrede, g.name, g.strasse, g.ort].filter(Boolean), ab = [v.name, v.strasse, v.ort, "Tel. " + v.telefon, "Mobil " + v.mobil, v.email];
emp.forEach((t, i) => doc.text(t, L, y + i * 5)); ab.forEach((t, i) => doc.text(t, 125, y + i * 5)); y += Math.max(emp.length, ab.length) * 5 + 8;
doc.setFont("helvetica", "bold").setFontSize(14).text("Buchungsbestätigung & Rechnung", L, y); y += 8;
doc.setFontSize(10).text("Rechnungsnummer: " + nr, L, y); doc.setFont("helvetica", "normal").text("Datum: " + dstr(datum), 125, y); y += 8;
const gr = g.anrede === "Herr" ? "Sehr geehrter Herr " + g.name : g.anrede === "Frau" ? "Sehr geehrte Frau " + g.name : "Sehr geehrte Damen und Herren";
doc.text(gr + ",", L, y); y += 6;
doc.text(doc.splitTextToSize("gerne bestätigen wir Ihnen die Buchung über den unten genannten Zeitraum. Im Folgenden erhalten Sie die Rechnung für Ihren Aufenthalt bei uns.", R - L), L, y); y += 12;
[["Adresse der Ferienwohnung", w.adresse], ["Anreise", dstr(von) + " ab " + w.anreise_zeit], ["Abreise", dstr(bis) + " bis " + w.abreise_zeit]].forEach(([a, b]) => {
doc.setFont("helvetica", "bold").text(a, L, y); doc.setFont("helvetica", "normal").text(b, L + 60, y); y += 5.5;
});
y += 4;
const head = (a, b, c, d) => {
doc.setFillColor(240, 240, 240).rect(L, y - 4.5, R - L, 6.5, "F"); doc.setFont("helvetica", "bold");
doc.text(a, L + 1, y); doc.text(b, 125, y, {align: "right"}); doc.text(c, 158, y, {align: "right"}); doc.text(d, R - 1, y, {align: "right"});
y += 6; doc.setFont("helvetica", "normal");
};
const line = (a, b, c, d, bold) => {
if (bold) doc.setFont("helvetica", "bold");
doc.text(a, L + 1, y); if (b !== "") doc.text(String(b), 125, y, {align: "right"}); if (c !== "") doc.text(c, 158, y, {align: "right"});
doc.text(d, R - 1, y, {align: "right"}); doc.setFont("helvetica", "normal"); y += 5.5;
};
head("Pro Nacht", "Menge", "Einzelpreis", "Gesamt");
r.pos.forEach(p => line(p[0], p[1], eur(p[2]), eur(p[3])));
doc.line(L, y - 3.5, R, y - 3.5); line("Übernachtungspreis", "", "", eur(r.uebern), true); y += 2;
head("Einmalige Kosten", "Anzahl", "Einzelpreis", "Gesamt");
r.ein.forEach(p => line(p[0], p[1], eur(p[2]), eur(p[3])));
line("Zusatzkosten", "", "", eur(r.zusatz), true); doc.line(L, y - 3.5, R, y - 3.5);
line("Gesamtrechnungsbetrag", "", "", eur(r.gesamt), true);
if (r.vollSofort) line("Zahlbetrag (sofort fällig)", "", "", eur(r.gesamt), true);
else { line("Anzahlung " + z.anzahlung_prozent + " % (fällig bei Buchung)", "", "", eur(r.anz), true); line("Restbetrag (fällig bis " + dstr(r.restDatum) + ")", "", "", eur(r.rest)); }
y += 1;
doc.setFontSize(8).setTextColor(120).text(C.hinweis_steuer, L, y); doc.setTextColor(0).setFontSize(10); y += 6;
const pay = r.vollSofort
? "Bitte überweisen Sie den Gesamtbetrag von " + eur(r.gesamt) + " innerhalb von " + z.anzahlung_frist_tage + " Tagen nach Erhalt dieser Rechnung (spätestens vor Anreise) auf das unten genannte Bankkonto."
: "Bei Buchung fällig: " + z.anzahlung_prozent + " % Anzahlung = " + eur(r.anz) + ". Bitte überweisen Sie den Anzahlungsbetrag innerhalb von " + z.anzahlung_frist_tage + " Tagen nach Erhalt dieser Rechnung auf das unten genannte Bankkonto. Der Restbetrag in Höhe von " + eur(r.rest) + " ist bis zum " + dstr(r.restDatum) + " zu zahlen.";
const pl = doc.splitTextToSize(pay, R - L); doc.text(pl, L, y); y += pl.length * 4.8 + 4;
const bank = [["Bank:", z.bank], ["Kontoinhaber:", z.kontoinhaber], ["IBAN:", z.iban], ["BIC:", z.bic]]; if (z.paypal) bank.push(["oder PayPal:", z.paypal]);
doc.rect(L, y - 4, 110, bank.length * 5.2 + 2); bank.forEach(([a, b], i) => { doc.text(a, L + 2, y + i * 5.2); doc.text(b, L + 35, y + i * 5.2); }); y += bank.length * 5.2 + 6;
doc.text("Mit freundlichen Grüßen", L, y); doc.text(v.name, L, y + 5); y += 14;
const sl = doc.splitTextToSize(C.storno_einleitung, R - L), need = 8 + sl.length * 4.5 + C.storno.length * 5;
if (y + need > 285) { doc.addPage(); y = 20; }
doc.setFont("helvetica", "bold").text("Stornierungsbedingungen", L, y); y += 5.5; doc.setFont("helvetica", "normal").setFontSize(9);
doc.text(sl, L, y); y += sl.length * 4.5 + 1;
C.storno.forEach(([a, b]) => { doc.text(a, L, y); doc.text(b, L + 85, y); y += 5; });
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
const rows = [["RE-Nr", "Rechnungsdatum", "Gast", "Von", "Bis", "Nächte", "Endpreis", "Anzahlung", "Restzahlung", "Rest zahlbar bis", "Status"]];
const c = x => String(x).replace(".", ",");
(window.INV || []).forEach(i => rows.push([i.nr, dstr(pd(i.rechnungsdatum)), i.gast.name, dstr(pd(i.von)), dstr(pd(i.bis)), i.naechte, c(i.gesamt), c(i.anzahlung), c(i.restzahlung), i.rest_zahlbar_bis ? dstr(pd(i.rest_zahlbar_bis)) : "", i.status]));
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
H("Rabatte") + ta("s_rab", "Eine pro Zeile: Name | art (prozent, pro_nacht, pauschal) | Wert | min. Nächte | automatisch (ja/nein) | Zeitraum von | bis (optional, TT.MM.)",
(C.rabatte || []).map(r => [r.name, r.art, r.wert, r.min_naechte || 0, r.automatisch ? "ja" : "nein", r.zeitraum_von || "", r.zeitraum_bis || ""].join(" | ")).join(NL)) +
H("Zahlung") + '<div class="g">' + f("s_bank", "Bank", z.bank) + f("s_inh", "Kontoinhaber", z.kontoinhaber) + f("s_iban", "IBAN", z.iban) + f("s_bic", "BIC", z.bic) + f("s_pp", "PayPal", z.paypal) +
f("s_ap", "Anzahlung in %", z.anzahlung_prozent) + f("s_am", "Anzahlung nur, wenn Anreise mehr als X Tage entfernt", z.anzahlung_ab_tage == null ? 14 : z.anzahlung_ab_tage) + f("s_af", "Frist Anzahlung (Tage)", z.anzahlung_frist_tage) + f("s_rv", "Restzahlung X Tage vor Anreise", z.rest_vor_anreise_tage) + "</div>" +
H("Stornierung") + f("s_stei", "Einleitungstext", C.storno_einleitung) + ta("s_sto", "Regeln (eine pro Zeile: Zeitraum | Kosten)", C.storno.map(s => s.join(" | ")).join(NL)) +
H("Vermieter und Wohnung") + '<div class="g">' + f("s_vn", "Name", v.name) + f("s_vs", "Straße", v.strasse) + f("s_vo", "PLZ Ort", v.ort) + f("s_vt", "Telefon", v.telefon) + f("s_vm", "Mobil", v.mobil) + f("s_ve", "E-Mail", v.email) +
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
const nc = Object.assign({}, CFG, {
standard: {name: "Standard", preis: num("s_std")}, uebernachtung_text: $("s_ues").value, saisons,
zuschlaege_pro_nacht: pairs($("s_zus").value), einmalig: ein, kurzaufenthalt: {max_naechte: num("s_kn"), zuschlag: num("s_kz")}, rabatte,
zahlung: {bank: $("s_bank").value, kontoinhaber: $("s_inh").value, iban: $("s_iban").value, bic: $("s_bic").value, paypal: $("s_pp").value,
anzahlung_prozent: num("s_ap"), anzahlung_ab_tage: num("s_am"), anzahlung_frist_tage: num("s_af"), rest_vor_anreise_tage: num("s_rv")},
storno_einleitung: $("s_stei").value, storno: lines($("s_sto").value).map(l => l.split("|").map(s => s.trim())),
vermieter: {name: $("s_vn").value, strasse: $("s_vs").value, ort: $("s_vo").value, telefon: $("s_vt").value, mobil: $("s_vm").value, email: $("s_ve").value},
wohnung: {bezeichnung: $("s_wb").value, adresse: $("s_wa").value, anreise_zeit: $("s_an").value, abreise_zeit: $("s_ab").value},
hinweis_steuer: $("s_tax").value, rechnungsnummer_format: $("s_nrf").value});
const {error} = await sb.from("settings").update({config: nc, updated_at: new Date().toISOString()}).eq("id", 1); if (error) throw error;
CFG = nc; buildForm(); m.className = "ok"; m.textContent = "Gespeichert.";
} catch (e) { m.className = "err"; m.textContent = e.message || String(e); }
}
sb.auth.getSession().then(({data: {session}}) => { if (session) start(); });
