"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, FileArchive, ImagePlus, Loader2, MapPin, Search, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Confidence = "High" | "Moderate" | "Low" | "Unknown";
type FactKey = "propertyType" | "bedrooms" | "fullBaths" | "halfBaths" | "squareFeet" | "lotSize" | "stories" | "basement" | "parking" | "waterfront";
type Fact = { key: FactKey; label: string; aiValue: string; confirmedValue: string; conflict?: boolean; sources?: string[] };
type EvidenceImage = { url: string; source?: string; date?: string; label?: string };
type GradeRow = { label: string; value: string; confidence: Confidence; reason?: string; images?: EvidenceImage[] };
type ArvResult = { lowPsf: number; lowTotal: number; highPsf: number; highTotal: number; ceiling: number; ceilingReason?: string; confidence: Confidence };
type Analysis = {
  id?: string; address: string; ownership: string; createdAt?: string; updatedAt?: string;
  facts: Fact[]; arv: ArvResult; construction: GradeRow[]; constructionTotal: string;
  constructionConfidence: Confidence; intangibles: GradeRow[]; additional: GradeRow[];
  evidenceImages: EvidenceImage[]; sourceLinks?: { label: string; url: string }[];
  status?: "draft" | "completed";
};
type ArchiveItem = { id: string; address: string; createdAt: string; arvLow?: number; arvHigh?: number };

const STEPS = ["Start Analysis", "Confirm Configuration", "Preliminary ARV", "Construction Grade", "Intangible Grading", "Additional Steps"];
const EMPTY_ANALYSIS: Analysis = {
  address: "", ownership: "", facts: [],
  arv: { lowPsf: 0, lowTotal: 0, highPsf: 0, highTotal: 0, ceiling: 0, confidence: "Unknown" },
  construction: [], constructionTotal: "—", constructionConfidence: "Unknown",
  intangibles: [], additional: [], evidenceImages: [], status: "draft",
};
const STORAGE_KEY = "wanderlust-stage2-current-v1";
const endpoint = "/api/stage2";

function money(value: number) { return value ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "—"; }
function confidenceTone(value: Confidence) { return value === "High" ? "confidence-high" : value === "Moderate" ? "confidence-moderate" : "confidence-low"; }
async function api(action: string, payload: Record<string, unknown> = {}) {
  if (!endpoint) throw new Error("Analysis service is not configured yet.");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "The analysis service returned an error.");
  return result;
}
async function runBackground(action: "startAnalyze" | "startRecalculate" | "startCompleteGrades", payload: Record<string, unknown>, address: string, ownership: string) {
  const started = await api(action, payload);
  const jobId = started.job?.id;
  if (!jobId) throw new Error("The Stage 2 service did not start a research job.");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const result = await api("poll", { jobId, address, ownership });
    if (result.job?.status === "completed" && result.job.analysis) return result.job.analysis as Analysis;
  }
  throw new Error("The Stage 2 research exceeded ten minutes. Please try again.");
}
async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis>(EMPTY_ANALYSIS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dataScout, setDataScout] = useState<string>("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      // Restoring a browser draft is an intentional one-time external-store sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnalysis(JSON.parse(saved));
    } catch { /* ignore invalid draft */ }
  }, []);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...analysis, updatedAt: new Date().toISOString() })); }, [analysis]);

  const progress = ((step + 1) / STEPS.length) * 100;
  const canContinue = useMemo(() => step === 0 ? analysis.address.trim().length > 5 : step === 1 ? analysis.facts.length > 0 && analysis.facts.every((fact) => fact.confirmedValue.trim()) : true, [analysis, step]);
  function updateFact(key: FactKey, value: string) { setAnalysis((current) => ({ ...current, facts: current.facts.map((fact) => fact.key === key ? { ...fact, confirmedValue: value } : fact) })); }

  async function startAnalysis() {
    setBusy(true); setMessage("");
    try {
      const address = analysis.address.trim();
      const ownership = analysis.ownership.trim();
      const researched = await runBackground("startAnalyze", { address, ownership, dataScoutImage: dataScout || undefined }, address, ownership);
      let completed: Analysis;
      try {
        completed = await runBackground("startCompleteGrades", { analysis: researched, includeImages: true }, address, ownership);
      } catch {
        completed = await runBackground("startCompleteGrades", { analysis: researched, includeImages: false }, address, ownership);
      }
      setAnalysis({
        ...researched,
        address,
        ownership,
        construction: completed.construction,
        constructionTotal: completed.constructionTotal,
        constructionConfidence: completed.constructionConfidence,
        intangibles: completed.intangibles,
        additional: completed.additional,
        evidenceImages: completed.evidenceImages?.length ? completed.evidenceImages : researched.evidenceImages,
        sourceLinks: Array.from(new Map([...(researched.sourceLinks || []), ...(completed.sourceLinks || [])].map((link) => [link.url, link])).values()),
        status: "draft",
      });
      setStep(1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to begin analysis."); } finally { setBusy(false); }
  }
  async function continueFromFacts() {
    setBusy(true); setMessage("");
    try {
      const configurationChanged = analysis.facts.some((fact) => fact.confirmedValue.trim() !== fact.aiValue.trim());
      if (!configurationChanged) {
        setStep(2);
        return;
      }
      const result = await runBackground("startRecalculate", { analysis }, analysis.address, analysis.ownership);
      setAnalysis((current) => ({
        ...current,
        arv: result.arv,
        updatedAt: result.updatedAt || new Date().toISOString(),
        sourceLinks: Array.from(new Map([...(current.sourceLinks || []), ...(result.sourceLinks || [])].map((link) => [link.url, link])).values()),
      }));
      setStep(2);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to recalculate ARV."); } finally { setBusy(false); }
  }
  async function addEvidence(files: FileList | null) {
    if (!files?.length) return; setBusy(true); setMessage("");
    try { const images = await Promise.all(Array.from(files).slice(0, 6).map(fileToDataUrl)); const result = await api("analyzeImages", { analysis, images }); setAnalysis(result.analysis); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to analyze the uploaded images."); } finally { setBusy(false); }
  }
  async function finishAnalysis() {
    setBusy(true); setMessage("");
    try {
      const completed = { ...analysis, status: "completed" as const, updatedAt: new Date().toISOString() };
      const result = await api("save", { analysis: completed }); setAnalysis({ ...completed, id: result.id }); window.localStorage.removeItem(STORAGE_KEY); setMessage("Analysis saved to the Stage 2 Analysis Archive.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save the completed analysis."); } finally { setBusy(false); }
  }
  async function openArchive() {
    setArchiveOpen(true); setArchiveBusy(true);
    try { const result = await api("list"); setArchiveItems(result.items || []); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load previous analyses."); } finally { setArchiveBusy(false); }
  }
  async function loadArchive(id: string) {
    setArchiveBusy(true);
    try { const result = await api("load", { id }); setAnalysis(result.analysis); setStep(1); setArchiveOpen(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to open the selected analysis."); } finally { setArchiveBusy(false); }
  }
  function newAnalysis() { setAnalysis(EMPTY_ANALYSIS); setDataScout(""); setStep(0); setMessage(""); window.localStorage.removeItem(STORAGE_KEY); }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark">W</div>
        <div><p className="eyebrow">Wanderlust Intelligence Platform</p><h1>Stage 2 Analysis <span className="build-number">Build 6</span></h1></div>
        <div className="header-actions"><Button variant="outline" onClick={openArchive}><FileArchive size={16} /> Open Previous</Button><Button variant="ghost" onClick={newAnalysis}>New Analysis</Button></div>
      </header>
      <section className="workspace">
        <aside className="step-rail" aria-label="Analysis progress">
          <p className="step-count">Step {step + 1} of {STEPS.length}</p><Progress value={progress} className="progress-track" />
          <ol>{STEPS.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "complete" : ""}><span>{index < step ? <Check size={14} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
          {analysis.address && step > 0 && <div className="subject-chip"><MapPin size={16} /><span>{analysis.address}</span></div>}
        </aside>
        <div className="main-panel">
          {step === 0 && <Screen title="Start Stage 2 Analysis" subtitle="Enter the property address. Ownership information and ACT DataScout are optional.">
            <div className="form-grid">
              <div className="field-span"><Label htmlFor="address">Property address</Label><Input id="address" value={analysis.address} onChange={(e) => setAnalysis({ ...analysis, address: e.target.value })} placeholder="204 Gold Nugget Loop, Hot Springs, AR 71913" autoFocus /></div>
              <div><Label htmlFor="ownership">Ownership / acquisition type <span>Optional</span></Label><Input id="ownership" value={analysis.ownership} onChange={(e) => setAnalysis({ ...analysis, ownership: e.target.value })} placeholder="Owner occupied, foreclosure, tax sale…" /></div>
              <div><Label htmlFor="datascout">ACT DataScout screenshot <span>Optional</span></Label><label className="upload-control" htmlFor="datascout"><Upload size={17} />{dataScout ? "Screenshot added" : "Upload screenshot"}</label><input id="datascout" hidden type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && setDataScout(await fileToDataUrl(e.target.files[0]))} /></div>
            </div>
            <div className="start-actions"><Button size="lg" onClick={startAnalysis} disabled={!canContinue || busy}>{busy ? <Loader2 className="spin" /> : <Search />} Run Stage 2 Analysis</Button><Button size="lg" variant="outline" onClick={openArchive}><FileArchive /> Open Previous Analysis</Button></div>
          </Screen>}
          {step === 1 && <Screen title="Confirm Property Configuration" subtitle="Compare these findings with Master Suite and update every field that needs correction.">
            {analysis.facts.some((fact) => fact.conflict) && <div className="conflict-banner"><AlertTriangle size={18} /><span>Conflicting public information was found. Master Suite should control until the property walk proves otherwise.</span></div>}
            <div className="fact-table table-card"><div className="table-head"><span>Property fact</span><span>AI finding</span><span>Confirmed value</span></div>{analysis.facts.map((fact) => <div className={`table-row ${fact.conflict ? "conflict" : ""}`} key={fact.key}><strong>{fact.label}{fact.conflict && <Badge variant="outline">Conflict</Badge>}</strong><span>{fact.aiValue || "Not found"}</span><Input value={fact.confirmedValue} onChange={(e) => updateFact(fact.key, e.target.value)} aria-label={`Confirmed ${fact.label}`} /></div>)}</div>
          </Screen>}
          {step === 2 && <Screen title="Preliminary ARV" subtitle="Market-supported Stage 2 range based on the confirmed existing configuration."><div className="arv-grid"><Metric label="Low ARV / sq. ft." value={analysis.arv.lowPsf ? `$${analysis.arv.lowPsf}` : "—"} /><Metric label="Low ARV total" value={money(analysis.arv.lowTotal)} /><Metric label="High ARV / sq. ft." value={analysis.arv.highPsf ? `$${analysis.arv.highPsf}` : "—"} /><Metric label="High ARV total" value={money(analysis.arv.highTotal)} /><Metric label="ARV Ceiling" value={money(analysis.arv.ceiling)} accent /><Metric label="Confidence" value={analysis.arv.confidence} confidence={analysis.arv.confidence} /></div>{analysis.arv.ceiling < analysis.arv.highTotal && analysis.arv.ceilingReason && <div className="ceiling-reason"><strong>Why the ceiling is lower:</strong> {analysis.arv.ceilingReason}</div>}</Screen>}
          {step === 3 && <Screen title="Preliminary Construction Grade" subtitle="Suggested entries based on ownership data and available exterior imagery."><div className="section-toolbar"><label className="compact-upload" htmlFor="evidence"><ImagePlus size={17} /> Add photos or screenshots</label><input id="evidence" hidden multiple type="file" accept="image/*" onChange={(e) => addEvidence(e.target.files)} /></div><GradeTable rows={analysis.construction} includeReason images /><div className="total-strip"><span>Preliminary total</span><strong>{analysis.constructionTotal}</strong><ConfidenceBadge value={analysis.constructionConfidence} /></div></Screen>}
          {step === 4 && <Screen title="Intangible Grading" subtitle="Quick positive, neutral, or negative recommendations for Master Suite."><GradeTable rows={analysis.intangibles} includeReason /></Screen>}
          {step === 5 && <Screen title="Additional Stage 2 Steps" subtitle="Final researched starting points for the remaining Master Suite fields."><GradeTable rows={analysis.additional} includeReason /><div className="finish-note"><ShieldCheck size={20} /><span>Review the suggestions in Master Suite, then save this dated snapshot to the Stage 2 Analysis Archive.</span></div></Screen>}
          {message && <div className={`status-message ${message.includes("saved") ? "success" : ""}`}>{message}</div>}
          {step > 0 && <nav className="page-actions"><Button variant="outline" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={busy}><ArrowLeft /> Back</Button>{step < 5 ? <Button onClick={step === 1 ? continueFromFacts : () => setStep((value) => value + 1)} disabled={!canContinue || busy}>{busy ? <Loader2 className="spin" /> : <>Continue <ArrowRight /></>}</Button> : <Button onClick={finishAnalysis} disabled={busy}>{busy ? <Loader2 className="spin" /> : <><FileArchive /> Finish &amp; Save</>}</Button>}</nav>}
        </div>
      </section>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}><DialogContent className="archive-dialog"><DialogHeader><DialogTitle>Open Previous Analysis</DialogTitle></DialogHeader>{archiveBusy ? <div className="archive-loading"><Loader2 className="spin" /> Loading archive…</div> : archiveItems.length ? <div className="archive-list">{archiveItems.map((item) => <button key={item.id} onClick={() => loadArchive(item.id)}><span><strong>{item.address}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="archive-range">{item.arvLow ? `${money(item.arvLow)}–${money(item.arvHigh || 0)}` : ""}<ChevronRight size={18} /></span></button>)}</div> : <p className="empty-archive">No saved Stage 2 analyses were found.</p>}</DialogContent></Dialog>
    </main>
  );
}

function Screen({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <Card className="screen-card"><div className="screen-heading"><p className="eyebrow">Stage 2 Analysis</p><h2>{title}</h2><p>{subtitle}</p></div>{children}</Card>; }
function Metric({ label, value, accent, confidence }: { label: string; value: string; accent?: boolean; confidence?: Confidence }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong>{confidence && <ConfidenceBadge value={confidence} />}</div>; }
function ConfidenceBadge({ value }: { value: Confidence }) { return <span className={`confidence ${confidenceTone(value)}`}>{value} confidence</span>; }
/* eslint-disable @next/next/no-img-element */
function GradeTable({ rows, includeReason = false, images = false }: { rows: GradeRow[]; includeReason?: boolean; images?: boolean }) {
  return <div className="grade-table table-card"><div className={`table-head grade-columns ${includeReason ? "with-reason" : ""}`}><span>Field</span><span>Suggested entry</span><span>Confidence</span>{includeReason && <span>Brief reason</span>}</div>{rows.length ? rows.map((row) => <div className={`table-row grade-columns ${includeReason ? "with-reason" : ""}`} key={row.label}><strong>{row.label}</strong><span className="suggested-value">{row.value || "—"}</span><ConfidenceBadge value={row.confidence} />{includeReason && <span className="reason">{row.reason || "—"}</span>}{images && row.images?.length ? <div className="row-images">{row.images.map((img, index) => <a href={img.url} target="_blank" rel="noreferrer" key={`${img.url}-${index}`} title={`${img.source || "Source"}${img.date ? ` · ${img.date}` : ""}`}><img src={img.url} alt={img.label || `${row.label} evidence`} /></a>)}</div> : null}</div>) : <div className="empty-table">Recommendations will appear after the analysis runs.</div>}</div>;
}
