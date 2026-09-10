"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, ExternalLink, FileArchive, FileDown, ImagePlus, Loader2, Mail, MapPin, Search, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

type Confidence = "High" | "Moderate" | "Low" | "Unknown";
type FactKey = "propertyType" | "bedrooms" | "fullBaths" | "halfBaths" | "squareFeet" | "lotSize" | "stories" | "basement" | "parking" | "waterfront";
type Fact = { key: FactKey; label: string; aiValue: string; confirmedValue: string; conflict?: boolean; sources?: string[] };
type EvidenceImage = { url: string; source?: string; date?: string; label?: string };
type GradeRow = { label: string; value: string; confidence: Confidence; reason?: string; images?: EvidenceImage[] };
type UploadedImage = { fileId: string; thumbnailFileId?: string; name: string; kind: "datascout" | "property"; viewUrl: string; folderId: string };
type ResearchTiming = { operation: "initial" | "configuration"; seconds: number; completedAt: string };
type ArvResult = { lowPsf: number; lowTotal: number; highPsf: number; highTotal: number; ceiling: number; ceilingReason?: string; confidence: Confidence };
type Analysis = {
  id?: string; address: string; ownership: string; createdAt?: string; updatedAt?: string;
  facts: Fact[]; arv: ArvResult; construction: GradeRow[]; constructionTotal: string;
  constructionConfidence: Confidence; intangibles: GradeRow[]; additional: GradeRow[];
  evidenceImages: EvidenceImage[]; sourceLinks?: { label: string; url: string }[];
  uploadedImages?: UploadedImage[]; archiveFolderId?: string; reportUrl?: string; photosUrl?: string;
  researchTimings?: ResearchTiming[];
  arvBasis?: Record<string, string>;
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
const RECIPIENTS = [
  { name: "John", email: "john@wanderlust.properties" },
  { name: "Nidia", email: "nidia@wanderlust.properties" },
  { name: "Margie", email: "margie@wanderlust.properties" },
];

function money(value: number) { return value ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "—"; }
function elapsedTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function factSnapshot(facts: Fact[]) { return Object.fromEntries(facts.map((fact) => [fact.key, fact.confirmedValue.trim()])); }
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
async function reportImageDataUrl(file: File): Promise<string> {
  const source = await fileToDataUrl(file);
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maximum = 1400;
      const scale = Math.min(1, maximum / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.76));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
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
  const [draftId, setDraftId] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>(["john@wanderlust.properties"]);
  const [customRecipient, setCustomRecipient] = useState("");
  const [deliveryResult, setDeliveryResult] = useState<{ reportUrl: string; photosUrl: string; recipients: string[] } | null>(null);
  const [researchPhase, setResearchPhase] = useState("");
  const [operationStartedAt, setOperationStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [lastSavedAt, setLastSavedAt] = useState("");

  useEffect(() => {
    // Restoring the persisted draft identifier is an intentional one-time external-store sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftId(window.sessionStorage.getItem("wanderlust-stage2-draft-id") || crypto.randomUUID());
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      setAnalysis(JSON.parse(saved));
    } catch { /* ignore invalid draft */ }
  }, []);
  useEffect(() => { if (draftId) window.sessionStorage.setItem("wanderlust-stage2-draft-id", draftId); }, [draftId]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...analysis, updatedAt: new Date().toISOString() })); }, [analysis]);
  useEffect(() => {
    if (!operationStartedAt) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - operationStartedAt) / 1000)));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [operationStartedAt]);

  const progress = ((step + 1) / STEPS.length) * 100;
  const canContinue = useMemo(() => step === 0 ? analysis.address.trim().length > 5 : step === 1 ? analysis.facts.length > 0 && analysis.facts.every((fact) => fact.confirmedValue.trim()) : true, [analysis, step]);
  function updateFact(key: FactKey, value: string) { setAnalysis((current) => ({ ...current, facts: current.facts.map((fact) => fact.key === key ? { ...fact, confirmedValue: value } : fact) })); }
  function beginResearch(phase: string) { setResearchPhase(phase); setElapsedSeconds(0); setOperationStartedAt(Date.now()); }
  function endResearch() { setOperationStartedAt(null); setResearchPhase(""); }
  async function persistDraft(nextAnalysis: Analysis): Promise<Analysis> {
    setSaveStatus("saving");
    try {
      const result = await api("saveDraft", { analysis: nextAnalysis, draftId });
      const saved = { ...nextAnalysis, id: result.id, archiveFolderId: result.folderId, updatedAt: result.savedAt };
      setLastSavedAt(result.savedAt);
      setSaveStatus("saved");
      return saved;
    } catch {
      setSaveStatus("error");
      return nextAnalysis;
    }
  }
  async function archiveUpload(file: File, kind: UploadedImage["kind"]) {
    if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} is larger than the 15 MB photo limit.`);
    const originalDataUrl = await fileToDataUrl(file);
    const thumbnailDataUrl = await reportImageDataUrl(file);
    const id = draftId || crypto.randomUUID();
    if (!draftId) setDraftId(id);
    const result = await api("uploadImage", { draftId: id, address: analysis.address, kind, fileName: file.name, originalDataUrl, thumbnailDataUrl });
    return { image: result.image as UploadedImage, analysisDataUrl: thumbnailDataUrl };
  }
  async function addDataScout(file: File) {
    setBusy(true); setMessage("");
    try {
      const uploaded = await archiveUpload(file, "datascout");
      setDataScout(uploaded.analysisDataUrl);
      setAnalysis((current) => ({ ...current, uploadedImages: [...(current.uploadedImages || []).filter((image) => image.kind !== "datascout"), uploaded.image] }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to archive the DataScout screenshot."); }
    finally { setBusy(false); }
  }

  async function startAnalysis() {
    setBusy(true); setMessage("");
    beginResearch("Researching property facts and ARV");
    const startedAt = Date.now();
    try {
      const address = analysis.address.trim();
      const ownership = analysis.ownership.trim();
      const researched = await runBackground("startAnalyze", { address, ownership, dataScoutImage: dataScout || undefined }, address, ownership);
      setResearchPhase("Completing construction and intangible grading");
      let completed: Analysis;
      try {
        completed = await runBackground("startCompleteGrades", { analysis: researched, includeImages: true }, address, ownership);
      } catch {
        completed = await runBackground("startCompleteGrades", { analysis: researched, includeImages: false }, address, ownership);
      }
      setResearchPhase("Finalizing analysis and saving to Drive");
      const completedAt = new Date().toISOString();
      const nextAnalysis: Analysis = {
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
        uploadedImages: analysis.uploadedImages || [],
        arvBasis: factSnapshot(researched.facts),
        researchTimings: [...(analysis.researchTimings || []), { operation: "initial", seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), completedAt }],
        status: "draft",
      };
      const saved = await persistDraft(nextAnalysis);
      setAnalysis(saved);
      setStep(1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to begin analysis."); } finally { endResearch(); setBusy(false); }
  }
  async function continueFromFacts() {
    setBusy(true); setMessage("");
    try {
      const currentBasis = factSnapshot(analysis.facts);
      const savedBasis = analysis.arvBasis || currentBasis;
      const configurationChanged = Object.keys(currentBasis).some((key) => currentBasis[key] !== savedBasis[key]);
      if (!configurationChanged) {
        const saved = await persistDraft(analysis);
        setAnalysis(saved);
        setStep(2);
        return;
      }
      beginResearch("Recalculating ARV from confirmed configuration");
      const startedAt = Date.now();
      const result = await runBackground("startRecalculate", { analysis }, analysis.address, analysis.ownership);
      setResearchPhase("Finalizing revised valuation and saving to Drive");
      const revised: Analysis = {
        ...analysis,
        arv: result.arv,
        updatedAt: result.updatedAt || new Date().toISOString(),
        sourceLinks: Array.from(new Map([...(analysis.sourceLinks || []), ...(result.sourceLinks || [])].map((link) => [link.url, link])).values()),
        arvBasis: currentBasis,
        researchTimings: [...(analysis.researchTimings || []), { operation: "configuration", seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), completedAt: new Date().toISOString() }],
      };
      const saved = await persistDraft(revised);
      setAnalysis(saved);
      setStep(2);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to recalculate ARV."); } finally { endResearch(); setBusy(false); }
  }
  async function addEvidence(files: FileList | null) {
    if (!files?.length) return; setBusy(true); setMessage("");
    try {
      const uploaded = [];
      for (const file of Array.from(files).slice(0, 6)) uploaded.push(await archiveUpload(file, "property"));
      const images = uploaded.map((item) => item.analysisDataUrl);
      const result = await api("analyzeImages", { analysis, images });
      const nextAnalysis = { ...result.analysis, uploadedImages: [...(analysis.uploadedImages || []), ...uploaded.map((item) => item.image)] } as Analysis;
      const saved = await persistDraft(nextAnalysis);
      setAnalysis(saved);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to analyze the uploaded images."); } finally { setBusy(false); }
  }
  async function finishAnalysis(sendEmail: boolean) {
    setBusy(true); setMessage("");
    try {
      const completed = { ...analysis, status: "completed" as const, updatedAt: new Date().toISOString() };
      if (sendEmail && !selectedRecipients.length && !customRecipient.trim()) throw new Error("Select at least one recipient or enter an email address.");
      const result = await api("saveAndDeliver", { analysis: completed, draftId, recipients: selectedRecipients, customEmail: customRecipient.trim(), sendEmail });
      setAnalysis({ ...completed, id: result.id, archiveFolderId: result.folderId, reportUrl: result.reportUrl, photosUrl: result.photosUrl });
      setLastSavedAt(new Date().toISOString()); setSaveStatus("saved");
      setDeliveryResult({ reportUrl: result.reportUrl, photosUrl: result.photosUrl, recipients: result.recipients || [] });
      window.localStorage.removeItem(STORAGE_KEY);
      setMessage(sendEmail ? `Report saved and emailed to ${result.recipients.join(", ")}.` : "PDF report saved to the Stage 2 Analysis Archive.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to generate the Stage 2 report."); } finally { setBusy(false); }
  }
  async function openArchive() {
    setArchiveOpen(true); setArchiveBusy(true);
    try { const result = await api("list"); setArchiveItems(result.items || []); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load previous analyses."); } finally { setArchiveBusy(false); }
  }
  async function loadArchive(id: string) {
    setArchiveBusy(true);
    try { const result = await api("load", { id }); setAnalysis(result.analysis); setLastSavedAt(result.analysis.updatedAt || result.analysis.createdAt || ""); setSaveStatus("saved"); setStep(1); setArchiveOpen(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to open the selected analysis."); } finally { setArchiveBusy(false); }
  }
  async function advanceStep() {
    if (step === 4) {
      const saved = await persistDraft(analysis);
      setAnalysis(saved);
    }
    setStep((value) => value + 1);
  }
  function newAnalysis() { const id = crypto.randomUUID(); setAnalysis(EMPTY_ANALYSIS); setDataScout(""); setDraftId(id); setDeliveryResult(null); setSaveStatus(""); setLastSavedAt(""); endResearch(); setStep(0); setMessage(""); window.localStorage.removeItem(STORAGE_KEY); window.sessionStorage.setItem("wanderlust-stage2-draft-id", id); }
  function toggleRecipient(email: string, checked: boolean) { setSelectedRecipients((current) => checked ? [...new Set([...current, email])] : current.filter((item) => item !== email)); }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark">W</div>
        <div><p className="eyebrow">Wanderlust Intelligence Platform</p><h1>Stage 2 Analysis <span className="build-number">Build 9</span></h1></div>
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
              <div><Label htmlFor="datascout">ACT DataScout screenshot <span>Optional</span></Label><label className="upload-control" htmlFor="datascout"><Upload size={17} />{dataScout ? "Screenshot archived" : "Upload screenshot"}</label><input id="datascout" hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && addDataScout(e.target.files[0])} /></div>
            </div>
            <div className="start-actions"><Button size="lg" onClick={startAnalysis} disabled={!canContinue || busy}>{busy ? <Loader2 className="spin" /> : <Search />} Run Stage 2 Analysis</Button><Button size="lg" variant="outline" onClick={openArchive}><FileArchive /> Open Previous Analysis</Button></div>
            {busy && researchPhase && <ResearchProgress phase={researchPhase} seconds={elapsedSeconds} />}
          </Screen>}
          {step === 1 && <Screen title="Confirm Property Configuration" subtitle="Compare these findings with Master Suite and update every field that needs correction.">
            {busy && researchPhase && <ResearchProgress phase={researchPhase} seconds={elapsedSeconds} />}
            {analysis.facts.some((fact) => fact.conflict) && <div className="conflict-banner"><AlertTriangle size={18} /><span>Conflicting public information was found. Master Suite should control until the property walk proves otherwise.</span></div>}
            <div className="fact-table table-card"><div className="table-head"><span>Property fact</span><span>AI finding</span><span>Confirmed value</span></div>{analysis.facts.map((fact) => <div className={`table-row ${fact.conflict ? "conflict" : ""}`} key={fact.key}><strong>{fact.label}{fact.conflict && <Badge variant="outline">Conflict</Badge>}</strong><span>{fact.aiValue || "Not found"}</span><Input value={fact.confirmedValue} onChange={(e) => updateFact(fact.key, e.target.value)} aria-label={`Confirmed ${fact.label}`} /></div>)}</div>
          </Screen>}
          {step === 2 && <Screen title="Preliminary ARV" subtitle="Market-supported Stage 2 range based on the confirmed existing configuration."><div className="arv-grid"><Metric label="Low ARV / sq. ft." value={analysis.arv.lowPsf ? `$${analysis.arv.lowPsf}` : "—"} /><Metric label="Low ARV total" value={money(analysis.arv.lowTotal)} /><Metric label="High ARV / sq. ft." value={analysis.arv.highPsf ? `$${analysis.arv.highPsf}` : "—"} /><Metric label="High ARV total" value={money(analysis.arv.highTotal)} /><Metric label="ARV Ceiling" value={money(analysis.arv.ceiling)} accent /><Metric label="Confidence" value={analysis.arv.confidence} confidence={analysis.arv.confidence} /></div>{analysis.arv.ceiling < analysis.arv.highTotal && analysis.arv.ceilingReason && <div className="ceiling-reason"><strong>Why the ceiling is lower:</strong> {analysis.arv.ceilingReason}</div>}</Screen>}
          {step === 3 && <Screen title="Preliminary Construction Grade" subtitle="Suggested entries based on ownership data and available exterior imagery."><div className="section-toolbar"><label className="compact-upload" htmlFor="evidence"><ImagePlus size={17} /> Add photos or screenshots</label><input id="evidence" hidden multiple type="file" accept="image/*" onChange={(e) => addEvidence(e.target.files)} /></div><GradeTable rows={analysis.construction} includeReason images /><div className="total-strip"><span>Preliminary total</span><strong>{analysis.constructionTotal}</strong><ConfidenceBadge value={analysis.constructionConfidence} /></div></Screen>}
          {step === 4 && <Screen title="Intangible Grading" subtitle="Quick positive, neutral, or negative recommendations for Master Suite."><GradeTable rows={analysis.intangibles} includeReason /></Screen>}
          {step === 5 && <Screen title="Additional Stage 2 Steps" subtitle="Final researched starting points for the remaining Master Suite fields."><GradeTable rows={analysis.additional} includeReason /><div className="finish-note"><ShieldCheck size={20} /><span>Review the suggestions, then create the dated PDF report and save the complete record to the Stage 2 Analysis Archive.</span></div><section className="delivery-card"><div className="delivery-heading"><Mail size={20} /><div><h3>Report delivery</h3><p>Select everyone who should receive the completed PDF.</p></div></div><div className="recipient-grid">{RECIPIENTS.map((recipient) => <label key={recipient.email} className="recipient-option"><Checkbox checked={selectedRecipients.includes(recipient.email)} onCheckedChange={(checked) => toggleRecipient(recipient.email, checked === true)} /><span><strong>{recipient.name}</strong><small>{recipient.email}</small></span></label>)}</div><div className="custom-recipient"><Label htmlFor="custom-email">Other email address <span>Optional</span></Label><Input id="custom-email" type="email" value={customRecipient} onChange={(event) => setCustomRecipient(event.target.value)} placeholder="name@example.com" /><small>Outside recipients receive the PDF but not access to the private Drive photo folder.</small></div>{deliveryResult && <div className="delivery-links"><a href={deliveryResult.reportUrl} target="_blank" rel="noreferrer"><FileDown size={16} /> Open PDF</a><a href={deliveryResult.photosUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> View full photos</a></div>}</section></Screen>}
          {saveStatus && <div className={`save-status ${saveStatus}`} aria-live="polite">{saveStatus === "saving" ? <><Loader2 className="spin" /> Saving to Drive…</> : saveStatus === "saved" ? <><Check /> Saved to Drive{lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</> : <><AlertTriangle /> Drive autosave is unavailable. Your browser draft is preserved.</>}</div>}
          {message && <div className={`status-message ${message.includes("saved") ? "success" : ""}`}>{message}</div>}
          {step > 0 && <nav className="page-actions"><Button variant="outline" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={busy}><ArrowLeft /> Back</Button>{step < 5 ? <Button onClick={step === 1 ? continueFromFacts : advanceStep} disabled={!canContinue || busy}>{busy ? <Loader2 className="spin" /> : <>Continue <ArrowRight /></>}</Button> : <div className="report-actions"><Button variant="outline" onClick={() => finishAnalysis(false)} disabled={busy}>{busy ? <Loader2 className="spin" /> : <><FileDown /> Generate PDF</>}</Button><Button onClick={() => finishAnalysis(true)} disabled={busy}>{busy ? <Loader2 className="spin" /> : <><Mail /> Generate PDF &amp; Email</>}</Button></div>}</nav>}
        </div>
      </section>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}><DialogContent className="archive-dialog"><DialogHeader><DialogTitle>Open Previous Analysis</DialogTitle></DialogHeader>{archiveBusy ? <div className="archive-loading"><Loader2 className="spin" /> Loading archive…</div> : archiveItems.length ? <div className="archive-list">{archiveItems.map((item) => <button key={item.id} onClick={() => loadArchive(item.id)}><span><strong>{item.address}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="archive-range">{item.arvLow ? `${money(item.arvLow)}–${money(item.arvHigh || 0)}` : ""}<ChevronRight size={18} /></span></button>)}</div> : <p className="empty-archive">No saved Stage 2 analyses were found.</p>}</DialogContent></Dialog>
    </main>
  );
}

function Screen({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <Card className="screen-card"><div className="screen-heading"><p className="eyebrow">Stage 2 Analysis</p><h2>{title}</h2><p>{subtitle}</p></div>{children}</Card>; }
function Metric({ label, value, accent, confidence }: { label: string; value: string; accent?: boolean; confidence?: Confidence }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong>{confidence && <ConfidenceBadge value={confidence} />}</div>; }
function ConfidenceBadge({ value }: { value: Confidence }) { return <span className={`confidence ${confidenceTone(value)}`}>{value} confidence</span>; }
function ResearchProgress({ phase, seconds }: { phase: string; seconds: number }) { return <div className="research-progress" role="status" aria-live="polite"><Loader2 className="spin" /><div><strong>{phase}</strong><span>AI research is still running. You can leave this tab open.</span></div><time>{elapsedTime(seconds)}</time></div>; }
/* eslint-disable @next/next/no-img-element */
function GradeTable({ rows, includeReason = false, images = false }: { rows: GradeRow[]; includeReason?: boolean; images?: boolean }) {
  return <div className="grade-table table-card"><div className={`table-head grade-columns ${includeReason ? "with-reason" : ""}`}><span>Field</span><span>Suggested entry</span><span>Confidence</span>{includeReason && <span>Brief reason</span>}</div>{rows.length ? rows.map((row) => <div className={`table-row grade-columns ${includeReason ? "with-reason" : ""}`} key={row.label}><strong>{row.label}</strong><span className="suggested-value">{row.value || "—"}</span><ConfidenceBadge value={row.confidence} />{includeReason && <span className="reason">{row.reason || "—"}</span>}{images && row.images?.length ? <div className="row-images">{row.images.map((img, index) => <a href={img.url} target="_blank" rel="noreferrer" key={`${img.url}-${index}`} title={`${img.source || "Source"}${img.date ? ` · ${img.date}` : ""}`}><img src={img.url} alt={img.label || `${row.label} evidence`} /></a>)}</div> : null}</div>) : <div className="empty-table">Recommendations will appear after the analysis runs.</div>}</div>;
}
