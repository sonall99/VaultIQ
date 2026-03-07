// src/lib/db.js
// All Supabase database operations — clean service layer

import { supabase } from "./supabase";

// ── Documents ─────────────────────────────────────────────

export async function saveDocument(title, content, fileType = "text") {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("documents")
    .insert({ user_id: user.id, title, content, file_type: fileType })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getDocuments() {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteDocument(id) {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw error;
}

// ── Questionnaires ────────────────────────────────────────

export async function saveQuestionnaire(name, rawText) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("questionnaires")
    .insert({ user_id: user.id, name, raw_text: rawText, status: "pending" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuestionnaireStatus(id, status) {
  const { error } = await supabase
    .from("questionnaires")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

// ── Runs (Version History) ────────────────────────────────

export async function createRun(questionnaireId, label, totalQuestions) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("runs")
    .insert({ questionnaire_id: questionnaireId, user_id: user.id, label, total_questions: totalQuestions })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function finalizeRun(runId, answeredCount, avgConfidence) {
  const { error } = await supabase
    .from("runs")
    .update({ answered_count: answeredCount, avg_confidence: avgConfidence })
    .eq("id", runId);
  if (error) throw error;
}

export async function getRuns() {
  const { data, error } = await supabase
    .from("runs")
    .select(`*, questionnaires(name)`)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}

export async function getRunWithAnswers(runId) {
  const { data: run, error: runError } = await supabase
    .from("runs")
    .select("*, questionnaires(name, raw_text)")
    .eq("id", runId)
    .single();
  if (runError) throw runError;

  const { data: answers, error: ansError } = await supabase
    .from("answers")
    .select("*")
    .eq("run_id", runId)
    .order("question_num");
  if (ansError) throw ansError;

  return { ...run, answers };
}

// ── Answers ───────────────────────────────────────────────

export async function saveAnswers(runId, answers) {
  const rows = answers.map(a => ({
    run_id: runId,
    question_num: a.num,
    question_text: a.text,
    answer_text: a.answer,
    citations: a.citations || [],
    evidence: a.evidence || "",
    confidence: a.confidence || 0,
    hallucination_risk: a.hallucination_risk || "low",
  }));
  const { error } = await supabase.from("answers").insert(rows);
  if (error) throw error;
}

export async function updateAnswer(id, answerText) {
  const { error } = await supabase
    .from("answers")
    .update({ answer_text: answerText, edited_by_user: true, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ── Analytics ─────────────────────────────────────────────

export async function trackEvent(eventType, metadata = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  // Fire and forget — don't await to avoid blocking UI
  supabase.from("analytics_events").insert({
    user_id: user?.id,
    event_type: eventType,
    metadata,
  }).then();
}

export async function getAnalytics() {
  const { data: { user } } = await supabase.auth.getUser();

  const [runs, events, docs] = await Promise.all([
    supabase.from("runs").select("id, answered_count, total_questions, avg_confidence, created_at").eq("user_id", user.id),
    supabase.from("analytics_events").select("event_type, created_at").eq("user_id", user.id),
    supabase.from("documents").select("id").eq("user_id", user.id),
  ]);

  const allRuns = runs.data || [];
  const totalQuestionnaires = allRuns.length;
  const totalAnswered = allRuns.reduce((s, r) => s + (r.answered_count || 0), 0);
  const avgConf = allRuns.length
    ? allRuns.reduce((s, r) => s + (r.avg_confidence || 0), 0) / allRuns.length
    : 0;

  return {
    totalQuestionnaires,
    totalAnswered,
    avgConfidence: Math.round(avgConf * 100),
    documentsUploaded: docs.data?.length || 0,
    recentRuns: allRuns.slice(0, 5),
  };
}
